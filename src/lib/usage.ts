import { pool } from "./db";
import { log, errorInfo } from "./log";
import { effectiveTierFor, getSubscription } from "./subscription";

/**
 * Per-user monthly usage + cost cap.
 *
 * Tracks tokens and estimated spend (in cents) per user. Cap values are
 * tier-based, sourced from `user_subscription` (the post-Stripe tier
 * source of truth). Counters reset on a rolling 30-day basis.
 *
 * Why cents (INTEGER) not dollars: avoid floating-point drift when
 * aggregating thousands of small spend increments.
 *
 * Model spend is ESTIMATED — pricing is approximate and per-provider. The
 * true invoice is the source of truth; this is a protective pre-check.
 *
 * Tier resolution: prior to the Stripe integration, `user.tier` was the
 * source of truth. Post-Stripe, paying customers' subscription state
 * lives in `user_subscription`; we resolve via `effectiveTierFor()`
 * here so a user upgrading via Checkout gets their new caps applied
 * immediately on the next API call (no separate sync step needed).
 *
 * Hard-wall tiers: "expired" (post-trial without paid sub) and
 * "past_due" (paid sub with failed renewal payment) both have zero
 * AI budget — every research call is rejected with reason="expired"
 * and the routes surface "trial ended, upgrade to continue" rather
 * than "you've hit your limit."
 */

export type Tier =
  | "trial"
  | "individual"
  | "active"
  | "advisor"
  | "expired"
  /** Legacy alias for "trial" — pre-Stripe user rows had tier='beta'.
   *  Map it to the same caps as trial so existing rows keep working. */
  | "beta";

export type TierLimits = {
  /** Max tokens in a calendar month (input + output combined). */
  maxTokens: number;
  /** Max spend in cents. Hit whichever cap comes first. */
  maxCostCents: number;
  /** Human-readable label. */
  label: string;
  /** Monthly subscription price in cents (0 for beta). */
  priceCents: number;
};

/**
 * Unified-B tier scheme. Each tier's AI budget is sized so:
 *   - All Quick Scans (~$0.004/run) → many thousand scans
 *   - Or all Full Panel runs ($0.21/run) → a sensible deep-dive allotment
 *   - Or any mix. The dollar cap enforces itself naturally; we don't
 *     need per-product quotas.
 *
 * AI budget = ~50% of subscription revenue (target gross margin on AI
 * only, before infra + fixed costs).
 */
export const TIER_LIMITS: Record<Tier, TierLimits> = {
  trial: {
    maxTokens: 500_000,
    // $2.00 AI budget — sized so the advertised pricing-page contract
    // ("100 quick reads · 10 deep reads · 3 panels per month") fits
    // with headroom: 100 × $0.004 + 10 × $0.06 + 3 × $0.21 = $1.63.
    // The remaining ~$0.37 is buffer for users who pick a slightly
    // heavier mix.
    maxCostCents: 200,
    label: "Free trial",
    priceCents: 0,
  },
  beta: {
    // Legacy alias for "trial" — pre-Stripe user rows that still
    // carry tier='beta' get the same budget as trial. New users get
    // tier='trial' via the subscription system.
    maxTokens: 500_000,
    maxCostCents: 200,
    label: "Free trial",
    priceCents: 0,
  },
  individual: {
    maxTokens: 5_000_000,
    maxCostCents: 1400, // $14 AI budget on a $29 price point
    label: "Individual",
    priceCents: 2900,
  },
  active: {
    maxTokens: 20_000_000,
    maxCostCents: 4000, // $40 AI budget on a $79 price point — portfolio builders
    label: "Active",
    priceCents: 7900,
  },
  advisor: {
    maxTokens: 50_000_000,
    maxCostCents: 25000, // $250 AI budget on $500 — effectively uncapped
    label: "Advisor",
    priceCents: 50000,
  },
  expired: {
    // Hard wall. Trial expired with no paid sub, OR a paid sub went
    // past_due — research access pauses until the user upgrades or
    // updates their card. Routes recognize this via the dedicated
    // reason="expired" field and show the right CTA copy.
    maxTokens: 0,
    maxCostCents: 0,
    label: "Trial ended",
    priceCents: 0,
  },
};

/**
 * Approximate model pricing per 1M tokens (blended input/output).
 * Source: public pricing pages, last validated 2026-04-15. Rounded up
 * to be conservative (we want to stop BEFORE we overspend).
 */
