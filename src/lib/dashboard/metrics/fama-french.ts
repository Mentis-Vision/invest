// src/lib/dashboard/metrics/fama-french.ts
//
// Pure OLS regression of a portfolio's daily excess returns onto the
// Fama-French factor returns (Mkt-RF, SMB, HML, optionally RMW + CMA).
// Output:
//   - alpha (annualized intercept, fractional — 0.02 = 200bp annualized)
//   - factor betas (unitless slopes)
//   - rSquared (0–1 goodness-of-fit)
//   - observations (sample size used)
//
// Math:
//   Solve β = (X^T X)^-1 X^T y where X has a leading 1-column for
//   the intercept and one column per factor. Daily inputs; alpha is
//   annualized by multiplying the daily intercept by 252.
//
// We hand-roll a small Gauss-Jordan inversion because the regressor
// matrix is at most 6×6 (intercept + 5 factors). Pulling in a linear
// algebra library would be wildly oversized for this.
//
// Defensive design:
//   - Returns null when fewer than (factors + 30) observations are
//     supplied — degrees of freedom are too thin for a stable beta
//     below that point. The caller renders "—".
//   - Returns null on a singular X^T X (perfectly collinear factors)
//     rather than throwing. Diagnostically logged at the call site.
//   - All inputs are *fractional* periodic returns (0.01 = +1%). The
//     French Library publishes percent values — the loader converts
//     before calling this.
//
// Annualization assumes 252 trading days. Match the convention used
// by risk.ts (Sharpe / Sortino).

const TRADING_DAYS = 252;
const MIN_OBS_PER_FACTOR_PADDING = 30;

export interface FactorReturns {
  /** Daily market excess return (Rm - Rf), fractional. */
  mktRf: number[];
  /** Daily small-minus-big factor return, fractional. */
  smb: number[];
  /** Daily high-minus-low (book-to-market) factor return, fractional. */
  hml: number[];
  /** Daily robust-minus-weak (profitability) factor return, optional. */
  rmw?: number[];
  /** Daily conservative-minus-aggressive (investment) factor return, optional. */
  cma?: number[];
  /** Daily risk-free rate, fractional. Subtracted from portfolio returns. */
  rf: number[];
}

export interface FactorBetas {
  mktRf: number;
  smb: number;
  hml: number;
  rmw?: number;
  cma?: number;
}

export interface FactorExposure {
  /** Annualized intercept (fractional). */
  alpha: number;
  /** Factor slopes. */
  betas: FactorBetas;
  /** Coefficient of determination, 0–1. */
  rSquared: number;
  /** Number of aligned observations the regression consumed. */
  observations: number;
  /** True iff the 5-factor model was fitted (rmw + cma supplied). */
  fiveFactor: boolean;
}

/**
 * Invert a square matrix in place using Gauss-Jordan with partial
 * pivoting. Returns the inverse, or `null` when the matrix is
 * singular within `EPS`. The caller treats null as "regression
 * failed — render —".
 */
function invertMatrix(m: number[][]): number[][] | null {
  const n = m.length;
  const EPS = 1e-12;
  // Build [A | I] augmented matrix.
  const a: number[][] = m.map((row, i) => {
    const out = row.slice();
    for (let j = 0; j < n; j++) out.push(i === j ? 1 : 0);
    return out;
  });

  for (let i = 0; i < n; i++) {
    // Partial pivot — swap in the row with the largest pivot magnitude.
    let pivot = i;
    let pivotMag = Math.abs(a[i][i]);
    for (let r = i + 1; r < n; r++) {
      const mag = Math.abs(a[r][i]);
      if (mag > pivotMag) {
        pivot = r;
        pivotMag = mag;
      }
    }
    if (pivotMag < EPS) return null;
    if (pivot !== i) {
      const tmp = a[i];
      a[i] = a[pivot];
      a[pivot] = tmp;
    }
    // Normalize pivot row.
    const pv = a[i][i];
    for (let c = 0; c < 2 * n; c++) a[i][c] /= pv;
    // Eliminate other rows.
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = a[r][i];
      if (factor === 0) continue;
      for (let c = 0; c < 2 * n; c++) a[r][c] -= factor * a[i][c];
    }
  }

  return a.map((row) => row.slice(n));
}

/** Multiply two matrices A (rows×inner) and B (inner×cols). */
function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length;
  const inner = b.length;
  const cols = b[0].length;
  const out: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < inner; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < cols; j++) {
        out[i][j] += aik * b[k][j];
      }
    }
  }
  return out;
}

/** Transpose a matrix. */
function transpose(m: number[][]): number[][] {
  const rows = m.length;
  const cols = m[0].length;
  const out: number[][] = Array.from({ length: cols }, () => new Array(rows));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) out[j][i] = m[i][j];
  }
  return out;
}

