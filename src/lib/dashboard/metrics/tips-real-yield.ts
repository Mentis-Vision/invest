// src/lib/dashboard/metrics/tips-real-yield.ts
//
// Phase 4 Batch K2 — TIPS / nominal-yield / breakeven triad.
//
// Pulls three FRED series in parallel:
//   * DGS10  — 10-year nominal Treasury constant-maturity yield
//   * DFII10 — 10-year TIPS real yield (constant-maturity)
//   * T10YIE — 10-year breakeven inflation rate (= DGS10 − DFII10)
//
// Returns the latest values + a one-line interpretation tag indicating
// whether real yields are in restrictive/neutral/accommodative territory.
// Pure helpers below are testable; the loader wraps the FRED fetch.

import { getLatestSeriesValue } from "../../data/fred";
import { log, errorInfo } from "../../log";

export type RealYieldStance = "restrictive" | "neutral" | "accommodative";

export interface TipsRealYield {
  /** 10-year nominal Treasury yield, percent. */
  nominal10y: number | null;
  /** 10-year TIPS real yield, percent. */
  real10y: number | null;
  /** 10-year breakeven inflation, percent. */
  breakeven10y: number | null;
  /** ISO date of the latest FRED observation. */
  asOf: string | null;
  /** One-line interpretation. */
  stance: RealYieldStance | null;
  /** Plain-English interpretation for the card body. */
  interpretation: string;
}

/**
 * Pure classifier. Takes the three rates and returns the stance label.
 *
 * Bands (real yield, %):
 *   > 1.0     restrictive   (real cost of capital is positive and material)
 *   0.0 – 1.0 neutral       (slightly positive real, historically average)
 *   < 0.0     accommodative (negative real yield, easy money)
 *
 * Returns null when real yield is missing.
 */
export function classifyRealYieldStance(
  real10y: number | null,
): RealYieldStance | null {
  if (real10y === null || !Number.isFinite(real10y)) return null;
  if (real10y > 1.0) return "restrictive";
  if (real10y < 0.0) return "accommodative";
  return "neutral";
}

/**
 * Build the human-readable interpretation string. Pure; no I/O.
 */
export function interpretTipsTriad(
  nominal: number | null,
  real: number | null,
  breakeven: number | null,
): string {
  const stance = classifyRealYieldStance(real);
  if (stance === null) {
    if (nominal !== null && breakeven !== null) {
      return `Nominal 10y ${nominal.toFixed(2)}%, breakeven ${breakeven.toFixed(2)}%; real yield unavailable.`;
    }
    return "TIPS data unavailable.";
  }
  const realStr = `${real?.toFixed(2)}%`;
  const breakevenStr =
    breakeven !== null && Number.isFinite(breakeven)
      ? ` breakeven ${breakeven.toFixed(2)}%`
      : "";
  switch (stance) {
    case "restrictive":
      return `Real 10y ${realStr} — restrictive financial conditions;${breakevenStr} typically pressures equity multiples.`;
    case "accommodative":
      return `Real 10y ${realStr} — accommodative financial conditions;${breakevenStr} historically supportive of risk assets.`;
    case "neutral":
      return `Real 10y ${realStr} — neutral real-yield zone;${breakevenStr} no strong directional pressure.`;
  }
}

/**
 * Loader. Returns the triad with `null` for any leg the FRED helper
 * couldn't resolve. The interpretation string adapts to whatever
 * subset is available.
 */
export async function getTipsRealYield(): Promise<TipsRealYield> {
  let nominal: number | null = null;
  let real: number | null = null;
  let breakeven: number | null = null;
  let asOf: string | null = null;

  try {
    const [n, r, b] = await Promise.all([
      getLatestSeriesValue("DGS10").catch(() => null),
      getLatestSeriesValue("DFII10").catch(() => null),
      getLatestSeriesValue("T10YIE").catch(() => null),
    ]);
    if (n) {
      nominal = n.value;
      asOf = n.date;
    }
    if (r) {
      real = r.value;
      asOf = asOf ?? r.date;
    }
    if (b) {
      breakeven = b.value;
      asOf = asOf ?? b.date;
    }
  } catch (err) {
    log.warn("tips-real-yield", "fetch failed", { ...errorInfo(err) });
  }

  return {
    nominal10y: nominal,
    real10y: real,
    breakeven10y: breakeven,
    asOf,
    stance: classifyRealYieldStance(real),
    interpretation: interpretTipsTriad(nominal, real, breakeven),
  };
}
