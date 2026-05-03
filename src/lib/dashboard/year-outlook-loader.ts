// src/lib/dashboard/year-outlook-loader.ts
//
// Year-outlook-only DB readers. Kept separate from queue-sources.ts so
// the surface composes from typed primitives without dragging in the
// full review-summary build.
//
// Currently exposes:
//
//   - getStockAllocationPct(userId): non-cash share that's in equity
//     asset classes ('stock' | 'equity' | 'etf'), as a 0..100 percent.
//     Mirrors the private `deriveStockAllocationPct` in queue-sources
//     so the GlidepathVisualizer reads the same number the queue's
//     rebalance_drift item is built from. Returns null when the user
//     has no holdings (or only cash).
//
// All reads are wrapped in catches and degrade to null so a transient
// DB error never crashes the year-outlook render.

import { pool } from "../db";
import { log, errorInfo } from "../log";

export async function getStockAllocationPct(
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
    log.warn("year-outlook-loader", "getStockAllocationPct failed", {
      userId,
      ...errorInfo(err),
    });
    return null;
  }
}
