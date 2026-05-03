// src/lib/dashboard/queue-sources.ts
// Thin adapter layer between queue-builder.ts and the underlying data
// modules (portfolio-review, recommendation_outcome, holdings, ticker
// events, user_profile). Exposes the rich shape that queue-builder
// needs without modifying source modules.
//
// Tests mock this module directly so the queue-builder's composition
// logic can be exercised against arbitrary input shapes without standing
// up the full portfolio-review pipeline.

import { pool } from "../db";
import { log, errorInfo } from "../log";
import { getCachedPortfolioReview } from "../portfolio-review";
import { getPortfolioRisk } from "./metrics/risk-loader";
import { getUserGoals, type UserGoals } from "./goals-loader";

export interface ReviewBreach {
  ticker: string;
  weight: number;
  cap: number;
  nextEvent?: string | null;
  tradeQuality?: number;
}

export interface ReviewCatalyst {
  ticker: string;
  eventName: string | null;
  eventDate: string;
  daysToEvent: number;
  priorReaction?: string | null;
  currentPct?: number;
}

export interface ReviewStaleRec {
  ticker: string;
  recommendationId: string;
  daysAgo: number;
  moveSinceRec: string | number;
  originalVerdict: string;
  priceAtRec: number;
  isHeld: boolean;
}

export interface ReviewCashIdle {
  amount: number;
  daysIdle: number;
  numCandidates?: number;
}

export type BrokerStatus =
  | "active"
  | "reauth_required"
  | "disconnected"
  | "none";

export interface ReviewSummary {
  brokerStatus: BrokerStatus;
  brokerName?: string | null;
  holdings: Array<{ ticker: string; weight: number }>;
  concentrationBreaches: ReviewBreach[];
  upcomingCatalysts: ReviewCatalyst[];
  staleRecs: ReviewStaleRec[];
  cashIdle: ReviewCashIdle | null;
  portfolioYtdPct?: number;
  spyYtdPct?: number;
  /**
   * Phase 3 Batch F — share of portfolio (excluding cash) currently
   * allocated to stocks/equity, expressed as a whole-percent value
   * (0–100). `null` when the user has no holdings or all holdings are
   * non-stock asset classes; queue-builder gates rebalance_drift on
   * non-null + age + riskTolerance present.
   */
  stockAllocationPct: number | null;
  /**
   * Phase 3 Batch F — user goals row (target wealth, target date,
   * monthly contribution, current age, risk tolerance). All fields can
   * be null until the user fills out the GoalsForm. queue-builder uses
   * the absence of `targetWealth` to emit `goals_setup`.
   */
  goals: UserGoals | null;
}

export interface UnactionedOutcome {
  recommendationId: string;
  ticker: string;
  outcomeMove: number;
  outcomeVerdict: string;
  originalDate: string;
  originalVerdict: string;
}

const DEFAULT_CONCENTRATION_CAP_PCT = 5.0;
const STALE_REC_DAYS = 30;
const CATALYST_WINDOW_DAYS = 30;
const CASH_IDLE_MIN_AMOUNT = 500; // queue-builder also gates on >= 500
const CATALYST_EVENT_TYPES = ["earnings", "dividend_ex", "guidance"];

/**
 * Build the queue-builder's view of a user's portfolio state.
 *
 * Reads:
 *   - holdings (concentration weights, held tickers, cash bucket)
 *   - user_profile.concentration_cap_pct (default 5.00)
 *   - recommendation (stale recs)
 *   - ticker_events (upcoming catalysts on held tickers)
 *   - portfolio_snapshot (cash-idle days inferred from byAssetClass.cash)
 *   - plaid_item / snaptrade_connection (broker status)
 *
 * Cheap, read-only. No AI calls. Catches every block so a partial DB
 * failure can never knock out the whole dashboard.
 */
