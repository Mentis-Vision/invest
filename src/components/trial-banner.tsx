"use client";

import { useEffect, useState } from "react";
import { Sparkles, AlertTriangle, Clock, X, Loader2 } from "lucide-react";

/**
 * In-app trial countdown / expiry / past-due banner.
 *
 * Renders one strip at the top of every authed page (slotted into
 * AppShell). Mounts client-side, fetches /api/user/subscription
 * once on mount, decides which (if any) state to surface:
 *
 *   - Trial running, ≤7 days left → amber "X days left" with
 *     founder-pricing CTA (the highest-leverage window).
 *   - Trial running, ≤1 day left → orange urgency variant.
 *   - Trial expired AND no paid sub → red "trial ended" banner.
 *   - Subscription past_due → red "card declined, update payment".
 *   - Otherwise (≥8 days trial left, or active paid sub, or
 *     unauthenticated) → renders nothing.
 *
 * Dismissible per session — once you click X, the banner stays
 * gone for that tab. Storage is sessionStorage (not localStorage)
 * because we WANT the banner to come back after a sign-out / new
 * tab; the per-session dismiss is just to stop the same-page
 * nagging on every navigation.
 */

type SubscriptionState = {
  tier: "trial" | "free" | "individual" | "active" | "advisor";
  effectiveTier: "individual" | "active" | "advisor" | "free";
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type BannerVariant = "soft" | "urgent" | "expired" | "past_due";

function pickVariant(s: SubscriptionState): {
  variant: BannerVariant;
  daysLeft: number;
} | null {
  // past_due wins regardless of trial state — billing problems
  // are the most important thing to surface.
  if (s.status === "past_due") {
    return { variant: "past_due", daysLeft: 0 };
  }

  // Trial expired + no paid subscription → free fallback.
  if (s.tier === "trial" && s.trialEndsAt) {
    const ms = new Date(s.trialEndsAt).getTime() - Date.now();
    const daysLeft = ms / (1000 * 60 * 60 * 24);

    if (daysLeft < 0) {
      return { variant: "expired", daysLeft: 0 };
    }
    if (daysLeft <= 1) {
      return { variant: "urgent", daysLeft: Math.max(0, Math.ceil(daysLeft)) };
    }
    if (daysLeft <= 7) {
      return { variant: "soft", daysLeft: Math.ceil(daysLeft) };
    }
  }

  return null;
}

const STORAGE_KEY = "clearpath:trial-banner-dismissed";

export default function TrialBanner() {
  const [state, setState] = useState<SubscriptionState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyError, setBusyError] = useState<string | null>(null);

  useEffect(() => {
    // Only check sessionStorage in the browser — SSR has no window.
    try {
      if (
        typeof window !== "undefined" &&
        window.sessionStorage.getItem(STORAGE_KEY) === "1"
      ) {
        setDismissed(true);
      }
    } catch {
      /* sessionStorage can throw in some sandboxed contexts; ignore */
    }

    let alive = true;
    fetch("/api/user/subscription", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        setState(data as SubscriptionState);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!state || dismissed) return null;
  const decision = pickVariant(state);
  if (!decision) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  const { variant, daysLeft } = decision;
  const variantStyles: Record<BannerVariant, string> = {
    soft: "border-[var(--hold)]/40 bg-[var(--hold)]/10 text-foreground",
    urgent: "border-[var(--sell)]/40 bg-[var(--sell)]/10 text-foreground",
    expired: "border-[var(--sell)]/50 bg-[var(--sell)]/15 text-foreground",
    past_due: "border-[var(--sell)]/50 bg-[var(--sell)]/15 text-foreground",
  };
  const Icon =
    variant === "soft"
      ? Sparkles
      : variant === "urgent"
        ? Clock
        : AlertTriangle;
  const iconColor =
    variant === "soft" ? "text-[var(--hold)]" : "text-[var(--sell)]";

  // Most banner CTAs go DIRECT to Stripe Checkout (no /pricing detour)
  // — the user is already in-app, signed in, and has signaled intent
  // by reaching the banner. Only past_due routes through the Stripe
  // Portal instead (the user needs to update their card, which is a
  // portal flow, not a checkout flow). Expired-trial users still hit
  // checkout because they have no active subscription to manage.
  type CtaAction =
    | { kind: "checkout"; tier: "individual" | "active" }
    | { kind: "portal" };

  let message: React.ReactNode;
  let ctaLabel = "View plans";
  let ctaAction: CtaAction = { kind: "checkout", tier: "individual" };

  switch (variant) {
    case "soft":
      message = (
        <>
          <strong className="font-medium">
            {daysLeft} {daysLeft === 1 ? "day" : "days"} left
          </strong>{" "}
          in your free trial. Lock in founder pricing —{" "}
          <span className="font-mono">FOUNDER25</span> for 25% off your first year.
        </>
      );
      ctaLabel = "Lock in 25% off";
      ctaAction = { kind: "checkout", tier: "individual" };
      break;
    case "urgent":
      message = (
        <>
          <strong className="font-medium">Trial ends today.</strong>{" "}
          Upgrade with <span className="font-mono">FOUNDER25</span> before
          midnight to keep founder pricing.
        </>
      );
      ctaLabel = "Upgrade now";
      ctaAction = { kind: "checkout", tier: "individual" };
      break;
    case "expired":
      // Hard wall: post-trial users with no paid sub have no research
      // access. Banner messaging matches — we never had a "Free plan"
      // tier; trial → upgrade or stop.
      message = (
        <>
          <strong className="font-medium">Your trial has ended.</strong>{" "}
          Research access is paused until you upgrade.
        </>
      );
      ctaLabel = "Upgrade to continue";
      ctaAction = { kind: "checkout", tier: "individual" };
      break;
    case "past_due":
      message = (
        <>
          <strong className="font-medium">Last payment failed.</strong>{" "}
          Update your card to keep paid features active.
        </>
      );
      ctaLabel = "Update card";
      ctaAction = { kind: "portal" };
      break;
  }

  async function handleCta() {
    setBusy(true);
    setBusyError(null);
    try {
      const url =
        ctaAction.kind === "checkout"
          ? "/api/stripe/checkout"
          : "/api/stripe/portal";
      const body =
        ctaAction.kind === "checkout"
          ? JSON.stringify({ tier: ctaAction.tier, interval: "monthly" })
          : undefined;
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        // Fallback: route to /app/settings where the user can pick a
        // tier manually rather than getting stuck.
        setBusyError(data.error ?? "Could not start checkout");
        setBusy(false);
        window.location.href = "/app/settings";
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setBusyError("Network error");
      setBusy(false);
      window.location.href = "/app/settings";
    }
  }

  return (
    <div
      className={`flex items-center gap-3 border-b px-4 py-2 text-[13px] ${variantStyles[variant]}`}
      role="status"
    >
      <Icon className={`h-4 w-4 flex-shrink-0 ${iconColor}`} />
      <div className="min-w-0 flex-1">{message}</div>
      <button
        type="button"
        onClick={handleCta}
        disabled={busy}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1 text-[12px] font-semibold text-background transition-colors hover:bg-foreground/85 disabled:opacity-60"
        title={busyError ?? undefined}
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        {ctaLabel}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss banner"
        className="shrink-0 rounded-md p-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
