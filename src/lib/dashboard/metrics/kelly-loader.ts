// src/lib/dashboard/metrics/kelly-loader.ts
//
// Computes a per-user fractional Kelly fraction from their realized
// recommendation outcomes.
//
// Method:
//   1. Pull every completed BUY recommendation outcome for the user
//      (status = 'completed' AND percentMove IS NOT NULL).
//   2. Split into wins (move > 0) and losses (move < 0). Flat
//      outcomes are intentionally dropped — Kelly assumes a binary
//      bet payoff and a zero move contributes no information about
//      either side's magnitude.
//   3. winRate = wins / (wins + losses)
//      avgWin   = mean(positive moves)
//      avgLoss  = |mean(negative moves)|
//   4. Run through fractionalKelly(winRate, avgWin, avgLoss, 0.25).
//
// Returns null when fewer than 10 outcomes are available, or when
// either the wins or losses bucket is empty (avgWin / avgLoss would
// be undefined). The 10-outcome floor is a soft minimum to avoid
// publishing a Kelly fraction off two coin-flips of data — small
// samples are exactly the regime where Kelly is most unstable.
//
// Schema notes (verified 2026-05-02 against `recommendation_outcome`):
//   * status, percentMove, verdict are all stored on the outcome row.
//   * percentMove is stored as a percent number (e.g. 4.2 for +4.2%),
//     not a fraction. We hand it to fractionalKelly as-is — both
//     avgWin and avgLoss are in the same percent units, so the
//     ratio b = avgWin/avgLoss is dimensionless and the Kelly
//     formula works regardless.

import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import { fractionalKelly } from "./kelly";

const MIN_OUTCOMES = 10;
const DEFAULT_FRACTION = 0.25;

interface OutcomeRow {
  percentMove: string | number | null;
}

export async function getKellyFraction(
  userId: string,
  fraction: number = DEFAULT_FRACTION,
): Promise<number | null> {
  let rows: OutcomeRow[] = [];
  try {
    const result = await pool.query<OutcomeRow>(
      `SELECT o."percentMove" AS "percentMove"
         FROM "recommendation_outcome" o
         JOIN "recommendation" r ON r.id = o."recommendationId"
        WHERE r."userId" = $1
          AND r.recommendation = 'BUY'
          AND o.status = 'completed'
          AND o."percentMove" IS NOT NULL`,
      [userId],
    );
    rows = result.rows;
  } catch (err) {
    log.warn("dashboard.kelly", "load failed", {
      userId,
      ...errorInfo(err),
    });
    return null;
  }

  if (rows.length < MIN_OUTCOMES) return null;

  const moves: number[] = [];
  for (const r of rows) {
    if (r.percentMove === null || r.percentMove === undefined) continue;
    const n =
      typeof r.percentMove === "number"
        ? r.percentMove
        : Number(r.percentMove);
    if (!Number.isFinite(n)) continue;
    moves.push(n);
  }

  if (moves.length < MIN_OUTCOMES) return null;

  const wins = moves.filter((m) => m > 0);
  const losses = moves.filter((m) => m < 0);
  if (wins.length === 0 || losses.length === 0) return null;

  const winRate = wins.length / (wins.length + losses.length);
  const avgWin = wins.reduce((s, m) => s + m, 0) / wins.length;
  const avgLoss = Math.abs(
    losses.reduce((s, m) => s + m, 0) / losses.length,
  );

  return fractionalKelly(winRate, avgWin, avgLoss, fraction);
}
