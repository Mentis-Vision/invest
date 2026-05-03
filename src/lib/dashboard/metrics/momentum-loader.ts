// src/lib/dashboard/metrics/momentum-loader.ts
//
// Reads up to ~13 months of daily closes from `ticker_market_daily`
// and returns the 12-1 momentum spread for the ticker.
//
// We pull 260 rows rather than exactly 252 because the warehouse can
// occasionally drop a non-trading day (holiday, halt) — the extra
// buffer keeps `compute12_1Momentum` from tipping into the
// insufficient-history branch on a one-day gap. The math layer
// references back from the end of the array, so longer series are
// safe.
//
// Returns null when:
//   * fewer than 252 rows exist for the ticker
//   * any of the reference closes is non-positive (handled in
//     compute12_1Momentum)
//   * the warehouse query fails (logged + null, never thrown)
//
// Privacy: ticker_market_daily has no userId column (warehouse
// rule #8). The caller in queue-builder is responsible for ensuring
// `ticker` is a held / watched symbol.

import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import { compute12_1Momentum } from "./momentum";

const ROW_LIMIT = 260;
const MIN_ROWS = 252;

interface PriceRow {
  close: string | number | null;
}

export async function getTickerMomentum(
  ticker: string,
): Promise<number | null> {
  let rows: PriceRow[] = [];
  try {
    // Pull the most recent ROW_LIMIT rows DESC, then reverse so the
    // math layer sees them oldest-first (today at the end of the
    // array). A plain ASC + LIMIT would grab the oldest rows in the
    // table, which is exactly the opposite of what we need.
    const result = await pool.query<PriceRow>(
      `SELECT close
         FROM (
           SELECT close, captured_at
             FROM "ticker_market_daily"
            WHERE ticker = $1
            ORDER BY captured_at DESC
            LIMIT $2
         ) recent
         ORDER BY captured_at ASC`,
      [ticker.toUpperCase(), ROW_LIMIT],
    );
    rows = result.rows;
  } catch (err) {
    log.warn("dashboard.momentum", "load failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }

  if (rows.length < MIN_ROWS) return null;

  const closes: number[] = [];
  for (const r of rows) {
    if (r.close === null || r.close === undefined) continue;
    const n = typeof r.close === "number" ? r.close : Number(r.close);
    if (!Number.isFinite(n) || n <= 0) continue;
    closes.push(n);
  }

  if (closes.length < MIN_ROWS) return null;
  return compute12_1Momentum(closes);
}