export async function getReviewSummary(
  userId: string,
): Promise<ReviewSummary | null> {
  const brokerStatus = await deriveBrokerStatus(userId);
  const review = await getCachedPortfolioReview(userId).catch(() => null);

  const [
    holdings,
    concentrationBreaches,
    staleRecs,
    upcomingCatalysts,
    cashIdle,
    risk,
    stockAllocationPct,
    goals,
  ] = await Promise.all([
    listHoldingsWithWeights(userId),
    listConcentrationBreaches(userId),
    listStaleRecs(userId),
    listUpcomingCatalysts(userId),
    deriveCashIdle(userId),
    // Phase 2 Batch A: pull portfolio + SPY YTD from the warehouse
    // risk loader. Wrapped in catch so a slow / failing loader never
    // breaks queue-builder — we fall back to undefined and the
    // year_pace_review template renders the existing 0.0% placeholder.
    getPortfolioRisk(userId).catch((err) => {
      log.warn("queue-sources", "risk-load-failed", {
        userId,
        ...errorInfo(err),
      });
      return null;
    }),
    // Phase 3 Batch F: stock allocation + goals row drive the
    // goals_setup / rebalance_drift queue items. Both are wrapped in
    // catch so a transient DB / loader failure never breaks the
    // dashboard render — they degrade to null and the queue-builder
    // skips the corresponding emitter.
    deriveStockAllocationPct(userId).catch((err) => {
      log.warn("queue-sources", "stock-allocation-load-failed", {
        userId,
        ...errorInfo(err),
      });
      return null;
    }),
    getUserGoals(userId).catch((err) => {
      log.warn("queue-sources", "goals-load-failed", {
        userId,
        ...errorInfo(err),
      });
      return null;
    }),
  ]);

  // Note: even with no broker / no holdings / no review, we still
  // return a summary because Phase 3 Batch F's `goals_setup` emit
  // depends on knowing whether the user has set targetWealth. The
  // queue-builder's other emitters all tolerate empty arrays / null
  // fields, so this is a safe relaxation of the previous early-return.

  // Convert the loader's fractional returns (0.052 = 5.2%) into the
  // percent-number shape the year_pace_review template expects —
  // headline-template.fmtSign treats numeric inputs as percents and
  // queue-builder's chip uses `.toFixed(1)` directly without
  // multiplying. `null` values fall through to undefined so the
  // template fallback to 0.0% still applies.
  const portfolioYtdPct =
    risk && Number.isFinite(risk.ytdPct) ? risk.ytdPct * 100 : undefined;
  const spyYtdPct =
    risk && Number.isFinite(risk.benchYtdPct)
      ? risk.benchYtdPct * 100
      : undefined;

  return {
    brokerStatus: brokerStatus.status,
    brokerName: brokerStatus.brokerName,
    holdings,
    concentrationBreaches,
    upcomingCatalysts,
    staleRecs,
    cashIdle,
    portfolioYtdPct,
    spyYtdPct,
    stockAllocationPct,
    goals,
  };
}

/**
 * Share of NON-CASH portfolio value currently held in equity asset
 * classes ('stock', 'equity', 'etf'), as a whole-percent number on
 * 0–100. We treat 'etf' as stock-equivalent because all the broad-market
 * holdings the user actually carries (SPY/VOO/VTI) are equity ETFs;
 * crypto is excluded so a Bitcoin sleeve doesn't artificially inflate
 * the stock-side drift figure.
 *
 * Returns null when the user has no holdings (or only cash) — caller
 * uses the null to skip the rebalance_drift emit entirely.
 */
async function deriveStockAllocationPct(
  userId: string,
): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ pct: string | number | null }>(
      `SELECT (SUM(CASE WHEN "assetClass" IN ('stock', 'equity', 'etf')
                        THEN COALESCE("lastValue", 0) ELSE 0 END)
               / NULLIF(SUM(COALESCE("lastValue", 0)), 0) * 100)::float
              AS pct
         FROM "holding"
        WHERE "userId" = $1
          AND "assetClass" IS DISTINCT FROM 'cash'`,
      [userId],
    );
    const pctRaw = rows[0]?.pct;
    if (pctRaw === null || pctRaw === undefined) return null;
    const pct = Number(pctRaw);
    return Number.isFinite(pct) ? pct : null;
  } catch (err) {
    log.warn("queue-sources", "deriveStockAllocationPct failed", {
      userId,
      ...errorInfo(err),
    });
    return null;
  }
}

