import { pool } from "./db";
import { log, errorInfo } from "./log";
import { getMacroSnapshot, formatMacroForAI } from "./data/fred";
import {
  runPortfolioPanel,
  runPortfolioSupervisor,
} from "./ai/portfolio-consensus";
import { recordBatchUsage, recordUsage } from "./usage";

/**
 * Shared portfolio-review pipeline.
 *
 * Why this exists:
 *   The same logic now runs from two places:
 *     1. POST /api/portfolio-review on demand (live)
 *     2. The nightly cron, which pre-computes the review for every
 *        connected user so first-login the next morning loads the
 *        stored result with zero AI cost.
 *
 *   Both call generatePortfolioReview(userId) and write to the same
 *   portfolio_review_daily cache. Both call getCachedPortfolioReview
 *   first to short-circuit when today's row already exists.
 *
 * Result shape mirrors the original ad-hoc payload shipped from the
 * route so existing UI consumers don't need to branch.
 */

export type PortfolioReviewResult = {
  holdingsCount: number;
  totalValue: number;
  analyses: Awaited<ReturnType<typeof runPortfolioPanel>>;
  supervisor: Awaited<ReturnType<typeof runPortfolioSupervisor>>["output"];
  supervisorModel: string;
  dataAsOf: string;
  tokensUsed: number;
  cached?: boolean;
  cachedAt?: string;
};

type HoldingRow = {
  ticker: string;
  shares: string | number;
  avgPrice: string | number | null;
  lastPrice: string | number | null;
  lastValue: string | number | null;
  costBasis: string | number | null;
  accountName: string | null;
  sector: string | null;
  industry: string | null;
};

/**
 * Read today's cached review for a user. Returns null when no row
 * for today exists. Yesterday's row never satisfies a cache lookup —
 * the warehouse refreshes overnight, so a same-calendar-day key is
 * the right freshness boundary.
 */
