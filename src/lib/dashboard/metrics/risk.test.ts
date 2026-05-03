// src/lib/dashboard/metrics/risk.test.ts
//
// TDD coverage for the pure risk-math primitives. No DB, no I/O —
// every test runs against synthetic return series whose expected
// values can be computed by hand or against well-known invariants.

import { describe, it, expect } from "vitest";
import {
  meanReturn,
  stdDev,
  downsideDeviation,
  annualize,
  annualizedVol,
  sharpeRatio,
  sortinoRatio,
  maxDrawdown,
  beta,
  computePortfolioRisk,
} from "./risk";

describe("meanReturn", () => {
  it("returns 0 on empty input", () => {
    expect(meanReturn([])).toBe(0);
  });
  it("returns the single element when only one observation", () => {
    expect(meanReturn([0.05])).toBeCloseTo(0.05, 10);
  });
  it("computes the arithmetic mean of a known series", () => {
    expect(meanReturn([0.01, -0.005, 0.003])).toBeCloseTo(
      (0.01 - 0.005 + 0.003) / 3,
      10,
    );
  });
});

describe("stdDev", () => {
  it("returns 0 on empty or single-element input", () => {
    expect(stdDev([])).toBe(0);
    expect(stdDev([0.01])).toBe(0);
  });
  it("returns 0 for a constant series", () => {
    expect(stdDev([0.005, 0.005, 0.005, 0.005])).toBeCloseTo(0, 10);
  });
  it("computes sample standard deviation (n-1 denominator)", () => {
    // [0, 0.02], mean=0.01, variance = (0.01)^2 + (-0.01)^2 = 0.0002,
    // sample variance = 0.0002 / (2-1) = 0.0002, stddev ~= 0.01414213562
    expect(stdDev([0, 0.02])).toBeCloseTo(Math.SQRT2 * 0.01, 6);
  });
});

describe("downsideDeviation", () => {
  it("returns 0 on too-small input", () => {
    expect(downsideDeviation([])).toBe(0);
    expect(downsideDeviation([0.01])).toBe(0);
  });
  it("returns 0 when every return meets the MAR (no downside)", () => {
    expect(downsideDeviation([0.01, 0.02, 0.03])).toBeCloseTo(0, 10);
  });
  it("captures only negative deviations from MAR", () => {
    // [-0.01, +0.02, -0.03] vs MAR=0:
    // downside vector = [-0.01, 0, -0.03]
    // sumSq = 0.0001 + 0 + 0.0009 = 0.001
    // dvol = sqrt(0.001 / (3-1)) = sqrt(0.0005) ~= 0.02236067977
    expect(downsideDeviation([-0.01, 0.02, -0.03])).toBeCloseTo(
      Math.sqrt(0.0005),
      6,
    );
  });
});

describe("annualize / annualizedVol", () => {
  it("annualize multiplies by periodsPerYear", () => {
    expect(annualize(0.001)).toBeCloseTo(0.252, 10);
    expect(annualize(0.001, 12)).toBeCloseTo(0.012, 10);
  });
  it("annualizedVol scales by sqrt(periodsPerYear)", () => {
    expect(annualizedVol(0.01)).toBeCloseTo(0.01 * Math.sqrt(252), 10);
    expect(annualizedVol(0.05, 12)).toBeCloseTo(0.05 * Math.sqrt(12), 10);
  });
});

describe("sharpeRatio", () => {
  it("returns 0 on too-small input", () => {
    expect(sharpeRatio([])).toBe(0);
    expect(sharpeRatio([0.01])).toBe(0);
  });
  it("returns 0 when volatility is zero (constant series)", () => {
    // constant series with equal returns -> stddev 0 -> guard returns 0
    expect(sharpeRatio([0.001, 0.001, 0.001, 0.001])).toBe(0);
  });
  it("is positive when daily mean return exceeds the risk-free drag", () => {
    // small consistent positive returns: mean*252 well above 4% rf, low vol.
    const series = [0.002, 0.001, 0.003, 0.0015, 0.002, 0.0025, 0.0018];
    expect(sharpeRatio(series)).toBeGreaterThan(0);
  });
  it("is negative when annualized return is below the risk-free rate", () => {
    // mean ~ 0 with non-zero vol => Sharpe ~ -rf/sigma < 0
    const series = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
    expect(sharpeRatio(series)).toBeLessThan(0);
  });
});

