"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, Sparkles } from "lucide-react";

/**
 * Client tier grid with monthly/annual toggle + auth-aware CTAs.
 *
 * Server-side `pricing/page.tsx` knows whether the visitor is signed
 * in; it passes that bit through and we route the CTAs accordingly:
 *
 *   - Signed in → POST /api/stripe/checkout with {tier, interval} →
 *     redirect to the Stripe-hosted URL.
 *   - Signed out → Link to /sign-up. We don't try to thread the
 *     intended-tier through signup yet (would require a
 *     post-verification redirect flow). Users can upgrade from the
 *     billing card in /app/settings once they land.
 *
 * The Free-trial tier always routes to /sign-up regardless of auth
 * (an authed user already has a trial; the button is mostly a label
 * for unauthed visitors).
 */

export type TierDef = {
  slug: "trial" | "individual" | "active" | "advisor";
  name: string;
  sub: string;
  monthly: { price: string; priceSub: string };
  annual: { price: string; priceSub: string };
  /**
   * Subset of tiers that can be checkout-targeted. "trial" is the
   * sign-up funnel; "advisor" goes to mailto. Only "individual" and
   * "active" actually start a Stripe Checkout Session.
   */
  ctaKind: "trial" | "checkout" | "contact";
  accent?: "primary" | "secondary";
  /** Friendly badge — e.g. "Most investors", "Power users". */
  badge?: string;
  features: string[];
};

type Interval = "monthly" | "annual";

export default function PricingTiersClient({
  tiers,
  isAuthed,
}: {
  tiers: TierDef[];
  isAuthed: boolean;
}) {
  const [interval, setInterval] = useState<Interval>("monthly");
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleCheckout(tier: "individual" | "active") {
    setBusyTier(tier);
    setErr(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, interval }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setErr(data.error ?? "Could not start checkout. Try again.");
        setBusyTier(null);
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setErr("Network error. Try again.");
      setBusyTier(null);
    }
  }

  return (
    <>
      {/* Founder-pricing strip — encourages early-stage signups via a
          clear urgency lever without touching the public list price. */}
      <div className="mx-auto mb-10 flex max-w-2xl items-start gap-3 rounded-xl border border-[var(--buy)]/30 bg-[var(--buy)]/5 px-5 py-4 text-[13.5px]">
        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--buy)]" />
        <div>
          <div className="font-medium text-foreground">
            Founder pricing — first 30 days
          </div>
          <p className="mt-0.5 text-muted-foreground">
            Use code{" "}
            <span className="font-mono font-semibold text-foreground">
              FOUNDER25
            </span>{" "}
            at checkout to lock in 25% off forever. Available to anyone
            who upgrades within 30 days of signup.
          </p>
        </div>
      </div>

      {/* Annual / monthly toggle */}
      <div className="mb-8 flex items-center justify-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Billed:
        </span>
        <div
          className="inline-flex rounded-full border border-border bg-card p-0.5"
          role="tablist"
        >
          {(["monthly", "annual"] as const).map((opt) => {
            const active = interval === opt;
            return (
              <button
                key={opt}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setInterval(opt)}
                className={`rounded-full px-4 py-1.5 text-[12px] font-semibold capitalize transition-colors ${
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
        <span className="ml-1 rounded-md bg-[var(--buy)]/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--buy)]">
          Save ~17% annual
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {tiers.map((t) => {
          const priceBlock = interval === "annual" ? t.annual : t.monthly;
          const isBusy = busyTier === t.slug;
          return (
            <div
              key={t.slug}
              className={`relative rounded-xl border bg-card p-7 ${
                t.accent === "primary"
                  ? "border-[var(--buy)]/30 shadow-[0_4px_32px_-8px_rgba(45,95,63,0.15)]"
                  : t.accent === "secondary"
                    ? "border-[var(--decisive)]/30"
                    : "border-border"
              }`}
            >
              {t.badge && (
                <div
                  className={`absolute -top-3 left-6 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] ${
                    t.accent === "primary"
                      ? "bg-[var(--buy)] text-[var(--primary-foreground)]"
                      : t.accent === "secondary"
                        ? "bg-[var(--decisive)] text-white"
                        : "bg-foreground text-background"
                  }`}
                >
                  {t.badge}
                </div>
              )}
              <div className="mb-5">
                <h3 className="font-heading text-[22px] leading-tight">
                  {t.name}
                </h3>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  {t.sub}
                </p>
              </div>
              <div className="mb-5 border-y border-border py-5">
                <div className="font-heading text-[32px] leading-none tracking-tight">
                  {priceBlock.price}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {priceBlock.priceSub}
                </div>
              </div>
              <ul className="mb-6 space-y-2.5">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px]">
                    <Check
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--buy)]"
                      strokeWidth={2.5}
                    />
                    <span className="text-foreground/85 leading-snug">
                      {f}
                    </span>
                  </li>
                ))}
              </ul>
              {/* CTA */}
              {t.ctaKind === "contact" ? (
                <a
                  href="mailto:hello@clearpathinvest.app?subject=Advisor%20tier%20inquiry"
                  className="flex w-full items-center justify-center rounded-md border border-border bg-card px-4 py-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-secondary"
                >
                  Contact us
                </a>
              ) : t.ctaKind === "trial" ? (
                <Link
                  href="/sign-up?src=pricing-trial"
                  className="flex w-full items-center justify-center rounded-md bg-foreground px-4 py-2.5 text-[12px] font-semibold text-background transition-colors hover:bg-foreground/85"
                >
                  Start free trial
                </Link>
              ) : isAuthed ? (
                <button
                  type="button"
                  onClick={() =>
                    handleCheckout(t.slug as "individual" | "active")
                  }
                  disabled={busyTier !== null}
                  className="flex w-full items-center justify-center rounded-md bg-foreground px-4 py-2.5 text-[12px] font-semibold text-background transition-colors hover:bg-foreground/85 disabled:opacity-60"
                >
                  {isBusy && (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  )}
                  Upgrade to {t.name}
                </button>
              ) : (
                <Link
                  href={`/sign-up?src=pricing-${t.slug}-${interval}`}
                  className="flex w-full items-center justify-center rounded-md bg-foreground px-4 py-2.5 text-[12px] font-semibold text-background transition-colors hover:bg-foreground/85"
                >
                  Start with {t.name}
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {err && (
        <p className="mx-auto mt-6 max-w-md text-center text-[13px] text-destructive">
          {err}
        </p>
      )}
    </>
  );
}
