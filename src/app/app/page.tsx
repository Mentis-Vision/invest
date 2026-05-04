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
import { PortfolioHero } from "@/components/dashboard/redesign/portfolio-hero";
import { TodayDecision } from "@/components/dashboard/redesign/today-decision";
import { WatchThisWeek } from "@/components/dashboard/redesign/watch-this-week";
import { MarketConditionsSidebar } from "@/components/dashboard/redesign/market-conditions-sidebar";
import { getHeroData } from "@/lib/dashboard/hero-loader";
import { getMarketRegime } from "@/lib/dashboard/metrics/regime-loader";
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

  // ---- Overview composition (Phase 5 redesign) ----------------------
  //
  // Spec §7. The overview surface is the unified PortfolioHero +
  // TodayDecision + WatchThisWeek + MarketConditionsSidebar layout
  // wrapped in the shared AppShell (top nav, ticker tape, trial
  // banner). Each loader has its own catch so a failure on any one
  // input degrades that section to its empty-state without taking
  // the page down.
  const userId = session.user.id;

  const [hero, queue, regime] = await Promise.all([
    getHeroData(userId).catch((err) => {
      log.warn("app.page", "hero-loader failed", {
        userId,
        ...errorInfo(err),
      });
      return null;
    }),
    buildQueueForUser(userId).catch((err) => {
      log.warn("app.page", "buildQueueForUser failed", {
        userId,
        ...errorInfo(err),
      });
      return [] as QueueItem[];
    }),
    getMarketRegime().catch((err) => {
      log.warn("app.page", "getMarketRegime failed", {
        ...errorInfo(err),
      });
      return null;
    }),
  ]);

  const primary = queue[0] ?? null;
  const others = queue.slice(1);
  const watchThisWeek = queue
    .filter((i) => i.horizon === "THIS_WEEK")
    .slice(0, 3);

  // Map regime signals to MarketConditionsSidebar's expected props.
  // The component expects label/vix/vixTermStructure/daysToFOMC/real10Y/asOf
  // — derive vixTermStructure from the ratio (< 1 → contango, ≥ 1 →
  // backwardation) and pass `real10Y: null` since the regime-loader
  // doesn't surface a 10Y real yield today (TIPS series isn't wired
  // into the loader yet — the sidebar gracefully renders "—").
  const regimeProps = regime
    ? {
        label: regime.classification.label,
        vix: regime.signals.vixLevel,
        vixTermStructure:
          regime.signals.vixTermRatio === null ||
          regime.signals.vixTermRatio === undefined
            ? null
            : regime.signals.vixTermRatio < 1
              ? ("contango" as const)
              : ("backwardation" as const),
        daysToFOMC: regime.signals.daysToFOMC ?? null,
        real10Y: null,
        asOf: regime.asOf,
      }
    : {
        label: null,
        vix: null,
        vixTermStructure: null,
        daysToFOMC: null,
        real10Y: null,
        asOf: null,
      };

  return (
    <AppShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
    >
      <TooltipProvider delay={200}>
        <main className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-3">
          <PortfolioHero userName={session.user.name ?? null} hero={hero} />
          <TodayDecision primary={primary} others={others} />
          <div className="grid grid-cols-1 md:grid-cols-[1.8fr_1fr] gap-3">
            <WatchThisWeek items={watchThisWeek} totalCount={queue.length} />
            <MarketConditionsSidebar {...regimeProps} />
          </div>
        </main>
      </TooltipProvider>
    </AppShell>
  );
}
