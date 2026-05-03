// src/lib/dashboard/metrics/quality.ts
//
// Pure math for the four Phase 2 fundamental quality scores:
//   - Piotroski F-Score    (0–9, accounting strength)
//   - Altman Z-Score       (5-factor distress predictor)
//   - Beneish M-Score      (8-factor earnings manipulation flag)
//   - Sloan Accruals Ratio (earnings quality / accruals stress)
//
// Inputs are plain shapes — `FundamentalsCurrent` (most recent fiscal
// period) and `FundamentalsPrior` (the period immediately before it).
// The loader is responsible for mapping warehouse rows into these
// shapes; this file does no I/O and assumes nothing about provenance.
//
// Every scoring function returns `null` when its required inputs are
// not available. We deliberately do NOT fall back to estimates or
// fabricate substitutes — partial fundamentals coverage is a real
// state in the warehouse and the UI handles `null` cleanly. NaN never
// leaks out of this module.

/**
 * Most-recent-period fundamentals. Every field is independently
 * nullable so the loader can map sparse warehouse rows directly into
 * this shape without filtering — each scoring function checks the
 * subset of fields it actually needs.
 */
export interface FundamentalsCurrent {
  // P&L
  revenue: number | null;
  netIncome: number | null;
  grossProfit: number | null;

  // Balance sheet
  totalAssets: number | null;
  totalLiabilities?: number | null;
  retainedEarnings?: number | null;
  longTermDebt: number | null;
  totalDebt?: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  accountsReceivable?: number | null;
  ppe?: number | null;

  // Cash flow
  cfo: number | null;

  // Shares / market
  sharesOutstanding: number | null;
  marketCap?: number | null;

  // Operating intensity (Beneish only)
  ebit?: number | null;
  depreciation?: number | null;
  sga?: number | null;
}

/**
 * Prior-period fundamentals. Same fields as current but Beneish-only
 * inputs (ebit, marketCap, retainedEarnings) aren't required for the
 * indices that compare current↔prior, so they're omitted here.
 */
export interface FundamentalsPrior {
  revenue: number | null;
  netIncome: number | null;
  grossProfit: number | null;

  totalAssets: number | null;
  totalLiabilities?: number | null;
  longTermDebt: number | null;
  totalDebt?: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  accountsReceivable?: number | null;
  ppe?: number | null;

  cfo: number | null;

  sharesOutstanding: number | null;

  depreciation?: number | null;
  sga?: number | null;
}

export interface QualityScores {
  /** Piotroski F-Score 0..9. null when current/prior insufficient. */
  piotroski: number | null;
  /** Altman Z-Score (continuous). null when inputs insufficient. */
  altmanZ: number | null;
  /** Beneish M-Score (continuous, lower=cleaner). null when inputs insufficient. */
  beneishM: number | null;
  /** Sloan accruals ratio (NI - CFO) / TotalAssets. null on missing inputs. */
  sloanAccruals: number | null;
  /**
   * Piotroski F-Score from the period BEFORE the current↔prior pair —
   * i.e. the score that compares 'prior' against the period before it.
   * Populated only when the loader supplies a 'periodBeforePrior'
   * snapshot. Used by queue-builder to detect period-over-period drops.
   */
  priorPiotroski?: number | null;
}

// ---- helpers ----------------------------------------------------------

