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
//   - getActualAllocationSplit(userId): Phase 4 Batch I. Returns a
//     stocks / bonds / cash triple computed by classifying each ticker
//     through asset-class-map.ts so bond ETFs (TLT, AGG, …) actually
//     count as bonds and gold / commodity ETFs (GLD, SLV, …) bucket
//     into stocks. Returns null when the user has no holdings.
//
// All reads are wrapped in catches and degrade to null so a transient
// DB error never crashes the year-outlook render.

import { pool } from "../db";
import { log, errorInfo } from "../log";
import { classifyTicker } from "./asset-class-map";
import type { TargetAllocation } from "./goals";

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

interface HoldingValueRow {
  ticker: string;
  assetClass: string | null;
  lastValue: string | number | null;
}

/**
 * Compute the user's actual allocation split using ticker-aware
 * classification. Bond ETFs and commodity ETFs are detected via the
 * static map in `asset-class-map.ts`; everything else falls through
 * to the row's `assetClass`.
 *
 * Mapping into the {stocksPct, bondsPct, cashPct} triple consumed by
 * the glidepath visualizer:
 *   stocksPct  = stock + etf + commodity + crypto + unknown
 *   bondsPct   = bond
 *   cashPct    = cash
 *
 * Commodities and crypto roll into stocks because the target side of
 * the donut only carries stocks/bonds/cash — splitting four ways here
 * would compare apples to oranges. The honest signal is that bond
 * exposure and cash drag are now real numbers instead of modeled
 * proxies. Donut still sums to 100.
 *
 * Returns null when the user has no holdings or all rows have
 * `lastValue` null. Returns zero-everywhere when the user holds only
 * untracked positions (shouldn't happen in practice — defensive).
 */
export async function getActualAllocationSplit(
  userId: string,
): Promise<TargetAllocation | null> {
  try {
    const { rows } = await pool.query<HoldingValueRow>(
      `SELECT ticker,
              "assetClass" AS "assetClass",
              "lastValue"  AS "lastValue"
         FROM "holding"
        WHERE "userId" = $1
          AND "lastValue" IS NOT NULL`,
      [userId],
    );

    if (rows.length === 0) return null;

    let totalValue = 0;
    let stocksValue = 0;
    let bondsValue = 0;
    let cashValue = 0;

    for (const r of rows) {
      const lv =
        typeof r.lastValue === "number"
          ? r.lastValue
          : Number(r.lastValue ?? 0);
      if (!Number.isFinite(lv) || lv <= 0) continue;
      totalValue += lv;

      const klass = classifyTicker(r.ticker, r.assetClass);
      switch (klass) {
        case "bond":
          bondsValue += lv;
          break;
        case "cash":
          cashValue += lv;
          break;
        case "stock":
        case "etf":
        case "commodity":
        case "crypto":
        case "unknown":
        default:
          stocksValue += lv;
          break;
      }
    }

    if (totalValue <= 0) return null;

    // Whole-percent rounding so the donut buckets always sum to 100,
    // matching the rounding convention in `targetAllocation`. Cash is
    // the residual to absorb rounding error.
    const stocksPct = Math.round((stocksValue / totalValue) * 100);
    const bondsPct = Math.round((bondsValue / totalValue) * 100);
    const cashPct = Math.max(0, 100 - stocksPct - bondsPct);
    return { stocksPct, bondsPct, cashPct };
  } catch (err) {
    log.warn("year-outlook-loader", "getActualAllocationSplit failed", {
      userId,
      ...errorInfo(err),
    });
    return null;
  }
}
