import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  ensureSubscriptionRecord,
  ensureStripeCustomer,
} from "@/lib/subscription";
import { stripe, stripeConfigured, priceIdFor } from "@/lib/stripe";
import DashboardClient from "@/components/dashboard-client";
import { log, errorInfo } from "@/lib/log";
import { pool } from "@/lib/db";
import { buildQueueForUser } from "@/lib/dashboard/queue-builder";
import { DailyHeadline } from "@/components/dashboard/daily-headline";
import { DecisionQueue } from "@/components/dashboard/decision-queue";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { HeadlineCache, QueueItem } from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  // Lazy-create the trial subscription row on first /app load. Idempotent
  // (ON CONFLICT DO NOTHING). Doing it here rather than in a BetterAuth
  // signup callback avoids tangling with the verification-email flow —
  // the trial timer starts the first time the user actually lands in the
  // app, not the moment they create the account, which is more
  // forgiving for users who sign up days before they verify.
  await ensureSubscriptionRecord(session.user.id);

  // Post-OAuth checkout handoff. When the sign-up page sent a
  // signed-in-via-Google user back to /app with `?next=checkout&
  // tier=...&interval=...`, finish what they started: create a
  // Stripe Checkout Session server-side and redirect them to it,
  // skipping the dashboard render entirely.
  //
  // Email signups handle this client-side in /sign-up/page.tsx
  // because there's no OAuth round-trip. This server-side branch
  // exists specifically to catch the OAuth callback case.
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : null;
  const intentTier =
    typeof params.tier === "string" ? params.tier : null;
  const intentInterval =
    typeof params.interval === "string" ? params.interval : null;

  if (
    next === "checkout" &&
    stripeConfigured() &&
    (intentTier === "individual" || intentTier === "active")
  ) {
    const interval =
      intentInterval === "annual" ? "annual" : "monthly";
    const priceId = priceIdFor(intentTier, interval);
    if (priceId) {
      // Resolve the URL inside try/catch (so a Stripe outage falls
      // through to the dashboard render below), then redirect()
      // OUTSIDE the catch — Next's redirect() throws a special
      // NEXT_REDIRECT error that user catch-blocks would swallow,
      // which is the difference between "user lands at Stripe" and
      // "user sees the dashboard with no idea what happened."
      let checkoutUrl: string | null = null;
      try {
        const customerId = await ensureStripeCustomer(
          session.user.id,
          session.user.email,
          session.user.name
        );
        const baseUrl = process.env.BETTER_AUTH_URL || "https://clearpathinvest.app";
        const checkout = await stripe().checkout.sessions.create({
          mode: "subscription",
          customer: customerId,
          line_items: [{ price: priceId, quantity: 1 }],
          allow_promotion_codes: true,
          success_url: `${baseUrl}/app/settings?upgraded=1`,
          cancel_url: `${baseUrl}/app`,
          metadata: {
            userId: session.user.id,
            tier: intentTier,
            interval,
            source: "post_oauth_checkout",
          },
          subscription_data: {
            metadata: {
              userId: session.user.id,
              tier: intentTier,
              interval,
            },
          },
        });
        checkoutUrl = checkout.url ?? null;
      } catch (err) {
        log.warn("app.page", "post-oauth checkout failed", {
          userId: session.user.id,
          tier: intentTier,
          interval,
          ...errorInfo(err),
        });
      }
      if (checkoutUrl) {
        redirect(checkoutUrl);
      }
    }
  }

  // ?view= routing.
  //
  // The new Phase-1 actionable overview (Daily Headline + Decision Queue)
  // is the default `/app` view. Any explicit ?view=portfolio | research |
  // strategy | integrations | dashboard still routes through the existing
  // client-shell composition (sidebar nav, legacy hybrid dashboard, etc.)
  // so deep links into those panels are not broken.
  const viewParam = typeof params.view === "string" ? params.view : null;
  if (viewParam && viewParam !== "overview") {
    return (
      <DashboardClient
        user={{ name: session.user.name, email: session.user.email }}
      />
    );
  }

  // ---- New overview composition ---------------------------------------
  const userId = session.user.id;
  const [items, cacheRow] = await Promise.all([
    buildQueueForUser(userId).catch((err) => {
      log.warn("app.page", "buildQueueForUser failed", {
        userId,
        ...errorInfo(err),
      });
      return [] as QueueItem[];
    }),
    pool
      .query<{ headline_cache: HeadlineCache | null }>(
        `SELECT headline_cache FROM user_profile WHERE "userId" = $1`,
        [userId],
      )
      .catch((err) => {
        log.warn("app.page", "headline_cache fetch failed", {
          userId,
          ...errorInfo(err),
        });
        return { rows: [] as Array<{ headline_cache: HeadlineCache | null }> };
      }),
  ]);

  const cached = cacheRow.rows[0]?.headline_cache ?? null;
  const headline: QueueItem | null = items[0] ?? cached?.rendered ?? null;
  const queue = headline
    ? items.filter((i) => i.itemKey !== headline.itemKey)
    : items;

  return (
    <TooltipProvider delay={200}>
      <main className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
        <DailyHeadline item={headline} />
        <DecisionQueue items={queue} />
        <ContextTilesRow />
      </main>
    </TooltipProvider>
  );
}

function ContextTilesRow() {
  return (
    <div className="grid grid-cols-3 gap-2 text-xs text-[var(--muted-foreground)]">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded p-3 text-center">
        <div className="opacity-70">Macro</div>
        <div className="font-bold text-[var(--foreground)]">—</div>
      </div>
      <div className="bg-[var(--card)] border border-[var(--border)] rounded p-3 text-center">
        <div className="opacity-70">Portfolio MTD</div>
        <div className="font-bold text-[var(--foreground)]">—</div>
      </div>
      <div className="bg-[var(--card)] border border-[var(--border)] rounded p-3 text-center">
        <div className="opacity-70">{new Date().getUTCFullYear()} pace</div>
        <div className="font-bold text-[var(--foreground)]">—</div>
      </div>
    </div>
  );
}
