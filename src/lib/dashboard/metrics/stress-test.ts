// src/lib/dashboard/metrics/stress-test.ts
//
// Phase 4 Batch K5 — historical stress-test scenarios.
//
// Apply hardcoded historical factor shocks to the user's Fama-French
// factor exposures (from Batch J1 regression) to project a portfolio
// drawdown under each replay:
//
//   * 2008 GFC peak-to-trough (Sep 2008 – Mar 2009)
//   * 2020 March COVID crash (Feb 19 – Mar 23 2020)
//   * Rates +100bps shock (long-duration shock; bond+rates-sensitive)
//
// Math:
//   Projected return = α + β_mkt · ΔMkt + β_smb · ΔSMB + β_hml · ΔHML
//                       (+ β_rmw · ΔRMW + β_cma · ΔCMA when 5-factor)
//
//   Alpha is excluded from the projection because it represents
//   manager-specific outperformance not derivable from factor shocks
//   alone — including it would falsely soften the bear-case.
//
// Pure module — historical shocks are constants, math is pure.
// The loader pulls live FactorExposure and feeds it here.

import type { FactorBetas, FactorExposure } from "./fama-french";

export interface FactorShock {
  /** Display label for the scenario card. */
  label: string;
  /** Short description shown beneath the label. */
  description: string;
  /** Cumulative shock to the Mkt-RF factor (fractional). */
  mktRf: number;
  /** Cumulative shock to SMB. */
  smb: number;
  /** Cumulative shock to HML. */
  hml: number;
  /** Cumulative shock to RMW (5-factor only). */
  rmw?: number;
  /** Cumulative shock to CMA (5-factor only). */
  cma?: number;
}

/**
 * Historical factor shocks. Sources:
 *
 *   2008 GFC: 2008-09-01 → 2009-03-09 (S&P −47%, Mkt-RF compounded
 *   ~ −51%, SMB compounded slightly negative as small-caps fell more,
 *   HML strongly negative as value/financials cratered).
 *
 *   2020 COVID: 2020-02-19 → 2020-03-23 (S&P −34% in 23 sessions,
 *   Mkt-RF compounded −36%, SMB modestly positive in selected windows
 *   but negative across the full crash, HML negative as growth +
 *   tech outperformed value).
 *
 *   Rates +100bps: long-duration shock — equities take a multiple
 *   compression of roughly −8% on a market beta of 1.0, with HML
 *   slightly positive (value benefits from steeper curve) and SMB
 *   negative (small caps more rate-sensitive due to leverage).
 *
 * All values are fractional cumulative returns over the scenario
 * window. They are deliberately deterministic and hardcoded — the
 * spec calls them out as "verifiable from public market data, not
 * parameterized."
 */
export const HISTORICAL_SHOCKS: FactorShock[] = [
  {
    label: "2008-09 GFC replay",
    description: "Sep 2008 – Mar 2009 peak-to-trough",
    mktRf: -0.51,
    smb: -0.04,
    hml: -0.18,
    rmw: -0.06,
    cma: 0.02,
  },
  {
    label: "2020-Mar COVID replay",
    description: "Feb 19 – Mar 23 2020",
    mktRf: -0.36,
    smb: -0.07,
    hml: -0.12,
    rmw: 0.01,
    cma: 0.04,
  },
  {
    label: "Rates +100bps",
    description: "Long-duration multiple compression",
    mktRf: -0.08,
    smb: -0.02,
    hml: 0.03,
    rmw: 0.0,
    cma: -0.02,
  },
];

export interface StressScenarioResult {
  /** Scenario label (matches FactorShock.label). */
  label: string;
  /** Scenario description. */
  description: string;
  /** Projected portfolio cumulative return (fractional, typically negative). */
  projectedReturn: number;
}

/**
 * Apply a single shock to a beta vector. Pure — no I/O.
 *
 * Returns null when betas is undefined or every leg is non-finite.
 */
export function applyShock(
  betas: FactorBetas,
  shock: FactorShock,
  fiveFactor: boolean,
): number | null {
  if (!Number.isFinite(betas.mktRf)) return null;
  let r = 0;
  r += betas.mktRf * shock.mktRf;
  r += (Number.isFinite(betas.smb) ? betas.smb : 0) * shock.smb;
  r += (Number.isFinite(betas.hml) ? betas.hml : 0) * shock.hml;
  if (fiveFactor) {
    if (Number.isFinite(betas.rmw ?? NaN) && Number.isFinite(shock.rmw ?? NaN)) {
      r += (betas.rmw ?? 0) * (shock.rmw ?? 0);
    }
    if (Number.isFinite(betas.cma ?? NaN) && Number.isFinite(shock.cma ?? NaN)) {
      r += (betas.cma ?? 0) * (shock.cma ?? 0);
    }
  }
  return r;
}

/**
 * Run all hardcoded scenarios against a user's factor exposure.
 * Returns one result per scenario. Returns null when exposure is
 * null (not enough portfolio history for a regression).
 */
export function runStressScenarios(
  exposure: FactorExposure | null,
  shocks: FactorShock[] = HISTORICAL_SHOCKS,
): StressScenarioResult[] | null {
  if (!exposure) return null;
  const out: StressScenarioResult[] = [];
  for (const shock of shocks) {
    const r = applyShock(exposure.betas, shock, exposure.fiveFactor);
    if (r === null) continue;
    out.push({
      label: shock.label,
      description: shock.description,
      projectedReturn: r,
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Format a fractional return as a signed percent: "-38.4%" / "+2.1%".
 */
export function formatStressReturn(r: number): string {
  const pct = r * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
