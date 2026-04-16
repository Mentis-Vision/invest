import { pool } from "./db";
import { log, errorInfo } from "./log";

/**
 * Per-user monthly usage + cost cap.
 *
 * Tracks tokens and estimated spend (in cents) per user. Cap values are
 * tier-based. On new month, the counters reset.
 *
 * Why cents (INTEGER) not dollars: avoid floating-point drift when
 * aggregating thousands of small spend increments.
 *
 * Model spend is ESTIMATED — pricing is approximate and per-provider. The
 * true invoice is the source of truth; this is a protective pre-check.
 */

export type Tier = "beta" | "individual" | "advisor";

export type TierLimits = {
  /** Max tokens in a calendar month (input + output combined). */
  maxTokens: number;
  /** Max spend in cents. Hit whichever cap comes first. */
  maxCostCents: number;
  /** Human-readable label. */
  label: string;
};

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  beta: {
    maxTokens: 500_000,
    maxCostCents: 200, // $2.00/mo — enough for ~50-100 research queries
    label: "Beta",
  },
  individual: {
    maxTokens: 5_000_000,
    maxCostCents: 2900, // $29 subscription — model spend budget matches
    label: "Individual",
  },
  advisor: {
    maxTokens: 50_000_000,
    maxCostCents: 50000, // enterprise / negotiated
    label: "Advisor",
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
};

export function estimateCostCents(model: string, tokens: number): number {
  const rate = PRICING_PER_1M_TOKENS_CENTS[model] ?? 800;
  return Math.ceil((tokens / 1_000_000) * rate);
}

export type UsageCheck =
  | { ok: true; tier: Tier; remainingTokens: number; remainingCents: number; resetAt: Date }
  | { ok: false; reason: "tokens" | "cost"; tier: Tier; resetAt: Date };

/**
 * Check if a user is under their monthly cap. Resets the counter lazily
 * if the reset timestamp has elapsed.
 */
export async function checkUsageCap(userId: string): Promise<UsageCheck> {
  try {
    const { rows } = await pool.query(
      `SELECT "tier", "monthlyTokens", "monthlyCostCents", "monthlyResetAt"
       FROM "user" WHERE id = $1`,
      [userId]
    );
    if (rows.length === 0) {
      return { ok: false, reason: "cost", tier: "beta", resetAt: new Date() };
    }

    const row = rows[0] as {
      tier: Tier;
      monthlyTokens: string | number;
      monthlyCostCents: number;
      monthlyResetAt: Date;
    };
    const tier = (row.tier ?? "beta") as Tier;
    const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.beta;
    const now = new Date();
    const resetAt = new Date(row.monthlyResetAt);

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
    return { ok: false, reason: "cost", tier: "beta", resetAt: new Date() };
  }
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
