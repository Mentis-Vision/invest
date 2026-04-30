import type Stripe from "stripe";
import { pool } from "./db";
import { stripe, type Tier } from "./stripe";
import { log, errorInfo } from "./log";

/**
 * Subscription / billing state.
 *
 * Schema lives in `user_subscription`. One row per user, lazily created
 * the first time the user lands in /app. Trial is tracked in our DB
 * (trialStartedAt / trialEndsAt) rather than as a Stripe subscription —
 * the no-credit-card trial means we don't have a customer yet, and
 * creating Stripe subscriptions without a payment method just to fail
 * conversion in 30 days is operational noise we don't need.
 *
 * When a user upgrades:
 *   1. We create a Stripe Customer (lazy, on first checkout).
 *   2. Checkout Session is created with the chosen price.
 *   3. After successful payment, the webhook updates this row's
 *      stripeSubscriptionId / tier / status / currentPeriodEnd.
 *
 * Trial-ending behavior: if the trial expires AND there's no paid
 * Stripe subscription, the user's effective tier becomes 'free'
 * (limited features). They can upgrade at any time to restore paid
 * tier access.
 */

export type SubscriptionTier = "trial" | "free" | "individual" | "active" | "advisor";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";

export type UserSubscription = {
  userId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  trialStartedAt: string;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Days of the no-card free trial. Source of truth for any UI that
 *  shows "X days left" — never hardcode 30 elsewhere. */
export const TRIAL_DAYS = 30;

/**
 * Lazy schema bootstrap. The codebase doesn't ship migration files —
 * tables are created out-of-band and referenced via raw SQL. Mirroring
 * that pattern, we ensure the subscription table exists on first use.
 *
 * IF NOT EXISTS makes this idempotent and safe to call repeatedly.
 * The first call after deploy creates the table; every subsequent call
 * is a no-op against the catalog.
 */
let _schemaEnsured = false;
async function ensureSchema(): Promise<void> {
  if (_schemaEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user_subscription" (
        "userId" TEXT PRIMARY KEY,
        "stripeCustomerId" TEXT UNIQUE,
        "stripeSubscriptionId" TEXT UNIQUE,
        tier TEXT NOT NULL DEFAULT 'trial',
        status TEXT NOT NULL DEFAULT 'trialing',
        "trialStartedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "trialEndsAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '${TRIAL_DAYS} days'),
        "currentPeriodEnd" TIMESTAMPTZ,
        "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    _schemaEnsured = true;
  } catch (err) {
    // Don't block requests if the schema bootstrap fails — the table
    // may already exist with a slightly different shape from manual
    // setup. Log and let the actual queries surface the real error.
    log.warn("subscription", "ensureSchema failed", errorInfo(err));
    _schemaEnsured = true;
  }
}

/**
 * Create the subscription row on first access (sign-in / first /app
 * load). Idempotent — safe to call on every authed page render. The
 * default trial timer starts NOW().
 */
export async function ensureSubscriptionRecord(userId: string): Promise<void> {
  await ensureSchema();
  try {
    await pool.query(
      `INSERT INTO "user_subscription" ("userId")
       VALUES ($1)
       ON CONFLICT ("userId") DO NOTHING`,
      [userId]
    );
  } catch (err) {
    log.warn("subscription", "ensureSubscriptionRecord failed", {
      userId,
      ...errorInfo(err),
    });
  }
}

