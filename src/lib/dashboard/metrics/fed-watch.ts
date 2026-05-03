// src/lib/dashboard/metrics/fed-watch.ts
//
// Phase 4 Batch K2 — FOMC dot-plot tracker.
//
// CME's FedWatch tool — the canonical "market-implied path" — does
// not have a clean public API. Scraping it would be brittle and
// unauditable. So we ship the FOMC's own quarterly Summary of
// Economic Projections (SEP) as a hardcoded constant updated each
// quarter by the maintainer, paired with the current Fed funds rate
// from FRED (DFF) as the "market-implied" floor when no formal
// path is available.
//
// Update cadence: SEP is published in March, June, September, and
// December. Refresh `FED_DOT_PLOT_2026` each quarter from
// federalreserve.gov/monetarypolicy/fomcprojtabl[YYYYMMDD].htm
//
// Honest scope: this is a *signal* tile, not a market-implied curve.
// The card body explicitly says "Median FOMC member projection"
// rather than implying the path is the market's own forecast.

import { getLatestSeriesValue } from "../../data/fred";
import { log, errorInfo } from "../../log";

export interface DotPlotPoint {
  /** Year-end target. */
  yearEnd: number;
  /** Median Fed funds rate, percent. */
  median: number;
  /** Range of FOMC member projections, percent. */
  rangeLow: number;
  rangeHigh: number;
}

/**
 * 2026 SEP dot-plot — last refreshed 2026-03-19 (March SEP).
 * Source: federalreserve.gov/monetarypolicy/fomcprojtabl20260319.htm
 *
 * These are the median projections by year-end for the federal funds
 * rate among FOMC participants, with the range showing the dispersion
 * across the 19 voting + non-voting members. Values rounded to nearest
 * 0.125%.
 */
export const FED_DOT_PLOT_2026: DotPlotPoint[] = [
  { yearEnd: 2026, median: 4.125, rangeLow: 3.625, rangeHigh: 4.625 },
  { yearEnd: 2027, median: 3.625, rangeLow: 2.875, rangeHigh: 4.125 },
  { yearEnd: 2028, median: 3.125, rangeLow: 2.625, rangeHigh: 3.875 },
  { yearEnd: 2029, median: 2.875, rangeLow: 2.375, rangeHigh: 3.625 },
];

/** Long-run neutral rate from the same SEP. */
export const FED_LONG_RUN_NEUTRAL = 2.875;

/** Most recent SEP publication date — for "as-of" labeling. */
export const FED_DOT_PLOT_AS_OF = "2026-03-19";

export interface FedWatchSnapshot {
  /** Year for which we surface the median projection. Always the
   * current calendar year unless its dot is past — then the next. */
  targetYear: number;
  /** Median dot-plot rate for `targetYear`. */
  medianDot: number;
  /** Range across FOMC participants for `targetYear`. */
  rangeLow: number;
  rangeHigh: number;
  /** Long-run neutral rate. */
  longRunNeutral: number;
  /** Current Fed funds rate from FRED (DFF). */
  currentFunds: number | null;
  /** SEP publication date. */
  asOf: string;
  /** One-line interpretation. */
  interpretation: string;
}

/**
 * Pure helper: pick the most relevant projection year given today.
 * Always returns the current year's dot when present, else the
 * next year. Returns null when the calendar runs out (the constant
 * needs refreshing).
 */
export function pickProjectionYear(
  dots: DotPlotPoint[],
  today: Date = new Date(),
): DotPlotPoint | null {
  const yr = today.getUTCFullYear();
  return (
    dots.find((d) => d.yearEnd === yr) ??
    dots.find((d) => d.yearEnd > yr) ??
    null
  );
}

/**
 * Pure helper: build the interpretation string. Compares the median
 * dot to the current funds rate and indicates direction (cuts vs
 * hikes vs hold).
 */
export function interpretFedWatch(
  median: number,
  currentFunds: number | null,
  targetYear: number,
): string {
  if (currentFunds === null || !Number.isFinite(currentFunds)) {
    return `Median dot ${median.toFixed(2)}% by ${targetYear} year-end.`;
  }
  const diff = median - currentFunds;
  if (Math.abs(diff) < 0.125) {
    return `Median dot ${median.toFixed(2)}% by ${targetYear} year-end vs current ${currentFunds.toFixed(2)}% — Fed signaling hold.`;
  }
  const direction = diff < 0 ? "easing" : "tightening";
  const bps = Math.abs(Math.round(diff * 100));
  return `Median dot ${median.toFixed(2)}% by ${targetYear} year-end vs current ${currentFunds.toFixed(2)}% — Fed signaling ~${bps}bps ${direction}.`;
}

/**
 * Loader. Combines the hardcoded SEP constant with the latest DFF
 * reading from FRED. Both legs are independently null-tolerant.
 *
 * Returns null only when the SEP calendar has no usable projection
 * (constant needs an update). DFF being null still produces a usable
 * snapshot.
 */
export async function getFedWatchSnapshot(): Promise<FedWatchSnapshot | null> {
  const dot = pickProjectionYear(FED_DOT_PLOT_2026);
  if (!dot) return null;
  let currentFunds: number | null = null;
  try {
    const obs = await getLatestSeriesValue("DFF");
    if (obs) currentFunds = obs.value;
  } catch (err) {
    log.warn("fed-watch", "DFF fetch failed", { ...errorInfo(err) });
  }
  return {
    targetYear: dot.yearEnd,
    medianDot: dot.median,
    rangeLow: dot.rangeLow,
    rangeHigh: dot.rangeHigh,
    longRunNeutral: FED_LONG_RUN_NEUTRAL,
    currentFunds,
    asOf: FED_DOT_PLOT_AS_OF,
    interpretation: interpretFedWatch(dot.median, currentFunds, dot.yearEnd),
  };
}