const PRICING_PER_1M_TOKENS_CENTS: Record<string, number> = {
  // Claude Sonnet 4.6: $3 in / $15 out → blend around $6/1M → 600¢
  claude: 600,
  // GPT-5.2: $5 in / $15 out → blend around $9/1M → 900¢
  gpt: 900,
  // Gemini 3 Pro: ~$5/$15 → 1000¢ (conservative)
  gemini: 1000,
  // Haiku (supervisor in rotation): $0.80 in / $4 out → 200¢
  haiku: 200,
  // Panel-consensus fast-path — no LLM call, no cost.
  none: 0,
};

export function estimateCostCents(model: string, tokens: number): number {
  const rate = PRICING_PER_1M_TOKENS_CENTS[model] ?? 800;
  return Math.ceil((tokens / 1_000_000) * rate);
}

export type UsageCheck =
  | { ok: true; tier: Tier; remainingTokens: number; remainingCents: number; resetAt: Date }
  | { ok: false; reason: "tokens" | "cost" | "expired"; tier: Tier; resetAt: Date };

/**
 * Resolve the user's effective tier from the subscription system.
 * Falls back to legacy `user.tier` if no subscription row exists yet
 * (users created before the Stripe integration). Always returns
 * something — we never throw, since downstream gating depends on
 * having a definitive tier value.
 */
async function resolveUserTier(userId: string): Promise<Tier> {
  try {
    const sub = await getSubscription(userId);
    if (sub) {
      const eff = effectiveTierFor(sub);
      // effectiveTierFor returns an EffectiveTier — every value is a
      // valid Tier in this module's union, so the cast is safe.
      return eff as Tier;
    }
  } catch (err) {
    // Subscription read failed — fall through to legacy path. Don't
    // hard-fail here; we'd rather let an existing customer hit their
    // legacy budget than block them entirely.
    log.warn("usage", "subscription read failed, falling back to user.tier", {
      userId,
      ...errorInfo(err),
    });
  }

  // Legacy path: read tier from user row. Pre-Stripe users had this set;
  // post-Stripe users won't (subscription is the source of truth) but
  // a stale `user.tier` value lingering doesn't hurt — it's only
  // consulted when the subscription read fails.
  try {
    const { rows } = await pool.query(
      `SELECT tier FROM "user" WHERE id = $1`,
      [userId]
    );
    const t = rows[0]?.tier;
    if (
      t === "trial" ||
      t === "beta" ||
      t === "individual" ||
      t === "active" ||
      t === "advisor" ||
      t === "expired"
    ) {
      return t;
    }
  } catch {
    /* fall through */
  }
  // Default to trial — the cheapest budget, least dangerous default.
  return "trial";
}

/**
 * Check if a user is under their monthly cap. Resets the counter lazily
 * if the reset timestamp has elapsed.
 *
 * Tier comes from `user_subscription` (post-Stripe source of truth) via
 * `effectiveTierFor()`. The token + cost counters still live on the
 * `user` row — they're per-user, not per-billing-cycle, and stay
 * authoritative across tier upgrades (an Individual subscriber's
 * counters carry over if they upgrade to Active mid-month).
 */
export async function checkUsageCap(userId: string): Promise<UsageCheck> {
  const tier = await resolveUserTier(userId);

  // Hard-wall tiers — short-circuit before touching counters. Routes
  // surface this with "trial ended, upgrade to continue" copy rather
  // than the generic "you hit your monthly limit" message.
  if (tier === "expired") {
    return { ok: false, reason: "expired", tier, resetAt: new Date() };
  }

  try {
    const { rows } = await pool.query(
      `SELECT "monthlyTokens", "monthlyCostCents", "monthlyResetAt"
       FROM "user" WHERE id = $1`,
      [userId]
    );
    if (rows.length === 0) {
      return { ok: false, reason: "cost", tier, resetAt: new Date() };
    }

    const row = rows[0] as {
      monthlyTokens: string | number;
      monthlyCostCents: number;
      monthlyResetAt: Date | null;
    };
    const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.trial;
    const now = new Date();
    // First-time users (post-Stripe) won't have monthlyResetAt set —
    // initialize it to "now + 30 days" implicitly by treating null as
    // an immediate reset trigger.
    const resetAt = row.monthlyResetAt
      ? new Date(row.monthlyResetAt)
      : new Date(0);

    // Rolling 30-day reset — resetAt is the boundary.
    if (now >= resetAt) {
      const nextReset = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await pool.query(
        `UPDATE "user"
         SET "monthlyTokens" = 0, "monthlyCostCents" = 0, "monthlyResetAt" = $1
         WHERE id = $2`,
        [nextReset, userId]
      );
      return {
        ok: true,
        tier,
        remainingTokens: limits.maxTokens,
        remainingCents: limits.maxCostCents,
        resetAt: nextReset,
      };
    }

    const tokensUsed = Number(row.monthlyTokens);
    const costUsed = Number(row.monthlyCostCents);

    if (tokensUsed >= limits.maxTokens) {
      return { ok: false, reason: "tokens", tier, resetAt };
    }
    if (costUsed >= limits.maxCostCents) {
      return { ok: false, reason: "cost", tier, resetAt };
    }

    return {
      ok: true,
      tier,
      remainingTokens: limits.maxTokens - tokensUsed,
      remainingCents: limits.maxCostCents - costUsed,
      resetAt,
    };
  } catch (err) {
    log.error("usage", "checkUsageCap failed", { userId, ...errorInfo(err) });
    // Fail closed on errors — we cannot verify the cap, so block.
    // Better to show an error than to accidentally burn the wallet.
    return { ok: false, reason: "cost", tier, resetAt: new Date() };
  }
}