export async function getCachedPortfolioReview(
  userId: string
): Promise<PortfolioReviewResult | null> {
  try {
    const { rows } = await pool.query(
      `SELECT payload, "createdAt", "totalValueAtRun", "holdingsCount"
         FROM "portfolio_review_daily"
        WHERE "userId" = $1 AND "capturedAt" = CURRENT_DATE
        LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) return null;
    const r = rows[0] as {
      payload: Record<string, unknown>;
      createdAt: Date;
      totalValueAtRun: string;
      holdingsCount: number;
    };
    const payload = r.payload as Partial<PortfolioReviewResult>;
    return {
      holdingsCount: r.holdingsCount,
      totalValue: Number(r.totalValueAtRun ?? 0),
      analyses: payload.analyses ?? [],
      supervisor: payload.supervisor as PortfolioReviewResult["supervisor"],
      supervisorModel: payload.supervisorModel ?? "claude-haiku",
      dataAsOf: payload.dataAsOf ?? r.createdAt.toISOString(),
      tokensUsed: payload.tokensUsed ?? 0,
      cached: true,
      cachedAt: r.createdAt.toISOString(),
    };
  } catch (err) {
    log.warn("portfolio-review", "cache lookup failed", {
      userId,
      ...errorInfo(err),
    });
    return null;
  }
}

/**
 * Run the full portfolio review pipeline against a user's holdings,
 * persist the result to portfolio_review_daily, return it.
 *
 * Throws on no-holdings (caller decides whether to surface that as a
 * user-facing message or skip the user).
 *
 * Designed to be safe to call from the cron with no session — it only
 * touches the user's data via SQL and the AI calls are server-side.
 */
export async function generatePortfolioReview(
  userId: string
): Promise<PortfolioReviewResult> {
  const { rows } = await pool.query(
    `SELECT ticker, shares, "avgPrice", "lastPrice", "lastValue",
            "costBasis", "accountName", sector, industry
       FROM "holding"
      WHERE "userId" = $1
      ORDER BY COALESCE("lastValue", shares * COALESCE("lastPrice", "avgPrice", 0)) DESC`,
    [userId]
  );
  if (rows.length === 0) {
    throw new Error("no_holdings");
  }
  const holdings = rows as HoldingRow[];

  const { getTickerMarketBatch } = await import("./warehouse");
  const marketMap = await getTickerMarketBatch(
    holdings.map((h) => h.ticker)
  );

  const marketValue = (h: HoldingRow) => {
    const lv =
      h.lastValue !== null && h.lastValue !== undefined
        ? Number(h.lastValue)
        : 0;
    if (lv > 0) return lv;
    const shares = Number(h.shares);
    const price = Number(h.lastPrice ?? h.avgPrice ?? 0);
    return shares * price;
  };
  const totalValue = holdings.reduce((sum, h) => sum + marketValue(h), 0);
  const macro = await getMacroSnapshot();
  const dataAsOf = new Date().toISOString();

  const sectorBuckets = new Map<string, number>();
  let unclassified = 0;
  for (const h of holdings) {
    const v = marketValue(h);
    if (h.sector) {
      sectorBuckets.set(h.sector, (sectorBuckets.get(h.sector) ?? 0) + v);
    } else {
      unclassified += v;
    }
  }
  const sectorLines = [...sectorBuckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sector, value]) => {
      const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
      return `  - ${sector}: $${value.toFixed(2)} (${pct.toFixed(1)}%)`;
    });
  if (unclassified > 0) {
    const pct = totalValue > 0 ? (unclassified / totalValue) * 100 : 0;
    sectorLines.push(
      `  - Unclassified: $${unclassified.toFixed(2)} (${pct.toFixed(1)}%)`
    );
  }

  const dataBlock = [
    `PORTFOLIO SNAPSHOT (as of ${dataAsOf}):`,
    `Total positions: ${holdings.length}`,
    `Estimated market value: $${totalValue.toFixed(2)} USD`,
    ``,
    `SECTOR BREAKDOWN (by market value):`,
    ...(sectorLines.length > 0 ? sectorLines : ["  (no sector data available)"]),
    ``,
    `POSITIONS (sorted largest first, using last-synced price from brokerage):`,
    ...holdings.map((h) => {
      const shares = Number(h.shares);
      const current = Number(h.lastPrice ?? h.avgPrice ?? 0);
      const value = marketValue(h);
      const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
      const avgCost =
        h.avgPrice !== null && h.avgPrice !== undefined
          ? Number(h.avgPrice)
          : null;
      const costLabel =
        avgCost != null ? ` · avg cost $${avgCost.toFixed(2)}` : "";
      const sectorLabel = h.sector
        ? ` [${h.sector}${h.industry ? ` / ${h.industry}` : ""}]`
        : " [sector: unclassified]";
      const m = marketMap.get(h.ticker.toUpperCase());
      const mmPe =
        m?.peTrailing != null ? ` P/E ${m.peTrailing.toFixed(1)}` : "";
      const mmBeta = m?.beta != null ? ` β ${m.beta.toFixed(2)}` : "";
      return `- ${h.ticker}: ${shares} shares @ $${current.toFixed(2)}${costLabel} ≈ $${value.toFixed(2)} (${pct.toFixed(1)}% of portfolio)${sectorLabel}${mmPe}${mmBeta}${h.accountName ? ` {${h.accountName}}` : ""}`;
    }),
    ``,
    `NOTE: Prices are last-synced from the user's brokerage via SnapTrade; they may be intraday-stale.`,
    ``,
    formatMacroForAI(macro),
  ].join("\n");

  const analyses = await runPortfolioPanel(dataBlock);
  const supervisor = await runPortfolioSupervisor(dataBlock, analyses, dataAsOf);

  // Tally usage for accounting + cap enforcement.
  const analystTokens = analyses.reduce(
    (sum, a) => sum + (a.tokensUsed ?? 0),
    0
  );
  const supervisorTokens = supervisor.tokensUsed ?? 0;
  const totalTokens = analystTokens + supervisorTokens;

  const usageItems = analyses
    .filter((a) => a.tokensUsed)
    .map((a) => ({ model: a.model, tokens: a.tokensUsed ?? 0 }));
  recordBatchUsage(userId, usageItems).catch(() => {});
  if (supervisorTokens > 0) {
    recordUsage(userId, supervisor.pricingKey, supervisorTokens).catch(
      () => {}
    );
  }

  const result: PortfolioReviewResult = {
    holdingsCount: holdings.length,
    totalValue,
    analyses,
    supervisor: supervisor.output,
    supervisorModel: supervisor.supervisorModel,
    dataAsOf,
    tokensUsed: totalTokens,
  };

  // Persist for tomorrow's first-login cache hit.
  try {
    await pool.query(
      `INSERT INTO "portfolio_review_daily"
        ("userId", "capturedAt", "totalValueAtRun", "holdingsCount",
         payload, "tokensUsed")
       VALUES ($1, CURRENT_DATE, $2, $3, $4::jsonb, $5)
       ON CONFLICT ("userId", "capturedAt") DO UPDATE SET
         "totalValueAtRun" = EXCLUDED."totalValueAtRun",
         "holdingsCount" = EXCLUDED."holdingsCount",
         payload = EXCLUDED.payload,
         "tokensUsed" = EXCLUDED."tokensUsed",
         "createdAt" = NOW()`,
      [userId, totalValue, holdings.length, JSON.stringify(result), totalTokens]
    );
  } catch (err) {
    log.warn("portfolio-review", "save failed (returning result anyway)", {
      userId,
      ...errorInfo(err),
    });
  }

  return result;
}
