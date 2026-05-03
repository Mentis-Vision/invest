// src/lib/dashboard/metrics/risk.ts
//
// Pure realized-risk math for the Phase 2 science layer.
//
// All inputs are arrays of *fractional* periodic (typically daily)
// returns where +1% = 0.01. Outputs are likewise fractional (e.g.
// maxDrawdownPct of -0.18 = an 18% drawdown). Annualization assumes
// 252 trading days unless explicitly overridden.
//
// Every function defends against degenerate inputs (empty array,
// single observation, zero variance) by returning 0 — callers
// upstream gate on `sampleSize` to decide whether the metrics should
// be displayed at all.

export function meanReturn(returns: number[]): number {
  if (returns.length === 0) return 0;
  return returns.reduce((s, r) => s + r, 0) / returns.length;
}

export function stdDev(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mu = meanReturn(returns);
  const sumSq = returns.reduce((s, r) => s + (r - mu) ** 2, 0);
  return Math.sqrt(sumSq / (returns.length - 1));
}

export function downsideDeviation(
  returns: number[],
  minAcceptable = 0,
): number {
  if (returns.length < 2) return 0;
  const downside = returns.map((r) => Math.min(0, r - minAcceptable));
  const sumSq = downside.reduce((s, r) => s + r * r, 0);
  return Math.sqrt(sumSq / (returns.length - 1));
}

export function annualize(periodicReturn: number, periodsPerYear = 252): number {
  return periodicReturn * periodsPerYear;
}

export function annualizedVol(periodicVol: number, periodsPerYear = 252): number {
  return periodicVol * Math.sqrt(periodsPerYear);
}

/**
 * Sharpe ratio = (annualized excess return) / (annualized vol).
 * `riskFreeAnnual` defaults to 4% — a rough proxy for the 10Y treasury
 * yield. We deliberately use arithmetic-mean annualization (mean*252)
 * rather than geometric (CAGR) so this stays comparable to the textbook
 * Sharpe most users will recognize.
 */
export function sharpeRatio(
  dailyReturns: number[],
  riskFreeAnnual = 0.04,
): number {
  if (dailyReturns.length < 2) return 0;
  const mu = annualize(meanReturn(dailyReturns));
  const sigma = annualizedVol(stdDev(dailyReturns));
  if (sigma === 0) return 0;
  return (mu - riskFreeAnnual) / sigma;
}

/**
 * Sortino ratio — same numerator as Sharpe, but only penalizes
 * downside deviation. A series with no losses (or all-positive
 * returns) has dvol === 0, in which case we return 0 rather than
 * Infinity to avoid breaking the dashboard layout.
 */
export function sortinoRatio(
  dailyReturns: number[],
  riskFreeAnnual = 0.04,
): number {
  if (dailyReturns.length < 2) return 0;
  const mu = annualize(meanReturn(dailyReturns));
  const dvol = annualizedVol(downsideDeviation(dailyReturns));
  if (dvol === 0) return 0;
  return (mu - riskFreeAnnual) / dvol;
}

/**
 * Max drawdown across the cumulative-return curve built from
 * (1 + r_i) products. Returns a non-positive number, e.g. -0.18 for
 * an 18% peak-to-trough drawdown. Callers display as a negative
 * percentage.
 */
export function maxDrawdown(dailyReturns: number[]): number {
  if (dailyReturns.length === 0) return 0;
  let peak = 1;
  let cumulative = 1;
  let maxDd = 0;
  for (const r of dailyReturns) {
    cumulative *= 1 + r;
    if (cumulative > peak) peak = cumulative;
    const dd = (cumulative - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

/**
 * Beta of the portfolio vs a benchmark over the same date window.
 * Both arrays must be aligned by date and equal length — the loader
 * is responsible for that alignment. Returns 0 when the benchmark is
 * flat (variance 0) so we don't divide by zero.
 */
export function beta(
  portfolioReturns: number[],
  benchmarkReturns: number[],
): number {
  if (
    portfolioReturns.length < 2 ||
    portfolioReturns.length !== benchmarkReturns.length
  ) {
    return 0;
  }
  const muP = meanReturn(portfolioReturns);
  const muB = meanReturn(benchmarkReturns);
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < portfolioReturns.length; i++) {
    cov += (portfolioReturns[i] - muP) * (benchmarkReturns[i] - muB);
    varB += (benchmarkReturns[i] - muB) ** 2;
  }
  if (varB === 0) return 0;
  return cov / varB;
}

export interface PortfolioRisk {
  sharpe: number;
  sortino: number;
  /** Negative number, e.g. -0.18 for an 18% drawdown. 0 means none. */
  maxDrawdownPct: number;
  beta: number;
  /** Cumulative compounded return over the window, fractional. */
  ytdPct: number;
  /** Same shape, computed on the benchmark series. */
  benchYtdPct: number;
  /** Number of daily observations in the input series. */
  sampleSize: number;
}

/**
 * Aggregate the seven metrics in one call. Cheap (linear in input
 * length); call once per request and cache via the loader.
 */
export function computePortfolioRisk(
  portfolioDaily: number[],
  benchmarkDaily: number[],
): PortfolioRisk {
  return {
    sharpe: sharpeRatio(portfolioDaily),
    sortino: sortinoRatio(portfolioDaily),
    maxDrawdownPct: maxDrawdown(portfolioDaily),
    beta: beta(portfolioDaily, benchmarkDaily),
    ytdPct: portfolioDaily.reduce((cum, r) => cum * (1 + r), 1) - 1,
    benchYtdPct: benchmarkDaily.reduce((cum, r) => cum * (1 + r), 1) - 1,
    sampleSize: portfolioDaily.length,
  };
}
