import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  ensureSubscriptionRecord,
  ensureStripeCustomer,
} from "@/lib/subscription";
import { stripe, stripeConfigured, priceIdFor } from "@/lib/stripe";
import DashboardClient from "@/components/dashboard-client";
import AppShell from "@/components/app-shell";
import { log, errorInfo } from "@/lib/log";
import { buildQueueForUser } from "@/lib/dashboard/queue-builder";
import { DailyHeadline } from "@/components/dashboard/daily-headline";
import { DecisionQueue } from "@/components/dashboard/decision-queue";
import { RiskTile } from "@/components/dashboard/risk-tile";
import { VarTile } from "@/components/dashboard/var-tile";
import { MarketRegimeTile } from "@/components/dashboard/market-regime-tile";
import { LegacyDashboardSection } from "@/components/dashboard/legacy-dashboard-section";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { QueueItem } from "@/lib/dashboard/types";

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
  const items = await buildQueueForUser(userId).catch((err) => {
    log.warn("app.page", "buildQueueForUser failed", {
      userId,
      ...errorInfo(err),
    });
    return [] as QueueItem[];
  });

  // Stale-headline fix (2026-05-02): we used to fall back to
  // `user_profile.headline_cache.rendered` whenever `items` was empty,
  // but that conflated "queue genuinely empty after dismiss" with
  // "queue builder errored." The latter is already handled by the
  // catch above (returns `[]`); the former should render the
  // empty-state CTA, not re-render the just-dismissed item. The cron
  // still refreshes the cache daily for the warm-load case but it's
  // no longer authoritative for this surface — the snooze/dismiss/
  // done route handlers also clear it on user action so it can never
  // shadow a real action.
  const headline: QueueItem | null = items[0] ?? null;
  const queue = headline
    ? items.filter((i) => i.itemKey !== headline.itemKey)
    : items;

  // Composition (2026-05-02). The /app overview is now wrapped in the
  // shared AppShell so the top nav, ticker tape, and trial banner are
  // present (matches /app/history, /app/year-outlook, /app/settings).
  // Two stacked sections inside the shell:
  //
  //   1. Actionable layer (max-w-3xl): Headline + Queue + tiles. Tight
  //      decision-focused column.
  //   2. Legacy hybrid-v2 dashboard (full width via DashboardView):
  //      Next Move hero + BlockGrid + drill panel. Informational.
  //
  // Rendering DashboardView directly (via the LegacyDashboardSection
  // client wrapper) avoids stacking a second AppShell that
  // DashboardClient would have brought along.
  return (
    <AppShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
    >
      <TooltipProvider delay={200}>
        <section className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
          <DailyHeadline item={headline} />
          <DecisionQueue items={queue} />
          <ContextTilesRow userId={userId} />
          {/*
            Phase 3 Batch G: surface a link to the standalone Year
            Outlook page from the homepage so users can drill from the
            dashboard tiles into the full pacing / glidepath / risk
            landscape view without hunting through the top nav.
          */}
          <div className="flex justify-end">
            <Link
              href="/app/year-outlook"
              className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              View year outlook →
            </Link>
          </div>
        </section>

        {/* Rich informational dashboard below the actionable layer. */}
        <section className="border-t border-[var(--border)] mt-2 pt-6">
          <LegacyDashboardSection userName={session.user.name ?? "there"} />
        </section>
      </TooltipProvider>
    </AppShell>
  );
}

function ContextTilesRow({ userId }: { userId: string }) {
  // Layout: MarketRegimeTile (Batch D) on the left, RiskTile (Batch A)
  // in the middle, VarTile (Batch E) on the right. Each tile owns its
  // own empty-state — MarketRegime falls back to a NEUTRAL label with
  // em-dashed signals when FRED is unavailable; RiskTile and VarTile
  // fill "—" everywhere when the warehouse has < 20 aligned days.
  // Year-pace will return as its own surface in Batch G.
  return (
    <div className="grid grid-cols-3 gap-2 text-xs text-[var(--muted-foreground)]">
      <MarketRegimeTile />
      <RiskTile userId={userId} />
      <VarTile userId={userId} />
    </div>
  );
}
