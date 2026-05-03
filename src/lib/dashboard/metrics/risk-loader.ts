// src/lib/dashboard/metrics/risk-loader.ts
//
// Pulls aligned daily prices for a user's holdings + the SPY benchmark
// from the warehouse, builds weighted-portfolio + benchmark daily-return
// series, and runs them through computePortfolioRisk.
//
// Privacy invariant: this is a privileged read that touches `holding`
// to discover tickers, then queries `ticker_market_daily` with that
// ticker set. The warehouse table itself remains userId-free
// (warehouse rule #8). The loader is the bridge.
//
// Returns null when there are fewer than 20 aligned daily samples —
// metrics over very short windows are statistically meaningless and
// produce wild swings. Callers display "—" in that case.

import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import { computePortfolioRisk, type PortfolioRisk } from "./risk";
import { computeVaR, type VarResult } from "./var";

const BENCH_TICKER = "SPY";
const LOOKBACK_DAYS = 365;
const MIN_SAMPLES = 20;

interface HoldingRow {
  ticker: string;
  weight: number;
}

interface PriceRow {
  ticker: string;
  capturedAt: string;
  close: number | null;
}

/**
 * Load weighted daily returns for the user's portfolio and the SPY
 * benchmark, aligned by date.
 *
 * Holdings whose `lastValue` is null/zero are excluded. Cash buckets
 * (assetClass = 'cash') are excluded from both totals and weights so
 * the risk picture reflects invested capital, matching the convention
 * used in queue-sources.ts and alerts.ts.
 *
 * Returns equal-length arrays. Dates with missing data for any held
 * ticker or for SPY are skipped — the math expects a fully-aligned
 * series.
 */
export async function loadPortfolioDailyReturns(userId: string): Promise<{
  portfolio: number[];
  benchmark: number[];
  /** ISO date of the most recent aligned observation, or null when empty. */
  asOf: string | null;
}> {
  let holdingsRows: HoldingRow[] = [];
  try {
    const { rows } = await pool.query<{
      ticker: string;
      weight: string | number | null;
    }>(
      `WITH totals AS (
         SELECT SUM(COALESCE("lastValue", 0)) AS total
           FROM "holding"
          WHERE "userId" = $1
            AND "assetClass" IS DISTINCT FROM 'cash'
       )
       SELECT h.ticker AS ticker,
              (h."lastValue" / NULLIF(t.total, 0))::float AS weight
         FROM "holding" h, totals t
        WHERE h."userId" = $1
          AND h."assetClass" IS DISTINCT FROM 'cash'
          AND COALESCE(h."lastValue", 0) > 0`,
      [userId],
    );
    holdingsRows = rows
      .map((r) => ({
        ticker: r.ticker,
        weight: r.weight === null ? 0 : Number(r.weight),
      }))
      .filter((h) => Number.isFinite(h.weight) && h.weight > 0);
  } catch (err) {
    log.warn("dashboard.risk", "load holdings failed", {
      userId,
      ...errorInfo(err),
    });
    return { portfolio: [], benchmark: [], asOf: null };
  }

  if (holdingsRows.length === 0) {
    return { portfolio: [], benchmark: [], asOf: null };
  }

  const tickers = holdingsRows.map((h) => h.ticker.toUpperCase());
  const weightMap = new Map<string, number>();
  for (const h of holdingsRows) {
    weightMap.set(h.ticker.toUpperCase(), h.weight);
  }

  const allTickers = Array.from(new Set([...tickers, BENCH_TICKER]));

  let priceRows: PriceRow[] = [];
  try {
    const { rows } = await pool.query<{
      ticker: string;
      captured_at: Date | string;
      close: string | number | null;
    }>(
      `SELECT ticker, captured_at, close
         FROM "ticker_market_daily"
        WHERE ticker = ANY($1::text[])
          AND captured_at >= CURRENT_DATE - $2::int
        ORDER BY captured_at ASC`,
      [allTickers, LOOKBACK_DAYS],
    );
    priceRows = rows.map((r) => ({
      ticker: r.ticker,
      capturedAt:
        r.captured_at instanceof Date
          ? r.captured_at.toISOString().slice(0, 10)
          : String(r.captured_at).slice(0, 10),
      close: r.close === null ? null : Number(r.close),
    }));
  } catch (err) {
    log.warn("dashboard.risk", "load prices failed", {
      userId,
      ...errorInfo(err),
    });
    return { portfolio: [], benchmark: [], asOf: null };
  }

  // Pivot into date → (ticker → close)
  const byDate = new Map<string, Map<string, number>>();
  for (const row of priceRows) {
    if (row.close === null || !Number.isFinite(row.close) || row.close <= 0) {
      continue;
    }
    let dayMap = byDate.get(row.capturedAt);
    if (!dayMap) {
      dayMap = new Map();
      byDate.set(row.capturedAt, dayMap);
    }
    dayMap.set(row.ticker.toUpperCase(), row.close);
  }

  const dates = Array.from(byDate.keys()).sort();
  const portfolio: number[] = [];
  const benchmark: number[] = [];
  const usedDates: string[] = [];

  for (let i = 1; i < dates.length; i++) {
    const prevPrices = byDate.get(dates[i - 1]);
    const curPrices = byDate.get(dates[i]);
    if (!prevPrices || !curPrices) continue;

    let pRet = 0;
    let totalWeight = 0;
    for (const t of tickers) {
      const prev = prevPrices.get(t);
      const cur = curPrices.get(t);
      if (
        prev !== undefined &&
        cur !== undefined &&
        prev > 0 &&
        Number.isFinite(prev) &&
        Number.isFinite(cur)
      ) {
        const w = weightMap.get(t) ?? 0;
        pRet += w * ((cur - prev) / prev);
        totalWeight += w;
      }
    }
    if (totalWeight === 0) continue;

    const bPrev = prevPrices.get(BENCH_TICKER);
    const bCur = curPrices.get(BENCH_TICKER);
    if (
      bPrev === undefined ||
      bCur === undefined ||
      bPrev <= 0 ||
      !Number.isFinite(bPrev) ||
      !Number.isFinite(bCur)
    ) {
      continue;
    }
    const bRet = (bCur - bPrev) / bPrev;

    // Re-normalize the portfolio return to the weight that actually
    // had data on this date, so a missing-price gap doesn't shrink
    // the daily move toward zero.
    portfolio.push(pRet / totalWeight);
    benchmark.push(bRet);
    usedDates.push(dates[i]);
  }

  log.info("dashboard.risk", "loadPortfolioDailyReturns", {
    userId,
    holdingsCount: holdingsRows.length,
    samples: portfolio.length,
  });

  return {
    portfolio,
    benchmark,
    asOf: usedDates.length > 0 ? usedDates[usedDates.length - 1] : null,
  };
}