describe("sortinoRatio", () => {
  it("returns 0 on too-small input", () => {
    expect(sortinoRatio([])).toBe(0);
    expect(sortinoRatio([0.01])).toBe(0);
  });
  it("returns 0 when there is no downside deviation", () => {
    // all-positive returns → downside deviation 0 → guard returns 0
    expect(sortinoRatio([0.01, 0.02, 0.015, 0.012])).toBe(0);
  });
  it("is positive for a series with mostly positive returns and limited drawdown", () => {
    const series = [0.005, 0.004, -0.002, 0.006, 0.003, -0.001, 0.004];
    expect(sortinoRatio(series)).toBeGreaterThan(0);
  });
});

describe("maxDrawdown", () => {
  it("returns 0 on empty input", () => {
    expect(maxDrawdown([])).toBe(0);
  });
  it("returns 0 for a strictly rising series (no drawdown)", () => {
    expect(maxDrawdown([0.01, 0.02, 0.005, 0.01])).toBeCloseTo(0, 10);
  });
  it("captures the trough of a down-then-up series", () => {
    // [-0.1, -0.1, 0.1]:
    // cum = 0.9, then 0.81 (peak still 1, dd=-0.19), then 0.891 (still recovering, peak=1)
    // maxDd = -0.19
    expect(maxDrawdown([-0.1, -0.1, 0.1])).toBeCloseTo(-0.19, 6);
  });
  it("approaches -1 for a long monotone-down series", () => {
    const series = Array.from({ length: 50 }, () => -0.1);
    expect(maxDrawdown(series)).toBeLessThan(-0.99);
  });
});

describe("beta", () => {
  it("returns 0 on length mismatch", () => {
    expect(beta([0.01, 0.02], [0.01])).toBe(0);
  });
  it("returns 0 on too-small input", () => {
    expect(beta([0.01], [0.01])).toBe(0);
    expect(beta([], [])).toBe(0);
  });
  it("returns 1.0 for an identical series", () => {
    const series = [0.01, -0.005, 0.02, -0.01, 0.015];
    expect(beta(series, series)).toBeCloseTo(1, 10);
  });
  it("returns -1.0 for an exact inverse series", () => {
    const a = [0.01, -0.005, 0.02, -0.01, 0.015];
    const b = a.map((r) => -r);
    expect(beta(a, b)).toBeCloseTo(-1, 10);
  });
  it("returns 0 when the benchmark is flat (variance 0)", () => {
    expect(beta([0.01, -0.005, 0.02], [0.005, 0.005, 0.005])).toBe(0);
  });
});

describe("computePortfolioRisk", () => {
  it("returns an object with all 7 fields populated for a non-trivial series", () => {
    const portfolio = [0.005, -0.002, 0.007, 0.001, -0.004, 0.006];
    const benchmark = [0.004, -0.001, 0.005, 0.0, -0.003, 0.005];
    const out = computePortfolioRisk(portfolio, benchmark);
    expect(out).toHaveProperty("sharpe");
    expect(out).toHaveProperty("sortino");
    expect(out).toHaveProperty("maxDrawdownPct");
    expect(out).toHaveProperty("beta");
    expect(out).toHaveProperty("ytdPct");
    expect(out).toHaveProperty("benchYtdPct");
    expect(out).toHaveProperty("sampleSize");
    expect(out.sampleSize).toBe(portfolio.length);
    // ytdPct: cumulative product of (1+r) − 1
    const expectedYtd =
      portfolio.reduce((c, r) => c * (1 + r), 1) - 1;
    expect(out.ytdPct).toBeCloseTo(expectedYtd, 10);
    const expectedBench =
      benchmark.reduce((c, r) => c * (1 + r), 1) - 1;
    expect(out.benchYtdPct).toBeCloseTo(expectedBench, 10);
  });
});