export async function getSubscription(userId: string): Promise<UserSubscription | null> {
  await ensureSchema();
  try {
    const { rows } = await pool.query(
      `SELECT
         "userId",
         "stripeCustomerId",
         "stripeSubscriptionId",
         tier,
         status,
         "trialStartedAt",
         "trialEndsAt",
         "currentPeriodEnd",
         "cancelAtPeriodEnd",
         "createdAt",
         "updatedAt"
       FROM "user_subscription"
       WHERE "userId" = $1`,
      [userId]
    );
    if (rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    return {
      userId: r.userId as string,
      stripeCustomerId: (r.stripeCustomerId as string) ?? null,
      stripeSubscriptionId: (r.stripeSubscriptionId as string) ?? null,
      tier: r.tier as SubscriptionTier,
      status: r.status as SubscriptionStatus,
      trialStartedAt: (r.trialStartedAt as Date).toISOString(),
      trialEndsAt: (r.trialEndsAt as Date).toISOString(),
      currentPeriodEnd: r.currentPeriodEnd
        ? (r.currentPeriodEnd as Date).toISOString()
        : null,
      cancelAtPeriodEnd: !!r.cancelAtPeriodEnd,
      createdAt: (r.createdAt as Date).toISOString(),
      updatedAt: (r.updatedAt as Date).toISOString(),
    };
  } catch (err) {
    log.error("subscription", "getSubscription failed", {
      userId,
      ...errorInfo(err),
    });
    return null;
  }
}

/**
 * Compute the user's *effective* tier — what they actually have access
 * to right now. Distinct from `subscription.tier` because:
 *   - Trial users with an active timer have full feature access (we
 *     surface that as 'individual' for gating).
 *   - Trial users past their timer with no paid sub fall to 'free'.
 *   - Past-due / canceled paid users fall to 'free' until they upgrade.
 *
 * UIs that show "what tier am I on" still want the raw tier; gating
 * code wants this effective tier.
 */
/**
 * Effective tier — what gating logic should treat the user as right
 * now. Distinct from `subscription.tier` which records what the user
 * is *paying for* (or 'trial' if they haven't paid). Use this for
 * cap enforcement; use `subscription.tier` + status for billing UI.
 *
 * Hard wall: post-trial users with no paid sub get 'expired' here,
 * which usage.ts maps to zero AI budget. There's no "Free plan" with
 * limited research — trial expires → upgrade or stop.
 */
export type EffectiveTier =
  | "trial"
  | "individual"
  | "active"
  | "advisor"
  | "expired";

export function effectiveTierFor(sub: UserSubscription | null): EffectiveTier {
  if (!sub) return "expired";
  const now = Date.now();
  const trialEnd = new Date(sub.trialEndsAt).getTime();

  // Active paid subscription wins regardless of trial state.
  if (
    sub.status === "active" &&
    (sub.tier === "individual" ||
      sub.tier === "active" ||
      sub.tier === "advisor")
  ) {
    return sub.tier;
  }

  // Trial timer still running — apply the dedicated trial budget,
  // NOT individual. Previously returned 'individual' which over-
  // budgeted trial users by ~7× ($14 vs the intended $2 trial budget
  // sized to fit "100 quick / 10 deep / 3 panels per month").
  if (sub.tier === "trial" && trialEnd > now) {
    return "trial";
  }

  // Trial expired without upgrade, paid sub past_due, or paid sub
  // canceled. All collapse to the hard wall — research access pauses
  // until the user upgrades or updates their card.
  return "expired";
}

/** Minutes-until-trial-ends helper for UI banners. Returns 0 if expired. */
export function trialMinutesLeft(sub: UserSubscription | null): number {
  if (!sub) return 0;
  if (sub.tier !== "trial") return 0;
  const ms = new Date(sub.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 60_000));
}

/**
 * Get-or-create a Stripe customer for the user. Stripe customer is
 * lazy — created the first time the user starts checkout, never on
 * sign-up. Saves us paying for ghost-customer churn from sign-ups
 * that never convert.
 */
export async function ensureStripeCustomer(
  userId: string,
  email: string,
  name?: string | null
): Promise<string> {
  const sub = await getSubscription(userId);
  if (sub?.stripeCustomerId) return sub.stripeCustomerId;

  const customer = await stripe().customers.create({
    email,
    name: name ?? undefined,
    metadata: { userId },
  });

  await ensureSchema();
  await pool.query(
    `INSERT INTO "user_subscription" ("userId", "stripeCustomerId", "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("userId") DO UPDATE SET
       "stripeCustomerId" = EXCLUDED."stripeCustomerId",
       "updatedAt" = NOW()`,
    [userId, customer.id]
  );

  return customer.id;
}

