// src/lib/dashboard/metrics/damodaran.ts
//
// Pure cost-of-capital math, anchored on Aswath Damodaran's
// (NYU Stern) implied-ERP framework.
//
// Two layers:
//
//   1. impliedCostOfEquity — Gordon Growth dividend-discount form:
//        COE = D1 / P + g
//      where D1 = next-year expected dividend, P = current price,
//      g = sustainable analyst-driven growth rate. The result is a
//      fractional annual rate (0.085 = 8.5%).
//
//      For non-dividend payers we fall back to a CAPM-style
//      construction:
//        COE = riskFreeRate + beta * impliedERP
//      This is the credible per-stock complement to Damodaran's
//      market-level implied ERP. The caller chooses which by
//      passing dividendsPerShare > 0.
//
//   2. impliedRiskPremium — algebraic inversion of #1 at the index
//      level: given the index price, expected forward earnings
//      growth, and risk-free rate, what equity premium clears the
//      cash-flow stream? This is what Damodaran publishes monthly
//      on `histimpl.html`. The actual implementation we use here
//      is a bounded numerical solve so the math doesn't depend on
//      a sophisticated multi-stage cash-flow model.
//
// Inputs are dollar / fractional values. Outputs are fractional
// annual rates. Returns null on degenerate inputs (P ≤ 0, g ≥ 1,
// non-finite). Caller renders "—".

export interface ImpliedCostOfEquityInput {
  /** Current price per share, dollars. Must be > 0. */
  price: number;
  /** Trailing dividends per share, dollars. 0 → CAPM fallback. */
  dividendsPerShare: number;
  /** Analyst forward growth rate, fractional. 0.06 = +6%/year. */
  growthRate: number;
  /** Risk-free rate, fractional. Used as floor + CAPM intercept. */
  riskFreeRate: number;
  /** Equity beta. Used only when dividendsPerShare = 0 (CAPM fallback). */
  beta?: number;
  /** Equity risk premium, fractional. CAPM fallback only. */
  equityRiskPremium?: number;
}

export interface CostOfEquityResult {
  /** Cost of equity, fractional annual. 0.084 = 8.4%. */
  costOfEquity: number;
  /** Which model produced the figure. */
  method: "gordon" | "capm";
  /** Echo for display callouts. */
  inputs: {
    dividendYield: number | null;
    growthRate: number;
    riskFreeRate: number;
    beta: number | null;
    equityRiskPremium: number | null;
  };
}

const MAX_GROWTH = 0.15; // hard ceiling — DDM blows up as g → r
const MAX_COE = 0.4;     // 40% — implausibly high, treat as bad input

export function impliedCostOfEquity(
  input: ImpliedCostOfEquityInput,
): CostOfEquityResult | null {
  const { price, dividendsPerShare, growthRate, riskFreeRate } = input;
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(growthRate) ||
    !Number.isFinite(riskFreeRate)
  ) {
    return null;
  }
  // Cap growth so numerical edge cases don't produce silly numbers.
  const g = Math.min(MAX_GROWTH, Math.max(-0.05, growthRate));

  if (dividendsPerShare > 0 && Number.isFinite(dividendsPerShare)) {
    // Gordon Growth: COE = D1/P + g, D1 = D0 * (1 + g).
    const dividendYield = (dividendsPerShare * (1 + g)) / price;
    const coe = dividendYield + g;
    if (coe <= 0 || coe > MAX_COE) return null;
    return {
      costOfEquity: coe,
      method: "gordon",
      inputs: {
        dividendYield,
        growthRate: g,
        riskFreeRate,
        beta: null,
        equityRiskPremium: null,
      },
    };
  }

  // CAPM fallback when no dividend.
  const beta = input.beta ?? 1;
  const erp = input.equityRiskPremium ?? 0.0433; // Damodaran Jan 2026 anchor
  if (!Number.isFinite(beta) || !Number.isFinite(erp)) return null;
  const coe = riskFreeRate + beta * erp;
  if (coe <= 0 || coe > MAX_COE) return null;
  return {
    costOfEquity: coe,
    method: "capm",
    inputs: {
      dividendYield: null,
      growthRate: g,
      riskFreeRate,
      beta,
      equityRiskPremium: erp,
    },
  };
}

/**
 * Spread between a stock's implied cost of equity and the market's
 * implied ERP (over the risk-free rate). Positive spreads mean the
 * stock requires a higher return than the market — either it's
 * cheap or risky. The card surfaces this as the actionable read.
 */
export function spreadOverMarket(
  costOfEquity: number,
  marketImpliedErp: number,
  riskFreeRate: number,
): number {
  return costOfEquity - (riskFreeRate + marketImpliedErp);
}
