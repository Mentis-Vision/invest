// src/lib/dashboard/metrics/quality-loader.ts
//
// Reads up to three most-recent fiscal periods of ticker_fundamentals
// from the warehouse, normalizes them into the math-layer shapes, and
// returns the four quality scores.
//
// Schema notes (verified against the live warehouse on 2026-05-02):
//   * `ticker_fundamentals` only populates a subset of the fields the
//     full math layer would like to see. Specifically, retained
//     earnings, EBIT, market cap, current assets, current liabilities,
//     accounts receivable, depreciation, SG&A, total liabilities,
//     total equity, ROA, gross profit (always 0), and gross_margin
//     (always 0) are NOT in the warehouse today.
//   * That means in production today this loader can only fully
//     compute the Sloan accruals ratio. Piotroski runs at most ~3 of
//     9 checks (cfo>0, cfo>NI, no dilution) so its evaluable count
//     stays below the 5-of-9 floor → returns null. Altman and
//     Beneish each need ≥1 missing input, so they also return null.
//
//   That's the correct outcome — the math returns null on missing
//   data and the UI renders "—". When the warehouse expands its
//   fundamentals coverage, this loader will pick the new fields up
//   automatically because the mapping is field-by-field.
//
// Read-only access to ticker_fundamentals is fine here — the ticker
// is already known to belong to the user's holdings (caller side),
// and ticker_fundamentals itself has no userId column (warehouse
// rule #8).

import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  computeQualityScores,
  type FundamentalsCurrent,
  type FundamentalsPrior,
  type QualityScores,
} from "./quality";

interface FundamentalsRow {
  ticker: string;
  period_ending: Date | string;
  period_type: string;
  revenue: string | number | null;
  gross_profit: string | number | null;
  net_income: string | number | null;
  total_assets: string | number | null;
  total_liabilities: string | number | null;
  total_equity: string | number | null;
  total_debt: string | number | null;
  shares_outstanding: string | number | null;
  operating_cash_flow: string | number | null;
  current_ratio: string | number | null;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map a warehouse row into the FundamentalsCurrent shape. Anything
 * the warehouse doesn't track today is left as null — the math layer
 * gracefully degrades.
 *
 * gross_profit comes back as 0 on every row in the current warehouse
 * snapshot (Yahoo upstream issue, tracked separately). We treat 0 as
 * unknown because a real $0 gross profit is implausible for the
 * tickers we actually hold; this prevents the Piotroski gross-margin
 * check from always failing when it can't be meaningfully evaluated.
 */
function mapToCurrent(row: FundamentalsRow): FundamentalsCurrent {
  const gp = num(row.gross_profit);
  return {
    revenue: num(row.revenue),
    netIncome: num(row.net_income),
    grossProfit: gp === 0 ? null : gp,
    totalAssets: num(row.total_assets),
    totalLiabilities: num(row.total_liabilities),
    longTermDebt: num(row.total_debt),
    totalDebt: num(row.total_debt),
    currentAssets: null, // not in warehouse today
    currentLiabilities: null, // not in warehouse today
    cfo: num(row.operating_cash_flow),
    sharesOutstanding: num(row.shares_outstanding),
    // Beneish / Altman extras — not in the warehouse today
    retainedEarnings: null,
    ebit: null,
    marketCap: null,
    accountsReceivable: null,
    ppe: null,
    depreciation: null,
    sga: null,
  };
}

function mapToPrior(row: FundamentalsRow): FundamentalsPrior {
  const gp = num(row.gross_profit);
  return {
    revenue: num(row.revenue),
    netIncome: num(row.net_income),
    grossProfit: gp === 0 ? null : gp,
    totalAssets: num(row.total_assets),
    totalLiabilities: num(row.total_liabilities),
    longTermDebt: num(row.total_debt),
    totalDebt: num(row.total_debt),
    currentAssets: null,
    currentLiabilities: null,
    cfo: num(row.operating_cash_flow),
    sharesOutstanding: num(row.shares_outstanding),
    accountsReceivable: null,
    ppe: null,
    depreciation: null,
    sga: null,
  };
}

/**
 * Load up to three most-recent annual fiscal periods for `ticker`.
 * We prefer 'annual' rows because year-over-year comparison is the
 * Piotroski/Beneish convention — quarterly rows would distort the
 * indices via seasonality.
 *
 * Returns:
 *   - { current, prior, periodBeforePrior } when 3 periods are available
 *   - { current, prior, periodBeforePrior: null } when only 2 are
 *   - null when fewer than 2 annual rows exist
 */
export async function loadFundamentals(
  ticker: string,
): Promise<{
  current: FundamentalsCurrent;
  prior: FundamentalsPrior | null;
  periodBeforePrior: FundamentalsPrior | null;
} | null> {
  let rows: FundamentalsRow[] = [];
  try {
    const result = await pool.query<FundamentalsRow>(
      `SELECT ticker,
              period_ending,
              period_type,
              revenue,
              gross_profit,
              net_income,
              total_assets,
              total_liabilities,
              total_equity,
              total_debt,
              shares_outstanding,
              operating_cash_flow,
              current_ratio
         FROM ticker_fundamentals
        WHERE ticker = $1
          AND period_type = 'annual'
        ORDER BY period_ending DESC
        LIMIT 3`,
      [ticker.toUpperCase()],
    );
    rows = result.rows;
  } catch (err) {
    log.warn("dashboard.quality", "loadFundamentals failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }

  if (rows.length === 0) return null;

  const current = mapToCurrent(rows[0]);
  const prior = rows[1] ? mapToPrior(rows[1]) : null;
  const periodBeforePrior = rows[2] ? mapToPrior(rows[2]) : null;

  return { current, prior, periodBeforePrior };
}

/**
 * Compute QualityScores for a ticker. Returns null only when there
 * are zero annual rows in the warehouse for that ticker — partial
 * data still yields a partial QualityScores (with individual scores
 * set to null where their inputs aren't satisfied).
 */
export async function getQualityScores(
  ticker: string,
): Promise<QualityScores | null> {
  const data = await loadFundamentals(ticker);
  if (!data) return null;
  try {
    return computeQualityScores(
      data.current,
      data.prior,
      data.periodBeforePrior,
    );
  } catch (err) {
    log.warn("dashboard.quality", "compute-failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}
