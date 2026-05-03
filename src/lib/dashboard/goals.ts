// src/lib/dashboard/goals.ts
// Pure math for the Phase 3 goals layer:
//
//   - targetAllocation(age, risk) — age-based glidepath ("120 - age" rule)
//     modulated by a risk-tolerance offset. Returns whole-percent stocks
//     / bonds / cash that always sum to 100. Used by queue-builder to
//     emit the `rebalance_drift` item when actual stock allocation
//     deviates by >5pp from the target.
//
//   - pacingProjection(currentValue, monthlyContribution, targetValue,
//     targetDate, expectedAnnualReturn) — future-value of the user's
//     portfolio at the target date assuming the expected return, plus
//     the gap to target and the CAGR they'd need to hit it. Pure FV
//     formula with periodic contributions:
//         FV = PV(1+r)^t + PMT * (((1+r)^t - 1) / r)
//     The required-CAGR solve is a 60-step binary search on the same
//     formula — converges to ~6 decimal places.
//
// Zero side effects. No DB. No I/O. Tested independently in goals.test.ts.

export type RiskTolerance = "conservative" | "moderate" | "aggressive";

export interface TargetAllocation {
  stocksPct: number;
  bondsPct: number;
  cashPct: number;
}

/**
 * Standard "120 - age" stocks-allocation rule, with a risk-tolerance
 * offset and a hard 5% cash floor:
 *
 *   conservative → -15pp stocks (more bonds + cash)
 *   moderate     →   0
 *   aggressive   → +10pp stocks
 *
 * Stocks are clamped to [20, 95]. Bonds = 100 - stocks - 5 (cash floor),
 * also clamped to [0, 80]. Cash = whatever's left so the buckets always
 * sum to exactly 100. Whole-percent rounding makes equality / drift
 * checks deterministic.
 */
export function targetAllocation(
  age: number,
  risk: RiskTolerance,
): TargetAllocation {
  const baseStocks = Math.max(20, Math.min(95, 120 - age));
  const offset =
    risk === "conservative" ? -15 : risk === "aggressive" ? 10 : 0;
  const stocks = Math.max(20, Math.min(95, baseStocks + offset));
  const bonds = Math.max(0, Math.min(80, 100 - stocks - 5));
  const cash = 100 - stocks - bonds;
  return { stocksPct: stocks, bondsPct: bonds, cashPct: cash };
}

export interface PacingProjection {
  /** projectedValue >= targetValue at expectedAnnualReturn */
  onTrack: boolean;
  /** CAGR needed to exactly hit targetValue. Solved via binary search. */
  requiredAnnualReturn: number;
  /** Future value at the target date assuming expectedAnnualReturn. */
  projectedValue: number;
  /** Shortfall vs target — positive means behind, negative means ahead. */
  gapDollars: number;
  /** Years between now and targetDate (clamped to ≥0). */
  yearsRemaining: number;
}

/**
 * Compute future value of a lump sum + periodic contributions at a
 * given annual return.
 *
 *   FV = PV(1+r)^t + PMT_yr * (((1+r)^t - 1) / r)
 *
 * The 1e-9 floor on r prevents division by zero when r === 0; the limit
 * of the formula as r→0 is PV + PMT_yr * t, which the floor approximates
 * to ~9 decimal places of precision.
 */
function futureValue(
  presentValue: number,
  annualContribution: number,
  annualReturn: number,
  years: number,
): number {
  const r = annualReturn;
  const t = years;
  const safeR = Math.abs(r) < 1e-9 ? (r >= 0 ? 1e-9 : -1e-9) : r;
  return (
    presentValue * Math.pow(1 + r, t) +
    annualContribution * ((Math.pow(1 + r, t) - 1) / safeR)
  );
}

/**
 * "Are you on pace?" given the user's current portfolio value, monthly
 * contribution, target, and the expected long-run return (default 7%
 * — roughly the long-run real-return-after-inflation of a 60/40
 * portfolio).
 *
 * Returns four numbers:
 *   - projectedValue: where the portfolio lands at targetDate assuming
 *     `expectedAnnualReturn`
 *   - onTrack: projectedValue >= targetValue
 *   - gapDollars: targetValue - projectedValue (positive = behind)
 *   - requiredAnnualReturn: CAGR they'd need to exactly hit target
 *
 * If targetDate is in the past, yearsRemaining is 0 and the result is
 * effectively a comparison of currentValue vs targetValue.
 */
export function pacingProjection(
  currentValue: number,
  monthlyContribution: number,
  targetValue: number,
  targetDate: Date,
  expectedAnnualReturn = 0.07,
): PacingProjection {
  const now = new Date();
  const yearsRemaining = Math.max(
    0,
    (targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 365.25),
  );

  if (yearsRemaining === 0) {
    return {
      onTrack: currentValue >= targetValue,
      requiredAnnualReturn: 0,
      projectedValue: currentValue,
      gapDollars: targetValue - currentValue,
      yearsRemaining: 0,
    };
  }

  const annualContribution = monthlyContribution * 12;
  const projectedValue = futureValue(
    currentValue,
    annualContribution,
    expectedAnnualReturn,
    yearsRemaining,
  );
  const onTrack = projectedValue >= targetValue;
  const gapDollars = targetValue - projectedValue;

  // Binary search the CAGR needed to hit targetValue. Search range
  // [-50%, +100%] is generous — outside of it, the user has either
  // wildly impossible goals or a portfolio that already over-shoots.
  let lo = -0.5;
  let hi = 1.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fv = futureValue(
      currentValue,
      annualContribution,
      mid,
      yearsRemaining,
    );
    if (fv < targetValue) lo = mid;
    else hi = mid;
  }
  const requiredAnnualReturn = (lo + hi) / 2;

  return {
    onTrack,
    requiredAnnualReturn,
    projectedValue,
    gapDollars,
    yearsRemaining,
  };
}