/**
 * Run a factor regression. `portfolioReturns` are *raw* (not excess)
 * portfolio returns — the function subtracts `factors.rf` to form
 * the dependent variable, matching the standard Fama-French
 * formulation.
 *
 * Returns null when:
 *   - any factor array length disagrees with portfolioReturns
 *   - observations < (1 + numFactors + MIN_OBS_PER_FACTOR_PADDING)
 *   - (X^T X) is singular
 */
export function regressFactors(
  portfolioReturns: number[],
  factors: FactorReturns,
): FactorExposure | null {
  const n = portfolioReturns.length;
  if (
    n !== factors.mktRf.length ||
    n !== factors.smb.length ||
    n !== factors.hml.length ||
    n !== factors.rf.length
  ) {
    return null;
  }
  const fiveFactor =
    !!factors.rmw && !!factors.cma && factors.rmw.length === n && factors.cma.length === n;

  const numFactors = fiveFactor ? 5 : 3;
  const minObs = 1 + numFactors + MIN_OBS_PER_FACTOR_PADDING;
  if (n < minObs) return null;

  // Build dependent variable: excess portfolio return.
  const y: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const ri = portfolioReturns[i] - factors.rf[i];
    if (!Number.isFinite(ri)) return null;
    y[i] = ri;
  }

  // Build design matrix: [1, mktRf, smb, hml, (rmw, cma)].
  const X: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row: number[] = [1, factors.mktRf[i], factors.smb[i], factors.hml[i]];
    if (fiveFactor) {
      row.push(factors.rmw![i], factors.cma![i]);
    }
    for (const v of row) {
      if (!Number.isFinite(v)) return null;
    }
    X[i] = row;
  }

  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const XtXinv = invertMatrix(XtX);
  if (!XtXinv) return null;

  // β = (X^T X)^-1 X^T y
  const yMat = y.map((v) => [v]);
  const Xty = matMul(Xt, yMat);
  const betaMat = matMul(XtXinv, Xty);
  const beta = betaMat.map((row) => row[0]);

  // Compute R²: 1 - SSR/SST.
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let sst = 0;
  let ssr = 0;
  for (let i = 0; i < n; i++) {
    let yhat = 0;
    for (let k = 0; k < beta.length; k++) yhat += X[i][k] * beta[k];
    const resid = y[i] - yhat;
    ssr += resid * resid;
    const dev = y[i] - yMean;
    sst += dev * dev;
  }
  const rSquared = sst > 0 ? Math.max(0, Math.min(1, 1 - ssr / sst)) : 0;

  const betas: FactorBetas = {
    mktRf: beta[1],
    smb: beta[2],
    hml: beta[3],
  };
  if (fiveFactor) {
    betas.rmw = beta[4];
    betas.cma = beta[5];
  }

  return {
    alpha: beta[0] * TRADING_DAYS,
    betas,
    rSquared,
    observations: n,
    fiveFactor,
  };
}

export interface FactorInterpretation {
  /** Short tag like "small-cap value" or "large-cap growth". */
  tilt: string;
  /** Optional beta call-out, e.g. "high beta (1.18)". */
  betaTag: string | null;
  /** Whether the regression is statistically meaningful (R² > 0.3). */
  meaningful: boolean;
}

/**
 * Convert a FactorExposure into a short human tag for the card. The
 * thresholds are deliberately loose — these are coarse stylistic
 * labels, not formal classifications.
 *
 *   SMB >  0.20 → "small-cap"
 *   SMB < -0.20 → "large-cap"
 *   HML >  0.20 → "value"
 *   HML < -0.20 → "growth"
 *   |MktBeta| > 1.10 → "high beta"
 *   |MktBeta| < 0.90 → "low beta"
 */
export function interpretExposure(exp: FactorExposure): FactorInterpretation {
  const { betas, rSquared } = exp;
  const sizeTilt =
    betas.smb > 0.2 ? "small-cap" : betas.smb < -0.2 ? "large-cap" : null;
  const valueTilt =
    betas.hml > 0.2 ? "value" : betas.hml < -0.2 ? "growth" : null;

  let tilt: string;
  if (sizeTilt && valueTilt) tilt = `${sizeTilt} ${valueTilt}`;
  else if (sizeTilt) tilt = sizeTilt;
  else if (valueTilt) tilt = valueTilt;
  else tilt = "broad-market";

  let betaTag: string | null = null;
  if (betas.mktRf > 1.1) betaTag = `high beta (${betas.mktRf.toFixed(2)})`;
  else if (betas.mktRf < 0.9) betaTag = `low beta (${betas.mktRf.toFixed(2)})`;

  return {
    tilt,
    betaTag,
    meaningful: rSquared >= 0.3,
  };
}