async function deriveBrokerStatus(
  userId: string,
): Promise<{ status: BrokerStatus; brokerName: string | null }> {
  try {
    const { rows: plaidItems } = await pool.query<{
      status: string;
      institutionName: string | null;
    }>(
      `SELECT status, "institutionName"
         FROM "plaid_item"
        WHERE "userId" = $1 AND status <> 'removed'
        ORDER BY "createdAt" DESC`,
      [userId],
    );

    const reauth = plaidItems.find((p) => p.status === "login_required");
    if (reauth) {
      return {
        status: "reauth_required",
        brokerName: reauth.institutionName,
      };
    }

    const { rows: snaptrade } = await pool.query<{ id: string }>(
      `SELECT id FROM "snaptrade_connection" WHERE "userId" = $1 LIMIT 1`,
      [userId],
    );

    if (plaidItems.length === 0 && snaptrade.length === 0) {
      return { status: "none", brokerName: null };
    }
    return {
      status: "active",
      brokerName: plaidItems[0]?.institutionName ?? null,
    };
  } catch (err) {
    log.warn("queue-sources", "deriveBrokerStatus failed", {
      userId,
      ...errorInfo(err),
    });
    return { status: "none", brokerName: null };
  }
}

/**
 * One row per (ticker) summed across accounts, weighted against the
 * user's NON-CASH portfolio total. Same convention `alerts.ts` uses for
 * concentration scoring — cash buckets are excluded so a position's
 * weight reflects its share of invested capital, not gross balance.
 */