export interface PortfolioRiskWithAsOf extends PortfolioRisk {
  /** ISO date of the most recent observation in the sample. */
  asOf: string | null;
}

export interface VarResultWithAsOf extends VarResult {
  /** ISO date of the most recent observation in the sample. */
  asOf: string | null;
}

/**
 * Compute the full PortfolioRisk for a user. Returns null when the
 * sample window is too short for stable metrics (< 20 days).
 *
 * The returned object carries an asOf timestamp (latest aligned
 * observation) so tiles can surface freshness without re-querying
 * the warehouse.
 */
export async function getPortfolioRisk(
  userId: string,
): Promise<PortfolioRiskWithAsOf | null> {
  const { portfolio, benchmark, asOf } = await loadPortfolioDailyReturns(userId);
  if (portfolio.length < MIN_SAMPLES) return null;
  return { ...computePortfolioRisk(portfolio, benchmark), asOf };
}

/**
 * Compute the historical VaR / CVaR figures for a user. Reuses the
 * same daily-return loader as `getPortfolioRisk` so we don't pay for
 * a second round-trip to the warehouse on the dashboard render.
 * Returns null when the sample window is too short — the VarTile
 * renders "—" in that case.
 */
export async function getPortfolioVaR(
  userId: string,
): Promise<VarResultWithAsOf | null> {
  const { portfolio, asOf } = await loadPortfolioDailyReturns(userId);
  if (portfolio.length < MIN_SAMPLES) return null;
  const result = computeVaR(portfolio);
  if (!result) return null;
  return { ...result, asOf };
}

/**
 * Total invested capital — sum of `lastValue` across all non-cash
 * holdings. Used to convert fractional VaR into a dollar exposure
 * for the dashboard tile. Mirrors the convention in queue-sources
 * and alerts: cash buckets are excluded so the figure reflects
 * what's actually at risk in the market.
 *
 * Returns 0 for users with no holdings (or only cash). Never throws —
 * a transient DB error logs and returns 0 so a single failure here
 * doesn't take down the dashboard render.
 */
export async function getPortfolioValue(userId: string): Promise<number> {
  try {
    const { rows } = await pool.query<{ total: string | number | null }>(
      `SELECT COALESCE(SUM("lastValue"), 0) AS total
         FROM "holding"
        WHERE "userId" = $1
          AND "assetClass" IS DISTINCT FROM 'cash'`,
      [userId],
    );
    const total = Number(rows[0]?.total ?? 0);
    return Number.isFinite(total) ? total : 0;
  } catch (err) {
    log.warn("dashboard.risk", "getPortfolioValue failed", {
      userId,
      ...errorInfo(err),
    });
    return 0;
  }
}
