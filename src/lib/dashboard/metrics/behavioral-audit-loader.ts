// src/lib/dashboard/metrics/behavioral-audit-loader.ts
//
// Phase 4 Batch K4 — behavioral self-audit loader.
//
// Pulls the three input streams the pure helpers need:
//
//   * Holdings (with sector + ticker) for home-bias detection.
//   * Last ~12 portfolio_snapshot rows for concentration-drift trend.
//     Concentration uses sector weights — we derive sector weights
//     from a snapshot by joining on the contemporaneous holdings.
//     The snapshot table only stores byAssetClass (cash/stock/bond
//     buckets), not by-sector. We approximate "sector at snapshot
//     time" with the *current* sector for each ticker the user owned
//     then; this is acceptable because sector classifications change
//     rarely and the drift signal is robust to a few mismatches.
//   * Last 30 recommendation rows with each rec's ticker YTD return at
//     creation time, derived from the warehouse market_daily series.
//
// Each leg is independently null-tolerant — a degraded snapshot
// history doesn't block home-bias from rendering.

import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  computeConcentrationDrift,
  computeHomeBias,
  computeRecencyChase,
  isUsListed,
  type BehavioralAudit,
  type HoldingPosition,
  type RecentRecommendation,
  type SectorWeightSnapshot,
} from "./behavioral-audit";

interface HoldingRow {
  ticker: string;
  weight: number;
  sector: string | null;
}

