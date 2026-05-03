// src/lib/dashboard/metrics/stress-test.test.ts
//
// Pure-math tests for stress-test scenario application.

import { describe, it, expect } from "vitest";
import {
  applyShock,
  runStressScenarios,
  formatStressReturn,
  HISTORICAL_SHOCKS,
} from "./stress-test";
import type { FactorExposure } from "./fama-french";

const beta3 = { mktRf: 1.0, smb: 0.0, hml: 0.0 };
const beta3small = { mktRf: 1.2, smb: 0.5, hml: -0.3 };

const exp3 = (betas: typeof beta3): FactorExposure => ({
  alpha: 0.02,
  betas,
  rSquared: 0.85,
  observations: 252,
  fiveFactor: false,
});

const exp5 = (
  betas: typeof beta3 & { rmw?: number; cma?: number },
): FactorExposure => ({
  alpha: 0.01,
  betas,
  rSquared: 0.9,
  observations: 252,
  fiveFactor: true,
});

describe("applyShock", () => {
  it("returns the market-shock for a unit-beta portfolio", () => {
    const r = applyShock(
      beta3,
      HISTORICAL_SHOCKS[0],
      false,
    );
    expect(r).toBeCloseTo(-0.51, 6);
  });

  it("scales by market beta", () => {
    const r = applyShock({ mktRf: 1.5, smb: 0, hml: 0 }, HISTORICAL_SHOCKS[0], false);
    expect(r).toBeCloseTo(1.5 * -0.51, 6);
  });

  it("includes SMB and HML legs", () => {
    const r = applyShock(beta3small, HISTORICAL_SHOCKS[0], false);
    // 1.2*-0.51 + 0.5*-0.04 + -0.3*-0.18 = -0.612 + -0.02 + 0.054 = -0.578
    expect(r).toBeCloseTo(-0.578, 4);
  });

  it("includes RMW + CMA legs in 5-factor mode", () => {
    const r = applyShock(
      { mktRf: 1.0, smb: 0, hml: 0, rmw: 0.5, cma: -0.2 },
      HISTORICAL_SHOCKS[0],
      true,
    );
    // 1.0*-0.51 + 0 + 0 + 0.5*-0.06 + -0.2*0.02 = -0.51 - 0.03 - 0.004 = -0.544
    expect(r).toBeCloseTo(-0.544, 4);
  });

  it("returns null when mkt-rf beta is non-finite", () => {
    const r = applyShock({ mktRf: NaN, smb: 0, hml: 0 }, HISTORICAL_SHOCKS[0], false);
    expect(r).toBeNull();
  });
});

describe("runStressScenarios", () => {
  it("returns null when exposure is null", () => {
    expect(runStressScenarios(null)).toBeNull();
  });

  it("returns one result per scenario for a 3-factor exposure", () => {
    const out = runStressScenarios(exp3(beta3));
    expect(out?.length).toBe(HISTORICAL_SHOCKS.length);
    const gfc = out?.find((r) => r.label.includes("GFC"));
    expect(gfc?.projectedReturn).toBeCloseTo(-0.51, 6);
  });

  it("emits negative projection in all three default scenarios for a unit-beta portfolio", () => {
    const out = runStressScenarios(exp3(beta3));
    expect(out?.every((r) => r.projectedReturn < 0)).toBe(true);
  });

  it("uses 5-factor legs when exposure is 5-factor", () => {
    const out = runStressScenarios(
      exp5({ mktRf: 1.0, smb: 0, hml: 0, rmw: 0.5, cma: -0.2 }),
    );
    const gfc = out?.find((r) => r.label.includes("GFC"));
    expect(gfc?.projectedReturn).toBeCloseTo(-0.544, 4);
  });
});

describe("formatStressReturn", () => {
  it("formats negative returns", () => {
    expect(formatStressReturn(-0.384)).toBe("-38.4%");
  });

  it("formats positive returns with +", () => {
    expect(formatStressReturn(0.021)).toBe("+2.1%");
  });
});

describe("HISTORICAL_SHOCKS", () => {
  it("contains all three required scenarios", () => {
    expect(HISTORICAL_SHOCKS.length).toBe(3);
    const labels = HISTORICAL_SHOCKS.map((s) => s.label);
    expect(labels.some((l) => l.includes("GFC"))).toBe(true);
    expect(labels.some((l) => l.includes("COVID"))).toBe(true);
    expect(labels.some((l) => l.includes("Rates"))).toBe(true);
  });

  it("market shocks are negative or modest for all scenarios", () => {
    for (const s of HISTORICAL_SHOCKS) {
      expect(s.mktRf).toBeLessThan(0);
    }
  });
});
