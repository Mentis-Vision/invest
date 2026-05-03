// src/lib/dashboard/metrics/var.ts
//
// Pure Value-at-Risk math for the Phase 2 science layer.
//
// Inputs are arrays of fractional periodic (daily) returns where
// +1% = 0.01. Outputs are likewise fractional and *negative* — a
// VaR of -0.025 means "we expect to lose ≥ 2.5% on the worst days
// at this confidence level."
//
// We use the historical / non-parametric approach: sort the empirical
// return distribution and read off the (1 - confidence) percentile.
// This avoids the normality assumption — real return distributions
// have fat left tails, and a parametric Gaussian VaR systematically
// understates risk in those tails.
//
// Sample-size guard: every primitive returns 0 (or null in the
// aggregator) when given fewer than 20 observations. Twenty is the
// same threshold the realized-risk loader gates on, and below it the
// percentile estimates have such wide confidence intervals that the
// dashboard would mostly mislead users.

const MIN_SAMPLES = 20;
const TRADING_DAYS_PER_MONTH = 21;

/**
 * Historical VaR at confidence level c. Returns the (1 - c) quantile
 * of the empirical return distribution — a non-positive number for a
 * normal portfolio.
 */
export function historicalVaR(returns: number[], confidence: number): number {
  if (returns.length < MIN_SAMPLES) return 0;
  if (confidence <= 0 || confidence >= 1) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor((1 - confidence) * sorted.length);
  return sorted[Math.max(0, idx)];
}

/**
 * Conditional VaR / Expected Shortfall at confidence level c. The
 * arithmetic mean of returns at or below the VaR threshold — a
 * tighter measure of tail risk than VaR alone, because it cares
 * about *how bad* the bad days are, not just where the cutoff sits.
 */
export function expectedShortfall(returns: number[], confidence: number): number {
  if (returns.length < MIN_SAMPLES) return 0;
  if (confidence <= 0 || confidence >= 1) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.floor((1 - confidence) * sorted.length);
  if (cutoff === 0) return sorted[0];
  const tail = sorted.slice(0, cutoff);
  return tail.reduce((s, r) => s + r, 0) / tail.length;
}

/**
 * Square-root-of-time scaling. Assumes daily returns are i.i.d.;
 * that's a strong assumption (real returns cluster volatility), but
 * it's the standard textbook conversion and matches what every
 * regulator expects to see on a 1-day → 1-month VaR projection.
 */
export function scaleToMonthly(dailyVaR: number, days = TRADING_DAYS_PER_MONTH): number {
  return dailyVaR * Math.sqrt(days);
}

export interface VarResult {
  /** 1-day 95% VaR as a fraction (negative for a normal portfolio). */
  var95Daily: number;
  /** 1-day 99% VaR. Always ≤ var95Daily. */
  var99Daily: number;
  /** Mean of returns beyond VaR95 — expected tail loss. */
  cvar95Daily: number;
  /** Mean of returns beyond VaR99. */
  cvar99Daily: number;
  /** 1-month VaR95 (sqrt-of-time scaled). */
  var95Monthly: number;
  /** 1-month VaR99. */
  var99Monthly: number;
  /** Number of daily observations in the input series. */
  sampleSize: number;
}

/**
 * Aggregate the seven VaR / CVaR figures in one call. Cheap (linear
 * in input length, plus one sort); call once per request and cache
 * via the loader.
 *
 * Returns null when the sample window is too short for a stable
 * percentile estimate. Callers display "—" in that case.
 */
export function computeVaR(returns: number[]): VarResult | null {
  if (returns.length < MIN_SAMPLES) return null;
  const v95 = historicalVaR(returns, 0.95);
  const v99 = historicalVaR(returns, 0.99);
  const cv95 = expectedShortfall(returns, 0.95);
  const cv99 = expectedShortfall(returns, 0.99);
  return {
    var95Daily: v95,
    var99Daily: v99,
    cvar95Daily: cv95,
    cvar99Daily: cv99,
    var95Monthly: scaleToMonthly(v95),
    var99Monthly: scaleToMonthly(v99),
    sampleSize: returns.length,
  };
}
