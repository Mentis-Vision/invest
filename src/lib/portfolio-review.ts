import { pool } from "./db";
import { log, errorInfo } from "./log";
import { getMacroSnapshot, formatMacroForAI } from "./data/fred";
import {
  runPortfolioPanel,
  runPortfolioSupervisor,
} from "./ai/portfolio-consensus";
import { recordBatchUsage, recordUsage } from "./usage";
import { sumMoney, normalizeWeights, percentOf } from "./money";

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

export type NextMoveState = "active" | "done" | "snoozed" | "dismissed";

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
  /** User's action on today's Next Move hero — null when untouched. */
  nextMoveState?: NextMoveState | null;
  nextMoveStateAt?: string | null;
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
      `SELECT payload, "createdAt", "totalValueAtRun", "holdingsCount",
              "nextMoveState", "nextMoveStateAt"
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
      nextMoveState: NextMoveState | null;
      nextMoveStateAt: Date | null;
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
      nextMoveState: r.nextMoveState ?? null,
      nextMoveStateAt: r.nextMoveStateAt?.toISOString() ?? null,
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
 * Diagnose why a user's holdings are empty — so the UI can show an
 * honest, specific message instead of a generic "connect your broker"
 * when in fact the user just linked one and sync is in progress.
 *
 * States (ordered by priority):
 *   - "syncing" — a brokerage Item was linked within the last 5 min
 *                 and holdings haven't landed yet. Client should poll.
 *   - "needs_reauth" — a Plaid Item is in login_required state.
 *                      User needs to click through the re-auth flow.
 *   - "empty_brokerage" — Items synced successfully but zero positions
 *                         came back (e.g., cash-only account, or the
 *                         brokerage returned nothing). Rare.
 *   - "none" — user has no active brokerage connections at all.
 */
export type EmptyHoldingsState =
  | { state: "none"; message: string }
  | {
      state: "syncing";
      message: string;
      institutionName: string | null;
      retryAfterSec: number;
    }
  | {
      state: "needs_reauth";
      message: string;
      institutionName: string | null;
      itemId: string;
    }
  | {
      state: "empty_brokerage";
      message: string;
      institutionName: string | null;
    };

const SYNC_GRACE_WINDOW_MS = 5 * 60 * 1000; // 5 min since link = still syncing

export async function diagnoseEmptyHoldings(
  userId: string
): Promise<EmptyHoldingsState> {
  // Pull Plaid Items sorted by most-recently-created.
  const { rows: plaidItems } = await pool.query<{
    itemId: string;
    status: string;
    statusDetail: string | null;
    institutionName: string | null;
    createdAt: Date;
    lastSyncedAt: Date | null;
  }>(
    `SELECT "itemId", status, "statusDetail", "institutionName",
            "createdAt", "lastSyncedAt"
       FROM "plaid_item"
      WHERE "userId" = $1 AND status <> 'removed'
      ORDER BY "createdAt" DESC`,
    [userId]
  );

  // Any Item stuck in login_required wins — the user needs to act.
  const reauth = plaidItems.find((p) => p.status === "login_required");
  if (reauth) {
    return {
      state: "needs_reauth",
      institutionName: reauth.institutionName,
      itemId: reauth.itemId,
      message: reauth.institutionName
        ? `Your ${reauth.institutionName} connection needs to be refreshed. Reconnect to resume syncing.`
        : "Your brokerage connection needs to be refreshed. Reconnect to resume syncing.",
    };
  }

  // If any Item was created within the sync grace window, treat as syncing.
  const now = Date.now();
  const recentItem = plaidItems.find(
    (p) => now - p.createdAt.getTime() < SYNC_GRACE_WINDOW_MS
  );
  if (recentItem) {
    return {
      state: "syncing",
      institutionName: recentItem.institutionName,
      retryAfterSec: 15,
      message: recentItem.institutionName
        ? `Syncing your ${recentItem.institutionName} holdings — usually 30 seconds, sometimes up to 2 minutes.`
        : "Syncing your holdings — usually 30 seconds, sometimes up to 2 minutes.",
    };
  }

  // Check SnapTrade connections too — same grace-window logic.
  const { rows: snaptrade } = await pool.query<{ createdAt: Date }>(
    `SELECT "createdAt"
       FROM "snaptrade_connection"
      WHERE "userId" = $1
      ORDER BY "createdAt" DESC
      LIMIT 1`,
    [userId]
  );
  if (snaptrade.length > 0) {
    const recent = now - snaptrade[0].createdAt.getTime() < SYNC_GRACE_WINDOW_MS;
    if (recent) {
      return {
        state: "syncing",
        institutionName: null,
        retryAfterSec: 15,
        message:
          "Syncing your holdings — usually 30 seconds, sometimes up to 2 minutes.",
      };
    }
  }

  // Has a linked brokerage, sync is old, still no holdings.
  if (plaidItems.length > 0 || snaptrade.length > 0) {
    const name = plaidItems[0]?.institutionName ?? null;
    return {
      state: "empty_brokerage",
      institutionName: name,
      message: name
        ? `We connected to ${name} but haven't received any holdings yet. If you recently moved money in, try refreshing in a few minutes — otherwise contact support@clearpathinvest.app.`
        : "We're connected to your brokerage but haven't received any holdings yet. If you recently moved money in, try refreshing in a few minutes — otherwise contact support@clearpathinvest.app.",
    };
  }

  return {
    state: "none",
    message:
      "Connect a brokerage to get started — we'll analyze your holdings and surface opportunities within a few minutes.",
  };
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
  // sumMoney rounds each addend to cents before accumulating so the
  // total matches the brokerage's reported total at the cent level
  // instead of drifting by fractions-of-a-cent across N positions.
  // This totalValue is persisted as portfolio_review_daily.totalValueAtRun
  // and fed into the AI prompt, so precision matters for both user
  // trust and LLM-facing consistency.
  const perHoldingValues = holdings.map(marketValue);
  const totalValue = sumMoney(...perHoldingValues);
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

  // Build an ordered sector list first (largest first, unclassified last),
  // then run one normalizeWeights pass so the percentages sum to EXACTLY
  // 100 in the AI prompt — otherwise the model can be forgiven for
  // double-checking our math, wasting tokens on a non-issue.
  const sortedSectors = [...sectorBuckets.entries()].sort(
    (a, b) => b[1] - a[1]
  );
  const sectorValues: number[] = sortedSectors.map(([, v]) => v);
  if (unclassified > 0) sectorValues.push(unclassified);
  const sectorPcts = normalizeWeights(sectorValues, 1);
  const sectorLines: string[] = sortedSectors.map(([sector, value], idx) => {
    return `  - ${sector}: $${sumMoney(value).toFixed(2)} (${sectorPcts[idx].toFixed(1)}%)`;
  });
  if (unclassified > 0) {
    const idx = sectorPcts.length - 1;
    sectorLines.push(
      `  - Unclassified: $${sumMoney(unclassified).toFixed(2)} (${sectorPcts[idx].toFixed(1)}%)`
    );
  }

  // Per-position percentages use single-divide percentOf rather than
  // normalizeWeights — positions are already sorted largest-first and
  // rounding to 1dp across 50 positions would land close enough that
  // enforcing exact-100 would mask real concentration signals. The
  // visible totalValue above is exact, so per-position rounding drift
  // is invisible to users.
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
      const pct = percentOf(value, totalValue, 1);
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