function isFinitePositive(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function isFiniteNumber(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function safeDiv(num: number | null, den: number | null): number | null {
  if (!isFiniteNumber(num) || !isFiniteNumber(den) || den === 0) return null;
  const v = num / den;
  return Number.isFinite(v) ? v : null;
}

// ---- Piotroski F-Score ------------------------------------------------

/**
 * Piotroski F-Score: 9 binary checks summed, 0..9. Higher = healthier.
 *
 *  1. ROA > 0                         (NI / TotalAssets, current period)
 *  2. CFO > 0
 *  3. ΔROA > 0                        (current ROA > prior ROA)
 *  4. CFO > NetIncome                 (accruals quality)
 *  5. LongTermDebt ratio decreased    (LT debt / total assets ↓)
 *  6. Current ratio increased         (currentAssets/currentLiab ↑)
 *  7. Shares outstanding did not increase
 *  8. Gross margin increased          (gross profit / revenue ↑)
 *  9. Asset turnover increased        (revenue / total assets ↑)
 *
 * Each check is skipped when its inputs are missing — but if fewer
 * than 5 checks can be evaluated we return null rather than a
 * misleadingly low score.
 */
export function piotroskiFScore(
  current: FundamentalsCurrent | null,
  prior: FundamentalsPrior | null,
): number | null {
  if (!current || !prior) return null;

  let score = 0;
  let evaluated = 0;

  // 1. ROA > 0
  const roaCur = safeDiv(current.netIncome, current.totalAssets);
  if (roaCur !== null) {
    evaluated++;
    if (roaCur > 0) score++;
  }

  // 2. CFO > 0
  if (isFiniteNumber(current.cfo)) {
    evaluated++;
    if (current.cfo > 0) score++;
  }

  // 3. ΔROA > 0
  const roaPrior = safeDiv(prior.netIncome, prior.totalAssets);
  if (roaCur !== null && roaPrior !== null) {
    evaluated++;
    if (roaCur > roaPrior) score++;
  }

  // 4. CFO > NetIncome
  if (isFiniteNumber(current.cfo) && isFiniteNumber(current.netIncome)) {
    evaluated++;
    if (current.cfo > current.netIncome) score++;
  }

  // 5. LT debt ratio decreased (or held flat)
  const ltdRatioCur = safeDiv(current.longTermDebt, current.totalAssets);
  const ltdRatioPrior = safeDiv(prior.longTermDebt, prior.totalAssets);
  if (ltdRatioCur !== null && ltdRatioPrior !== null) {
    evaluated++;
    if (ltdRatioCur <= ltdRatioPrior) score++;
  }

  // 6. Current ratio increased (or held flat)
  const crCur = safeDiv(current.currentAssets, current.currentLiabilities);
  const crPrior = safeDiv(prior.currentAssets, prior.currentLiabilities);
  if (crCur !== null && crPrior !== null) {
    evaluated++;
    if (crCur >= crPrior) score++;
  }

  // 7. Shares outstanding did not increase
  if (
    isFiniteNumber(current.sharesOutstanding) &&
    isFiniteNumber(prior.sharesOutstanding)
  ) {
    evaluated++;
    if (current.sharesOutstanding <= prior.sharesOutstanding) score++;
  }

  // 8. Gross margin increased (or held flat)
  const gmCur = safeDiv(current.grossProfit, current.revenue);
  const gmPrior = safeDiv(prior.grossProfit, prior.revenue);
  if (gmCur !== null && gmPrior !== null) {
    evaluated++;
    if (gmCur >= gmPrior) score++;
  }

  // 9. Asset turnover increased (or held flat)
  const atCur = safeDiv(current.revenue, current.totalAssets);
  const atPrior = safeDiv(prior.revenue, prior.totalAssets);
  if (atCur !== null && atPrior !== null) {
    evaluated++;
    if (atCur >= atPrior) score++;
  }

  if (evaluated < 5) return null;
  return score;
}

// ---- Altman Z-Score ---------------------------------------------------

/**
 * Altman Z = 1.2 A + 1.4 B + 3.3 C + 0.6 D + 1.0 E
 *   A = (currentAssets − currentLiabilities) / totalAssets
 *   B = retainedEarnings / totalAssets
 *   C = EBIT / totalAssets
 *   D = marketCap / totalLiabilities
 *   E = revenue / totalAssets
 *
 *   Z > 2.99 = safe. 1.81 < Z < 2.99 = grey. Z < 1.81 = distress.
 *
 * Returns null when any of the five ratios cannot be computed.
 */
export function altmanZScore(
  current: FundamentalsCurrent | null,
): number | null {
  if (!current) return null;
  const {
    currentAssets,
    currentLiabilities,
    totalAssets,
    retainedEarnings,
    ebit,
    marketCap,
    totalLiabilities,
    revenue,
  } = current;

  if (
    !isFinitePositive(totalAssets) ||
    !isFinitePositive(totalLiabilities) ||
    !isFiniteNumber(currentAssets) ||
    !isFiniteNumber(currentLiabilities) ||
    !isFiniteNumber(retainedEarnings) ||
    !isFiniteNumber(ebit) ||
    !isFinitePositive(marketCap) ||
    !isFiniteNumber(revenue)
  ) {
    return null;
  }

  const A = (currentAssets - currentLiabilities) / totalAssets;
  const B = retainedEarnings / totalAssets;
  const C = ebit / totalAssets;
  const D = marketCap / totalLiabilities;
  const E = revenue / totalAssets;

  const z = 1.2 * A + 1.4 * B + 3.3 * C + 0.6 * D + 1.0 * E;
  return Number.isFinite(z) ? z : null;
}

// ---- Beneish M-Score --------------------------------------------------

/**
 * Beneish M-Score, 8-factor manipulation indicator. M > -1.78 flags a
 * likely earnings manipulator. Inputs span both periods because every
 * sub-index is a current/prior ratio.
 *
 *  M = -4.84
 *      + 0.92 * DSRI
 *      + 0.528 * GMI
 *      + 0.404 * AQI
 *      + 0.892 * SGI
 *      + 0.115 * DEPI
 *      - 0.172 * SGAI
 *      + 4.679 * TATA
 *      - 0.327 * LVGI
 *
 * Returns null if any required ratio cannot be computed.
 */
export function beneishMScore(
  current: FundamentalsCurrent | null,
  prior: FundamentalsPrior | null,
): number | null {
  if (!current || !prior) return null;

  // DSRI = (AR/Sales)_current / (AR/Sales)_prior
  const arOverSalesCur = safeDiv(current.accountsReceivable ?? null, current.revenue);
  const arOverSalesPrior = safeDiv(prior.accountsReceivable ?? null, prior.revenue);
  const dsri = safeDiv(arOverSalesCur, arOverSalesPrior);

  // GMI = grossMargin_prior / grossMargin_current
  const gmCur = safeDiv(current.grossProfit, current.revenue);
  const gmPrior = safeDiv(prior.grossProfit, prior.revenue);
  const gmi = safeDiv(gmPrior, gmCur);

  // AQI = (1 − (currentAssets+ppe)/totalAssets)_current
  //       / (1 − (currentAssets+ppe)/totalAssets)_prior
  const nonOpCur =
    isFiniteNumber(current.currentAssets) &&
    isFiniteNumber(current.ppe ?? null) &&
    isFinitePositive(current.totalAssets)
      ? 1 - (current.currentAssets + (current.ppe ?? 0)) / current.totalAssets
      : null;
  const nonOpPrior =
    isFiniteNumber(prior.currentAssets) &&
    isFiniteNumber(prior.ppe ?? null) &&
    isFinitePositive(prior.totalAssets)
      ? 1 - (prior.currentAssets + (prior.ppe ?? 0)) / prior.totalAssets
      : null;
  const aqi = safeDiv(nonOpCur, nonOpPrior);

  // SGI = sales_current / sales_prior
  const sgi = safeDiv(current.revenue, prior.revenue);

  // DEPI = (depreciation/(depreciation+ppe))_prior / same_current
  const depShareCur =
    isFiniteNumber(current.depreciation ?? null) &&
    isFiniteNumber(current.ppe ?? null) &&
    (current.depreciation ?? 0) + (current.ppe ?? 0) > 0
      ? (current.depreciation ?? 0) /
        ((current.depreciation ?? 0) + (current.ppe ?? 0))
      : null;
  const depSharePrior =
    isFiniteNumber(prior.depreciation ?? null) &&
    isFiniteNumber(prior.ppe ?? null) &&
    (prior.depreciation ?? 0) + (prior.ppe ?? 0) > 0
      ? (prior.depreciation ?? 0) /
        ((prior.depreciation ?? 0) + (prior.ppe ?? 0))
      : null;
  const depi = safeDiv(depSharePrior, depShareCur);

  // SGAI = (sga/sales)_current / same_prior
  const sgaShareCur = safeDiv(current.sga ?? null, current.revenue);
  const sgaSharePrior = safeDiv(prior.sga ?? null, prior.revenue);
  const sgai = safeDiv(sgaShareCur, sgaSharePrior);

  // TATA = (NI − CFO) / TotalAssets, current period
  const tata =
    isFiniteNumber(current.netIncome) &&
    isFiniteNumber(current.cfo) &&
    isFinitePositive(current.totalAssets)
      ? (current.netIncome - current.cfo) / current.totalAssets
      : null;

  // LVGI = (totalDebt/totalAssets)_current / same_prior
  const levCur = safeDiv(current.totalDebt ?? null, current.totalAssets);
  const levPrior = safeDiv(prior.totalDebt ?? null, prior.totalAssets);
  const lvgi = safeDiv(levCur, levPrior);

  if (
    dsri === null ||
    gmi === null ||
    aqi === null ||
    sgi === null ||
    depi === null ||
    sgai === null ||
    tata === null ||
    lvgi === null
  ) {
    return null;
  }

  const m =
    -4.84 +
    0.92 * dsri +
    0.528 * gmi +
    0.404 * aqi +
    0.892 * sgi +
    0.115 * depi -
    0.172 * sgai +
    4.679 * tata -
    0.327 * lvgi;

  return Number.isFinite(m) ? m : null;
}

// ---- Sloan accruals ---------------------------------------------------

/**
 * Sloan accruals ratio = (NetIncome − CFO) / TotalAssets, current period.
 *
 * Lower (more negative) is better — large positive accruals signal
 * earnings driven by accruals rather than cash. Above ~0.10 is a flag.
 */
export function sloanAccruals(
  current: FundamentalsCurrent | null,
): number | null {
  if (!current) return null;
  const { netIncome, cfo, totalAssets } = current;
  if (
    !isFiniteNumber(netIncome) ||
    !isFiniteNumber(cfo) ||
    !isFinitePositive(totalAssets)
  ) {
    return null;
  }
  const v = (netIncome - cfo) / totalAssets;
  return Number.isFinite(v) ? v : null;
}

// ---- Aggregator -------------------------------------------------------

/**
 * Compute all four scores for a (current, prior) pair. The optional
 * `periodBeforePrior` parameter lets the caller fill in priorPiotroski
 * for period-over-period drop detection.
 */
export function computeQualityScores(
  current: FundamentalsCurrent | null,
  prior: FundamentalsPrior | null,
  periodBeforePrior?: FundamentalsPrior | null,
): QualityScores {
  const piotroski = piotroskiFScore(current, prior);
  const altmanZ = altmanZScore(current);
  const beneishM = beneishMScore(current, prior);
  const sloanAccr = sloanAccruals(current);

  let priorPiotroski: number | null | undefined;
  if (prior && periodBeforePrior) {
    // Treat 'prior' as the current period and 'periodBeforePrior' as
    // its prior — mirrors the same input shape so we can re-use the
    // function. Fields outside FundamentalsCurrent (ebit, marketCap)
    // aren't needed for Piotroski.
    priorPiotroski = piotroskiFScore(
      prior as unknown as FundamentalsCurrent,
      periodBeforePrior,
    );
  } else {
    priorPiotroski = null;
  }

  return {
    piotroski,
    altmanZ,
    beneishM,
    sloanAccruals: sloanAccr,
    priorPiotroski,
  };
}