async function listHoldingsWithWeights(
  userId: string,
): Promise<Array<{ ticker: string; weight: number }>> {
  try {
    const { rows } = await pool.query<{
      ticker: string;
      weightPct: string | number | null;
    }>(
      `WITH totals AS (
         SELECT SUM(COALESCE("lastValue", 0)) AS total
           FROM "holding"
          WHERE "userId" = $1
            AND "assetClass" IS DISTINCT FROM 'cash'
       ),
       per_ticker AS (
         SELECT ticker, SUM(COALESCE("lastValue", 0)) AS value
           FROM "holding"
          WHERE "userId" = $1
            AND "assetClass" IS DISTINCT FROM 'cash'
          GROUP BY ticker
       )
       SELECT p.ticker AS ticker,
              (p.value / NULLIF(t.total, 0) * 100) AS "weightPct"
         FROM per_ticker p, totals t
        WHERE p.value > 0
        ORDER BY p.value DESC`,
      [userId],
    );
    return rows
      .map((r) => ({
        ticker: r.ticker,
        weight: r.weightPct === null ? 0 : Number(r.weightPct),
      }))
      .filter((h) => Number.isFinite(h.weight));
  } catch (err) {
    log.warn("queue-sources", "listHoldingsWithWeights failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Concentration breaches: positions whose share of NON-CASH portfolio
 * value exceeds the user's `user_profile.concentration_cap_pct`
 * (default 5.00). Severe vs moderate is decided in queue-builder by
 * comparing weight/cap ratio, so this only emits the raw breach.
 */
async function listConcentrationBreaches(
  userId: string,
): Promise<ReviewBreach[]> {
  try {
    const { rows: profileRows } = await pool.query<{
      capPct: string | number | null;
    }>(
      `SELECT concentration_cap_pct AS "capPct"
         FROM "user_profile"
        WHERE "userId" = $1
        LIMIT 1`,
      [userId],
    );
    const capRaw = profileRows[0]?.capPct;
    const cap =
      capRaw === null || capRaw === undefined
        ? DEFAULT_CONCENTRATION_CAP_PCT
        : Number(capRaw);
    const safeCap = Number.isFinite(cap) && cap > 0
      ? cap
      : DEFAULT_CONCENTRATION_CAP_PCT;

    const holdings = await listHoldingsWithWeights(userId);
    return holdings
      .filter((h) => h.weight > safeCap)
      .map((h) => ({
        ticker: h.ticker,
        weight: Number(h.weight.toFixed(2)),
        cap: safeCap,
      }));
  } catch (err) {
    log.warn("queue-sources", "listConcentrationBreaches failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Recommendations whose latest version per ticker is older than 30
 * days. moveSinceRec compares priceAtRec to the warehouse close (no
 * Yahoo live calls — too expensive on a page load). When the warehouse
 * has no current close, moveSinceRec is "flat".
 *
 * isHeld: EXISTS check against the holding table. We dedupe accounts by
 * using EXISTS instead of a JOIN, which would multiply rows when the
 * user holds the same ticker in multiple accounts.
 */
async function listStaleRecs(userId: string): Promise<ReviewStaleRec[]> {
  try {
    const { rows } = await pool.query<{
      recommendationId: string;
      ticker: string;
      recommendation: string;
      priceAtRec: string | number;
      createdAt: Date;
      daysAgo: string | number;
      isHeld: boolean;
    }>(
      `WITH latest AS (
         SELECT DISTINCT ON ("userId", ticker)
                id, "userId", ticker, recommendation, "priceAtRec", "createdAt"
           FROM "recommendation"
          WHERE "userId" = $1
          ORDER BY "userId", ticker, "createdAt" DESC
       )
       SELECT l.id            AS "recommendationId",
              l.ticker         AS ticker,
              l.recommendation AS recommendation,
              l."priceAtRec"   AS "priceAtRec",
              l."createdAt"    AS "createdAt",
              EXTRACT(DAY FROM NOW() - l."createdAt")::int AS "daysAgo",
              EXISTS (
                SELECT 1 FROM "holding" h
                 WHERE h."userId" = l."userId"
                   AND UPPER(h.ticker) = UPPER(l.ticker)
              ) AS "isHeld"
         FROM latest l
        WHERE l."createdAt" < NOW() - INTERVAL '${STALE_REC_DAYS} days'
        ORDER BY l."createdAt" ASC
        LIMIT 25`,
      [userId],
    );

    if (rows.length === 0) return [];

    // Pull warehouse close for moveSinceRec — single batch read, no
    // network. If a ticker has no warehouse row, moveSinceRec stays
    // "flat" rather than blocking the queue.
    const tickers = [...new Set(rows.map((r) => r.ticker))];
    const { getTickerMarketBatch } = await import("../warehouse/market");
    const marketMap = await getTickerMarketBatch(tickers).catch(() => new Map());

    return rows.map((r) => {
      const priceAtRec = Number(r.priceAtRec);
      const close = marketMap.get(r.ticker.toUpperCase())?.close ?? null;
      let moveSinceRec: string | number = "flat";
      if (
        close !== null &&
        Number.isFinite(close) &&
        Number.isFinite(priceAtRec) &&
        priceAtRec > 0
      ) {
        const pct = ((close - priceAtRec) / priceAtRec) * 100;
        moveSinceRec = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
      }
      return {
        ticker: r.ticker,
        recommendationId: r.recommendationId,
        daysAgo: Number(r.daysAgo),
        moveSinceRec,
        originalVerdict: r.recommendation ?? "HOLD",
        priceAtRec,
        isHeld: r.isHeld === true,
      };
    });
  } catch (err) {
    log.warn("queue-sources", "listStaleRecs failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Upcoming catalysts on user-held tickers from the warehouse
 * `ticker_events` table. Held set is sourced from the holding table to
 * keep the catalyst surface anchored to positions the user actually
 * cares about. Window is the next 30 days; event types restricted to
 * earnings / dividend_ex / guidance (the noise-to-signal cuts).
 */
async function listUpcomingCatalysts(
  userId: string,
): Promise<ReviewCatalyst[]> {
  try {
    const { rows } = await pool.query<{
      ticker: string;
      eventType: string;
      eventDate: Date;
      details: Record<string, unknown> | null;
      daysToEvent: string | number;
    }>(
      `WITH user_tickers AS (
         SELECT DISTINCT UPPER(ticker) AS ticker
           FROM "holding"
          WHERE "userId" = $1
            AND "assetClass" IS DISTINCT FROM 'cash'
       )
       SELECT e.ticker      AS ticker,
              e.event_type  AS "eventType",
              e.event_date  AS "eventDate",
              e.details     AS details,
              (e.event_date - CURRENT_DATE)::int AS "daysToEvent"
         FROM "ticker_events" e
         JOIN user_tickers u ON u.ticker = e.ticker
        WHERE e.event_date >= CURRENT_DATE
          AND e.event_date <= CURRENT_DATE + INTERVAL '${CATALYST_WINDOW_DAYS} days'
          AND e.event_type = ANY($2)
        ORDER BY e.event_date ASC
        LIMIT 25`,
      [userId, CATALYST_EVENT_TYPES],
    );

    return rows.map((r) => {
      const dateStr =
        r.eventDate instanceof Date
          ? r.eventDate.toISOString().slice(0, 10)
          : String(r.eventDate).slice(0, 10);
      const dte = Number(r.daysToEvent);
      const eventName =
        r.eventType === "earnings"
          ? "earnings"
          : r.eventType === "dividend_ex"
            ? "ex-dividend"
            : r.eventType === "guidance"
              ? "guidance"
              : r.eventType;
      return {
        ticker: r.ticker,
        eventName,
        eventDate: dateStr,
        daysToEvent: Number.isFinite(dte) ? dte : 0,
      };
    });
  } catch (err) {
    log.warn("queue-sources", "listUpcomingCatalysts failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Cash-idle inference. We pull the most-recent `portfolio_snapshot`
 * row's `byAssetClass.cash` bucket and use the longest run of
 * consecutive snapshots where cash >= the current bucket * 0.9 (i.e.
 * "cash has been roughly this high for N days") as the daysIdle hint.
 *
 * If there is no snapshot history yet (new user) or `byAssetClass.cash`
 * is absent, returns null. This is correct — queue-builder gates on
 * non-null AND amount >= 500 AND daysIdle >= 14, so the cash_idle item
 * simply doesn't surface for users with no signal yet.
 */
async function deriveCashIdle(
  userId: string,
): Promise<ReviewCashIdle | null> {
  try {
    const { rows } = await pool.query<{
      capturedAt: Date;
      cashAmount: string | number | null;
    }>(
      `SELECT "capturedAt",
              ("byAssetClass" ->> 'cash')::numeric AS "cashAmount"
         FROM "portfolio_snapshot"
        WHERE "userId" = $1
          AND "byAssetClass" ? 'cash'
        ORDER BY "capturedAt" DESC
        LIMIT 60`,
      [userId],
    );
    if (rows.length === 0) return null;
    const latestRaw = rows[0]?.cashAmount;
    if (latestRaw === null || latestRaw === undefined) return null;
    const latest = Number(latestRaw);
    if (!Number.isFinite(latest) || latest < CASH_IDLE_MIN_AMOUNT) return null;

    const floor = latest * 0.9;
    let daysIdle = 0;
    for (const r of rows) {
      const v = r.cashAmount === null ? Number.NaN : Number(r.cashAmount);
      if (!Number.isFinite(v) || v < floor) break;
      daysIdle++;
    }
    return {
      amount: Math.round(latest),
      daysIdle,
      // numCandidates: we don't yet have a curated BUY-rated candidate
      // pool keyed to the user's sector budget. Passing 0 surfaces the
      // cash item without a misleading candidate count; the builder
      // template tolerates 0.
      numCandidates: 0,
    };
  } catch (err) {
    log.warn("queue-sources", "deriveCashIdle failed", {
      userId,
      ...errorInfo(err),
    });
    return null;
  }
}

/**
 * Recommendations whose latest evaluated outcome has not yet been
 * marked by the user (`recommendation.userAction IS NULL`). These
 * surface as "outcome_action_mark" items in the Decision Queue,
 * prompting the user to confirm whether they took/ignored the call.
 */
export async function listUnactionedOutcomes(
  userId: string,
): Promise<UnactionedOutcome[]> {
  try {
    const { rows } = await pool.query<{
      recommendationId: string;
      ticker: string;
      percentMove: string | number | null;
      verdict: string | null;
      createdAt: Date;
      recommendation: string;
    }>(
      `SELECT r.id              AS "recommendationId",
              r.ticker          AS ticker,
              r.recommendation  AS recommendation,
              r."createdAt"     AS "createdAt",
              o."percentMove"   AS "percentMove",
              o.verdict         AS verdict
         FROM "recommendation" r
         JOIN "recommendation_outcome" o ON o."recommendationId" = r.id
        WHERE r."userId" = $1
          AND r."userAction" IS NULL
          AND o.status = 'completed'
        ORDER BY o."evaluatedAt" DESC NULLS LAST
        LIMIT 25`,
      [userId],
    );
    return rows.map((r) => ({
      recommendationId: r.recommendationId,
      ticker: r.ticker,
      outcomeMove:
        r.percentMove !== null && r.percentMove !== undefined
          ? Number(r.percentMove) / 100
          : 0,
      outcomeVerdict: r.verdict ?? "scored",
      originalDate: r.createdAt
        ? r.createdAt.toISOString().slice(0, 10)
        : "earlier",
      originalVerdict: r.recommendation ?? "HOLD",
    }));
  } catch (err) {
    log.warn("queue-sources", "listUnactionedOutcomes failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}
