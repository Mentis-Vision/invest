// src/lib/dashboard/metrics/short-interest.ts
//
// Phase 4 Batch K3 — FINRA short-interest velocity.
//
// FINRA publishes consolidated short-interest data bi-weekly (15th
// and 30th of each month, lagging by a few business days). Two
// metrics that matter for risk-conscious investors:
//
//   1. Short-interest velocity: percent change in shares-short
//      between the latest report and the prior report. Rising rapidly
//      suggests new bearish positioning; falling rapidly suggests a
//      short squeeze unwind.
//
//   2. Days to cover: shares-short divided by average daily volume.
//      A high days-to-cover means a meaningful price move could
//      result if shorts try to exit at once.
//
// Pure module — `computeShortVelocity` operates on a 2-period
// reading. The loader piece is in short-interest-loader.ts.

export interface ShortInterestPeriod {
  /** Settlement date of the FINRA report. */
  settlementDate: string;
  /** Total shares short across reporting member firms. */
  sharesShort: number;
  /** Average daily share volume (NYSE + NASDAQ). */
  avgDailyVolume: number;
  /** Optional: shares short as percent of float, if available. */
  shortPctFloat?: number | null;
}

export interface ShortVelocityReading {
  /** Latest period's short interest as % of float (when available). */
  currentShortPctFloat: number | null;
  /** Days to cover for the latest period. */
  daysToCover: number;
  /** Period-over-period change in shares-short, percent. */
  velocityPct: number;
  /** True when the magnitude of velocity or DTC clears the
   * "meaningfully changing" threshold spec calls out. */
  isMaterial: boolean;
  /** ISO settlement date of the latest period. */
  asOf: string;
}

const VELOCITY_MATERIAL_THRESHOLD_PCT = 20; // |velocity| > 20%
const DTC_MATERIAL_THRESHOLD = 5;

/**
 * Compute the short-interest velocity reading from a 2-period series.
 * Pure — no I/O.
 *
 * Returns null when:
 *   * Series has fewer than 2 periods
 *   * Latest avgDailyVolume is non-positive (DTC undefined)
 *   * Prior sharesShort is non-positive (velocity undefined)
 */
export function computeShortVelocity(
  periods: ShortInterestPeriod[],
): ShortVelocityReading | null {
  if (periods.length < 2) return null;
  // Sort by settlementDate ascending so [0] is oldest, [-1] is newest.
  const sorted = periods
    .slice()
    .sort((a, b) => a.settlementDate.localeCompare(b.settlementDate));
  const prior = sorted[sorted.length - 2];
  const latest = sorted[sorted.length - 1];

  if (!Number.isFinite(latest.sharesShort) || !Number.isFinite(prior.sharesShort)) {
    return null;
  }
  if (prior.sharesShort <= 0) return null;
  if (!Number.isFinite(latest.avgDailyVolume) || latest.avgDailyVolume <= 0) {
    return null;
  }

  const velocityPct =
    ((latest.sharesShort - prior.sharesShort) / prior.sharesShort) * 100;
  const daysToCover = latest.sharesShort / latest.avgDailyVolume;

  const isMaterial =
    Math.abs(velocityPct) > VELOCITY_MATERIAL_THRESHOLD_PCT ||
    daysToCover > DTC_MATERIAL_THRESHOLD;

  return {
    currentShortPctFloat: latest.shortPctFloat ?? null,
    daysToCover: Math.round(daysToCover * 10) / 10,
    velocityPct: Math.round(velocityPct * 10) / 10,
    isMaterial,
    asOf: latest.settlementDate,
  };
}

/**
 * Format velocity as a signed string with one decimal: "+24.3%" or
 * "-15.2%". Used by the queue chip.
 */
export function formatVelocityChip(velocityPct: number): string {
  const sign = velocityPct > 0 ? "+" : velocityPct < 0 ? "" : "";
  return `${sign}${velocityPct.toFixed(1)}%`;
}
