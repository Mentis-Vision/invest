import Stripe from "stripe";

/**
 * Server-only Stripe client.
 *
 * Lazily constructed so module import doesn't throw at build time when
 * STRIPE_SECRET_KEY isn't yet set (mirrors the lazy-Pool pattern in
 * src/lib/db.ts). Importing this module is cheap; calling stripe()
 * is what asserts the env var.
 */
let _stripe: Stripe | null = null;

export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  _stripe = new Stripe(key, {
    // Pin the API version explicitly. Stripe-managed API upgrades
    // mid-flight are exactly the kind of "everything broke at 3am for
    // no visible reason" risk pinning prevents.
    apiVersion: "2024-06-20",
    // Tag each request so Stripe's logs show the source.
    appInfo: { name: "ClearPath Invest" },
  });
  return _stripe;
}

/** True when Stripe is configured. UI surfaces gate "Upgrade" CTAs on this. */
export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Map our internal tier slugs to the Stripe Price IDs configured in env.
 * Each tier has both monthly and annual prices; the caller picks via the
 * `interval` arg.
 *
 * If a price ID is missing, the function returns null — callers should
 * surface a "this tier isn't available yet" error rather than crashing.
 */
export type Tier = "individual" | "active" | "advisor";
export type Interval = "monthly" | "annual";

export function priceIdFor(tier: Tier, interval: Interval): string | null {
  const key = `STRIPE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`;
  return process.env[key] ?? null;
}
