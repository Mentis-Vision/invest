// src/lib/dashboard/metrics/tax-loader.ts
//
// Phase 3 Batch H — finds positions in the user's holdings table with
// material unrealized losses (≥ $200) and pairs each with a wash-sale-
// safe replacement candidate from the sector ETF map in tax.ts.
//
// Cost-basis source: the `holding.costBasis` column populated by the
// SnapTrade / Plaid sync. As of 2026-05-02 most user rows have it
// populated (24 of 31 in the sandbox snapshot); rows missing cost
// basis are silently skipped — the loader can only flag positions
// with both `costBasis` and `lastValue` available.
//
// Sector source: the `holding.sector` column (also populated upstream
// from Yahoo categorization). Rows missing sector still surface as a
// harvestable loss, just without a replacement suggestion (returns
// `null` for that field).
//
// Read-only against the holding table — no warehouse writes, no
// network calls, no AI. Wrapped in try/catch so a transient DB blip
// degrades to an empty array (queue-builder treats empty array the
// same as no harvestable positions).

import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import { unrealizedLoss, suggestReplacement } from "./tax";

const HARVEST_THRESHOLD_DOLLARS = 200;

export interface HarvestableLoss {
  ticker: string;
  costBasis: number;
  currentValue: number;
  lossDollars: number; // always negative — caller takes Math.abs for display
  suggestedReplacement: string | null;
  sector: string | null;
}

interface HoldingRow {
  ticker: string;
  costBasis: string | number | null;
  lastValue: string | number | null;
  sector: string | null;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Find positions whose unrealized loss is at or below
 * −$200 (i.e. loss of at least $200). Returns one row per ticker —
 * we sum across accountName so a ticker held in multiple accounts is
 * surfaced once with the aggregate cost basis and value.
 *
 * Returns empty array (not null) when:
 *   - the user has no holdings
 *   - none meet the −$200 threshold
 *   - none have both `costBasis` and `lastValue` populated
 *
 * Returns empty array on DB error (logged) so the dashboard render
 * never blocks on tax-harvest detection.
 */
export async function findHarvestableLosses(
  userId: string,
): Promise<HarvestableLoss[]> {
  try {
    const { rows } = await pool.query<HoldingRow>(
      // Aggregate per-ticker (collapse multi-account holdings into one
      // row): SUM costBasis and lastValue, take any non-null sector.
      // We exclude `assetClass = 'cash'` for the same reason the
      // concentration / allocation queries do — cash is not a
      // harvestable position.
      `SELECT ticker,
              SUM(COALESCE("costBasis", 0))::numeric  AS "costBasis",
              SUM(COALESCE("lastValue", 0))::numeric  AS "lastValue",
              MAX(sector)                              AS sector
         FROM "holding"
        WHERE "userId" = $1
          AND "assetClass" IS DISTINCT FROM 'cash'
          AND "costBasis" IS NOT NULL
          AND "lastValue" IS NOT NULL
        GROUP BY ticker
        ORDER BY ticker ASC`,
      [userId],
    );

    if (rows.length === 0) return [];

    // Build the sectorMap up-front so suggestReplacement is a pure
    // table lookup per row.
    const sectorMap: Record<string, string | null> = {};
    for (const r of rows) {
      sectorMap[r.ticker.toUpperCase()] = r.sector ?? null;
    }

    const out: HarvestableLoss[] = [];
    for (const r of rows) {
      const cb = num(r.costBasis);
      const lv = num(r.lastValue);
      if (cb === null || lv === null || cb <= 0) continue;
      const loss = unrealizedLoss(cb, lv);
      if (loss > -HARVEST_THRESHOLD_DOLLARS) continue;

      const replacement = r.sector
        ? suggestReplacement(r.ticker, sectorMap as Record<string, string>)
        : null;

      out.push({
        ticker: r.ticker.toUpperCase(),
        costBasis: cb,
        currentValue: lv,
        lossDollars: loss,
        suggestedReplacement: replacement,
        sector: r.sector ?? null,
      });
    }

    // Sort by largest loss first so the queue-builder / drill view
    // surfaces the most material harvest opportunities at the top.
    out.sort((a, b) => a.lossDollars - b.lossDollars);
    return out;
  } catch (err) {
    log.warn("tax-loader", "findHarvestableLosses failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Convenience aggregate used by queue-sources / queue-builder to gate
 * the tax_harvest item without re-querying. Returns the total loss
 * across all harvestable positions (always ≤ 0) and the number of
 * positions; both 0 when the array is empty.
 */
export function summarizeHarvest(
  losses: HarvestableLoss[],
): { totalLossDollars: number; numPositions: number } {
  if (losses.length === 0) {
    return { totalLossDollars: 0, numPositions: 0 };
  }
  return {
    totalLossDollars: losses.reduce((acc, l) => acc + l.lossDollars, 0),
    numPositions: losses.length,
  };
}