/**
 * Format a 429-style JSON response for an over-cap or expired-tier
 * user. Routes that gate on `checkUsageCap` import this so the error
 * shape stays consistent across surfaces — the client-side handlers
 * branch on `error` to pick the right CTA copy.
 *
 * Three possible `error` values surface to the client:
 *   - "trial_ended"  — hard wall (expired trial, no paid sub).
 *                      CTA: "Upgrade to continue."
 *   - "past_due"     — paid sub with failed renewal payment.
 *                      CTA: "Update payment method."
 *   - "monthly_limit"— actual usage cap hit (tokens or cost).
 *                      CTA: "Resets [date]."
 *
 * Status code: 429 for monthly_limit, 402 (Payment Required) for the
 * billing-state errors. Distinguishing these in the wire status lets
 * client-side error handlers branch without parsing the JSON body.
 */
export function usageBlockedJson(check: Extract<UsageCheck, { ok: false }>): {
  body: Record<string, unknown>;
  status: number;
} {
  const limits = TIER_LIMITS[check.tier] ?? TIER_LIMITS.trial;

  if (check.reason === "expired") {
    // Differentiate trial-expired vs paid-but-past_due in copy.
    // Both currently return tier="expired" but a future refinement
    // could split them — leaving the door open here.
    return {
      body: {
        error: "trial_ended",
        message:
          "Your trial has ended. Upgrade to continue running research.",
        tier: check.tier,
      },
      status: 402,
    };
  }
  return {
    body: {
      error: "monthly_limit",
      message: `You've reached your monthly AI budget (${limits.label} tier). Resets ${check.resetAt.toISOString()}.`,
      tier: check.tier,
      resetAt: check.resetAt,
    },
    status: 429,
  };
}

/**
 * Record tokens + estimated cost against the user's counter.
 * Safe to call even if `tokens` is 0.
 */
export async function recordUsage(
  userId: string,
  model: string,
  tokens: number
): Promise<void> {
  if (!tokens || tokens <= 0) return;
  const costCents = estimateCostCents(model, tokens);
  try {
    await pool.query(
      `UPDATE "user"
       SET "monthlyTokens" = "monthlyTokens" + $1,
           "monthlyCostCents" = "monthlyCostCents" + $2
       WHERE id = $3`,
      [tokens, costCents, userId]
    );
  } catch (err) {
    log.error("usage", "recordUsage failed", {
      userId,
      model,
      tokens,
      ...errorInfo(err),
    });
  }
}

/**
 * Batch record — for runAnalystPanel which makes 3 concurrent calls.
 */
export async function recordBatchUsage(
  userId: string,
  items: Array<{ model: string; tokens: number }>
): Promise<void> {
  let totalTokens = 0;
  let totalCents = 0;
  for (const it of items) {
    if (!it.tokens || it.tokens <= 0) continue;
    totalTokens += it.tokens;
    totalCents += estimateCostCents(it.model, it.tokens);
  }
  if (totalTokens === 0) return;
  try {
    await pool.query(
      `UPDATE "user"
       SET "monthlyTokens" = "monthlyTokens" + $1,
           "monthlyCostCents" = "monthlyCostCents" + $2
       WHERE id = $3`,
      [totalTokens, totalCents, userId]
    );
  } catch (err) {
    log.error("usage", "recordBatchUsage failed", {
      userId,
      totalTokens,
      totalCents,
      ...errorInfo(err),
    });
  }
}
