// src/lib/dashboard/metrics/damodaran.test.ts
//
// Spot checks for Gordon Growth and CAPM fallback. Hand-calculated
// values keep the assertions transparent.

import { describe, it, expect } from "vitest";
import { impliedCostOfEquity, spreadOverMarket } from "./damodaran";

describe("impliedCostOfEquity", () => {
  it("Gordon Growth: dividend payer", () => {
    // D0 = 4.00, g = 5%, P = 100  →  D1 = 4.20, yield = 4.2%, COE = 9.2%
    const result = impliedCostOfEquity({
      price: 100,
      dividendsPerShare: 4,
      growthRate: 0.05,
      riskFreeRate: 0.04,
    });
    expect(result).not.toBeNull();
    expect(result!.method).toBe("gordon");
    expect(result!.costOfEquity).toBeCloseTo(0.092, 3);
    expect(result!.inputs.dividendYield).toBeCloseTo(0.042, 3);
  });

  it("CAPM fallback: non-dividend payer", () => {
    // rf = 4%, beta = 1.2, ERP = 4.33% → COE = 4 + 1.2*4.33 = 9.196%
    const result = impliedCostOfEquity({
      price: 50,
      dividendsPerShare: 0,
      growthRate: 0.1,
      riskFreeRate: 0.04,
      beta: 1.2,
      equityRiskPremium: 0.0433,
    });
    expect(result).not.toBeNull();
    expect(result!.method).toBe("capm");
    expect(result!.costOfEquity).toBeCloseTo(0.04 + 1.2 * 0.0433, 4);
  });

  it("CAPM defaults: beta=1 + Jan 2026 ERP anchor", () => {
    const result = impliedCostOfEquity({
      price: 50,
      dividendsPerShare: 0,
      growthRate: 0.05,
      riskFreeRate: 0.04,
    });
    expect(result).not.toBeNull();
    expect(result!.method).toBe("capm");
    // 4% + 4.33% = 8.33%
    expect(result!.costOfEquity).toBeCloseTo(0.0833, 3);
  });

  it("returns null on price ≤ 0", () => {
    const result = impliedCostOfEquity({
      price: 0,
      dividendsPerShare: 1,
      growthRate: 0.05,
      riskFreeRate: 0.04,
    });
    expect(result).toBeNull();
  });

  it("caps growth rate to prevent blow-up", () => {
    // g > MAX_GROWTH (0.15) gets clipped — output should still be sane.
    const result = impliedCostOfEquity({
      price: 100,
      dividendsPerShare: 2,
      growthRate: 0.5,
      riskFreeRate: 0.04,
    });
    expect(result).not.toBeNull();
    expect(result!.inputs.growthRate).toBe(0.15);
    expect(result!.costOfEquity).toBeLessThan(0.4);
  });

  it("returns null when implied COE is impossible (negative growth + no dividend yield)", () => {
    // After cap g = -0.05; D1 = 0.95; yield = 0.95/1000 = 0.00095; COE = -0.0490
    // Negative → null.
    const result = impliedCostOfEquity({
      price: 1000,
      dividendsPerShare: 1,
      growthRate: -0.5,
      riskFreeRate: 0.04,
    });
    expect(result).toBeNull();
  });

  it("returns null on non-finite inputs", () => {
    const result = impliedCostOfEquity({
      price: Number.NaN,
      dividendsPerShare: 1,
      growthRate: 0.05,
      riskFreeRate: 0.04,
    });
    expect(result).toBeNull();
  });
});

describe("spreadOverMarket", () => {
  it("positive when stock requires higher return than market", () => {
    // COE = 12%, market = rf+ERP = 4 + 4.33 = 8.33%
    expect(spreadOverMarket(0.12, 0.0433, 0.04)).toBeCloseTo(0.0367, 3);
  });
  it("negative when stock requires lower return than market", () => {
    // COE = 6%, market = 8.33%
    expect(spreadOverMarket(0.06, 0.0433, 0.04)).toBeCloseTo(-0.0233, 3);
  });
});