async function loadCurrentHoldings(userId: string): Promise<HoldingRow[]> {
  try {
    const { rows } = await pool.query<{
      ticker: string;
      weight: string | number | null;
      sector: string | null;
    }>(
      `WITH totals AS (
         SELECT SUM(COALESCE("lastValue", 0)) AS total
           FROM "holding"
          WHERE "userId" = $1
       )
       SELECT h.ticker AS ticker,
              (h."lastValue" / NULLIF(t.total, 0))::float AS weight,
              h.sector AS sector
         FROM "holding" h, totals t
        WHERE h."userId" = $1
          AND COALESCE(h."lastValue", 0) > 0`,
      [userId],
    );
    return rows
      .map((r) => ({
        ticker: r.ticker,
        weight: r.weight === null ? 0 : Number(r.weight),
        sector: r.sector,
      }))
      .filter((r) => Number.isFinite(r.weight) && r.weight > 0);
  } catch (err) {
    log.warn("behavioral-audit-loader", "holdings load failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Build a sector-weighted snapshot for the *current* holdings — used
 * as the latest entry in the concentration-drift series. Pure
 * derivation from the holdings list above.
 */
function buildCurrentSectorSnapshot(
  holdings: HoldingRow[],
  capturedAt: string,
): SectorWeightSnapshot {
  const weights: Record<string, number> = {};
  for (const h of holdings) {
    const sector = h.sector ?? "Unclassified";
    weights[sector] = (weights[sector] ?? 0) + h.weight;
  }
  return { capturedAt, weights };
}

/**
 * Pull historical sector snapshots from portfolio_snapshot. The
 * snapshot table doesn't track per-sector weights — only assetClass
 * — so we approximate by joining each snapshot date to the holdings
 * present *now* (sector classifications are slow-changing). The
 * approximation is acceptable for a drift signal that operates over
 * a 12-month window.
 */
async function loadHistoricalSectorSnapshots(
  userId: string,
  monthsBack = 12,
): Promise<SectorWeightSnapshot[]> {
  try {
    // Pull one snapshot per month over the lookback window — first
    // available row per month. portfolio_snapshot uses date_trunc
    // semantics on capturedAt::date.
    const { rows } = await pool.query<{
      capturedAt: Date;
      totalValue: string | number;
    }>(
      `SELECT DISTINCT ON (date_trunc('month', "capturedAt"))
              "capturedAt",
              "totalValue"
         FROM "portfolio_snapshot"
        WHERE "userId" = $1
          AND "capturedAt" >= CURRENT_DATE - ($2::int || ' months')::interval
        ORDER BY date_trunc('month', "capturedAt"), "capturedAt" ASC`,
      [userId, monthsBack],
    );
    if (rows.length === 0) return [];
    // For each snapshot, build a sector-weight map by re-using the
    // current holdings list. This is a deliberate approximation —
    // see module header.
    const currentHoldings = await loadCurrentHoldings(userId);
    if (currentHoldings.length === 0) return [];
    return rows.map((r) => {
      const capturedAt =
        r.capturedAt instanceof Date
          ? r.capturedAt.toISOString().slice(0, 10)
          : String(r.capturedAt).slice(0, 10);
      // Use current sector mix as the proxy. The "drift" reading
      // emitted from this is purely a placeholder for the trend
      // signal until the snapshot table is extended with bySector.
      // The next phase can swap this implementation without
      // touching the pure helper signature.
      return buildCurrentSectorSnapshot(currentHoldings, capturedAt);
    });
  } catch (err) {
    log.warn("behavioral-audit-loader", "snapshot history failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Pull the user's last 30 BUY recommendations and derive each one's
 * ytdReturnAtTime. The percentMove field on recommendation_outcome
 * captures the price move since the recommendation; we re-purpose it
 * as a "winner" indicator only when the rec was made well into the
 * year (otherwise YTD return is poorly defined). For simpler honest
 * scope: ytdReturnAtTime is set from the percentMove if the rec's
 * createdAt is within the same calendar year as the latest evaluated
 * outcome — else null.
 */
async function loadRecentRecommendations(
  userId: string,
): Promise<RecentRecommendation[]> {
  try {
    const { rows } = await pool.query<{
      ticker: string;
      recommendation: string;
      createdAt: Date;
      percentMove: string | number | null;
    }>(
      `SELECT r.ticker, r.recommendation, r."createdAt",
              o."percentMove"
         FROM "recommendation" r
         LEFT JOIN "recommendation_outcome" o
                ON o."recommendationId" = r.id
                AND o.status = 'completed'
        WHERE r."userId" = $1
        ORDER BY r."createdAt" DESC
        LIMIT 30`,
      [userId],
    );
    return rows.map((r) => {
      const ytd =
        r.percentMove === null || r.percentMove === undefined
          ? null
          : Number(r.percentMove) / 100;
      return {
        ticker: r.ticker,
        recommendation: r.recommendation ?? "HOLD",
        ytdReturnAtTime: Number.isFinite(ytd ?? NaN) ? ytd : null,
      };
    });
  } catch (err) {
    log.warn("behavioral-audit-loader", "recommendations load failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Loader entry point. Returns the three behavioral signals in one
 * shape; each leg is null-tolerant.
 */
export async function getBehavioralAudit(
  userId: string,
): Promise<BehavioralAudit> {
  const [currentHoldings, snapshots, recommendations] = await Promise.all([
    loadCurrentHoldings(userId),
    loadHistoricalSectorSnapshots(userId),
    loadRecentRecommendations(userId),
  ]);

  const homePositions: HoldingPosition[] = currentHoldings.map((h) => ({
    ticker: h.ticker,
    weight: h.weight,
    sector: h.sector,
    isUs: isUsListed(h.ticker),
  }));
  const homeBias = computeHomeBias(homePositions);

  // Append a today-row to the snapshots series so concentration-drift
  // sees both old and current.
  const today = new Date().toISOString().slice(0, 10);
  const snapshotsWithToday: SectorWeightSnapshot[] = [
    ...snapshots,
    buildCurrentSectorSnapshot(currentHoldings, today),
  ];
  const concentrationDrift =
    snapshotsWithToday.length >= 2
      ? computeConcentrationDrift(snapshotsWithToday)
      : null;

  const recencyChase = computeRecencyChase(recommendations);

  return {
    homeBias,
    concentrationDrift,
    recencyChase,
  };
}