/**
 * Apply a Stripe subscription event to our DB. Called from the webhook
 * for `customer.subscription.{created,updated,deleted}` and from
 * `checkout.session.completed`.
 *
 * We fetch the subscription fresh from Stripe rather than trusting the
 * webhook payload — webhook delivery can be out-of-order, and the API
 * always returns canonical state.
 */
export async function syncSubscriptionFromStripe(
  stripeSubscriptionId: string
): Promise<void> {
  const stripeSub = await stripe().subscriptions.retrieve(stripeSubscriptionId, {
    expand: ["items.data.price"],
  });

  const customerId =
    typeof stripeSub.customer === "string"
      ? stripeSub.customer
      : stripeSub.customer.id;

  // Find which user this customer belongs to. Two paths:
  //   1. Our DB (most common — we wrote it on customer creation).
  //   2. Stripe customer metadata.userId fallback.
  const { rows: userRows } = await pool.query(
    `SELECT "userId" FROM "user_subscription" WHERE "stripeCustomerId" = $1 LIMIT 1`,
    [customerId]
  );
  let userId: string | null = userRows[0]?.userId ?? null;
  if (!userId) {
    const customer = await stripe().customers.retrieve(customerId);
    if (
      customer &&
      !customer.deleted &&
      customer.metadata &&
      typeof customer.metadata.userId === "string"
    ) {
      userId = customer.metadata.userId;
    }
  }
  if (!userId) {
    log.warn("subscription", "syncSubscriptionFromStripe: no user for customer", {
      customerId,
      subscriptionId: stripeSubscriptionId,
    });
    return;
  }

  const tier = tierFromStripeSubscription(stripeSub);
  const status = mapStripeStatus(stripeSub.status);
  const currentPeriodEnd = stripeSub.current_period_end
    ? new Date(stripeSub.current_period_end * 1000)
    : null;

  await pool.query(
    `INSERT INTO "user_subscription"
       ("userId", "stripeCustomerId", "stripeSubscriptionId", tier, status,
        "currentPeriodEnd", "cancelAtPeriodEnd", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT ("userId") DO UPDATE SET
       "stripeCustomerId" = EXCLUDED."stripeCustomerId",
       "stripeSubscriptionId" = EXCLUDED."stripeSubscriptionId",
       tier = EXCLUDED.tier,
       status = EXCLUDED.status,
       "currentPeriodEnd" = EXCLUDED."currentPeriodEnd",
       "cancelAtPeriodEnd" = EXCLUDED."cancelAtPeriodEnd",
       "updatedAt" = NOW()`,
    [
      userId,
      customerId,
      stripeSub.id,
      tier,
      status,
      currentPeriodEnd,
      stripeSub.cancel_at_period_end,
    ]
  );
}

/**
 * Reverse-map a Stripe price ID back to our internal tier slug. Hits
 * env vars rather than hardcoding price IDs in the codebase, so the
 * mapping survives test-mode/live-mode swaps without code changes.
 */
function tierFromPriceId(priceId: string): SubscriptionTier {
  const map: Record<string, SubscriptionTier> = {};
  const tiers: Tier[] = ["individual", "active", "advisor"];
  for (const t of tiers) {
    const m = process.env[`STRIPE_PRICE_${t.toUpperCase()}_MONTHLY`];
    const a = process.env[`STRIPE_PRICE_${t.toUpperCase()}_ANNUAL`];
    if (m) map[m] = t;
    if (a) map[a] = t;
  }
  return map[priceId] ?? "free";
}

function tierFromStripeSubscription(
  sub: Stripe.Subscription
): SubscriptionTier {
  const item = sub.items.data[0];
  if (!item?.price?.id) return "free";
  return tierFromPriceId(item.price.id);
}

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "incomplete";
  }
}

