// src/lib/dashboard/metrics/momentum.ts
//
// Pure math for the Jegadeesh-Titman "12-1" cross-sectional momentum
// factor. Defined as the total return over the trailing 12 months
// MINUS the return over the most recent 1 month — the recent-month
// subtraction strips out short-term reversal, which is the empirical
// finding that drove the original 1993 paper.
//
// Inputs are an array of daily closes, oldest first. Returns the
// spread as a fraction (0.08 = +8%). Returns `null` when the series
// is shorter than 252 trading days, or when one of the reference
// prices (today, ~1m ago, ~12m ago) is not strictly positive —
// those happen rarely (corporate actions, dividend-adjustment
// glitches) and would produce an undefined ratio.
//
// We deliberately reference back from the end of the array rather
// than slicing — callers can pass any series length ≥ 252 (the
// loader currently caps at 260 to leave a small buffer for trailing
// non-trading days that the warehouse can occasionally drop).
//
// Indexing follows the Phase 2 spec: 21 indices back is "1 month",
// 252 indices back is "12 months". For a length-252 array those
// resolve to indices 231 and 0 respectively.

const ONE_MONTH_OFFSET = 21;
const TWELVE_MONTH_OFFSET = 252;

export function compute12_1Momentum(prices: number[]): number | null {
  if (prices.length < TWELVE_MONTH_OFFSET) return null;
  const today = prices[prices.length - 1];
  const oneMonthAgo = prices[prices.length - ONE_MONTH_OFFSET];
  const twelveMonthsAgo = prices[prices.length - TWELVE_MONTH_OFFSET];
  if (
    !Number.isFinite(today) ||
    !Number.isFinite(oneMonthAgo) ||
    !Number.isFinite(twelveMonthsAgo)
  ) {
    return null;
  }
  if (oneMonthAgo <= 0 || twelveMonthsAgo <= 0) return null;
  const twelveMonthReturn = (today - twelveMonthsAgo) / twelveMonthsAgo;
  const oneMonthReturn = (today - oneMonthAgo) / oneMonthAgo;
  return twelveMonthReturn - oneMonthReturn;
}
