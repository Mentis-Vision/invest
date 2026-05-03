// src/lib/dashboard/metrics/kelly.ts
//
// Pure math for fractional Kelly position sizing.
//
// Full Kelly:
//   f* = (p * b - q) / b
// where:
//   p = probability of a win
//   q = 1 - p
//   b = avgWin / avgLoss (the odds ratio of a win to a loss)
//
// Full Kelly maximizes long-run geometric growth but is too volatile
// for real-world investing because the inputs (p, b) are estimated
// with noise. Fractional Kelly — typically ¼ — gives up some
// expected growth in exchange for far less drawdown when the
// estimate of p drifts down. We return ¼ Kelly by default.
//
// Returns a fraction of portfolio in [0, 1]. Returns 0 in any
// degenerate case (no edge, missing magnitudes) so the caller can
// safely render the value as a chip without special-casing NaN.

export function fractionalKelly(
  winRate: number,
  avgWin: number,
  avgLoss: number,
  fraction = 0.25,
): number {
  if (
    !Number.isFinite(winRate) ||
    !Number.isFinite(avgWin) ||
    !Number.isFinite(avgLoss) ||
    !Number.isFinite(fraction)
  ) {
    return 0;
  }
  if (winRate <= 0 || winRate >= 1) return 0;
  if (avgWin <= 0 || avgLoss <= 0) return 0;
  const p = winRate;
  const q = 1 - p;
  const b = avgWin / avgLoss;
  const fStar = (p * b - q) / b;
  if (fStar <= 0) return 0;
  return Math.min(fStar * fraction, 1.0);
}
