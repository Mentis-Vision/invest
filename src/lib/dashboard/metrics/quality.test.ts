// src/lib/dashboard/metrics/quality.test.ts
//
// TDD coverage for the fundamental quality primitives — Piotroski F-Score,
// Altman Z-Score, Beneish M-Score, and Sloan Accruals. Inputs are the
// FundamentalsCurrent / FundamentalsPrior shapes the loader normalizes
// into; tests use synthetic AAPL-like values so the assertions can be
// reproduced by hand.

import { describe, it, expect } from "vitest";
import {
  piotroskiFScore,
  altmanZScore,
  beneishMScore,
  sloanAccruals,
  computeQualityScores,
  type FundamentalsCurrent,
  type FundamentalsPrior,
} from "./quality";

// A healthy, all-improving company: every Piotroski check should pass.
const HEALTHY_CURRENT: FundamentalsCurrent = {
  netIncome: 100_000,
  totalAssets: 1_000_000,
  cfo: 130_000,
  longTermDebt: 200_000,
  currentAssets: 400_000,
  currentLiabilities: 200_000,
  sharesOutstanding: 1_000_000,
  grossProfit: 400_000,
  revenue: 1_200_000,
  totalLiabilities: 500_000,
  retainedEarnings: 600_000,
  ebit: 180_000,
  marketCap: 5_000_000,
  accountsReceivable: 60_000,
  ppe: 300_000,
  depreciation: 30_000,
  sga: 120_000,
  totalDebt: 250_000,
};

const HEALTHY_PRIOR: FundamentalsPrior = {
  netIncome: 70_000,
  totalAssets: 950_000,
  cfo: 90_000,
  longTermDebt: 230_000,
  currentAssets: 360_000,
  currentLiabilities: 220_000,
  sharesOutstanding: 1_000_000,
  grossProfit: 350_000,
  revenue: 1_100_000,
  totalLiabilities: 520_000,
  accountsReceivable: 50_000,
  ppe: 290_000,
  depreciation: 28_000,
  sga: 115_000,
  totalDebt: 270_000,
};

// A company deteriorating across the board.
const SICK_CURRENT: FundamentalsCurrent = {
  netIncome: -50_000,
  totalAssets: 800_000,
  cfo: -30_000,
  longTermDebt: 400_000,
  currentAssets: 200_000,
  currentLiabilities: 280_000,
  sharesOutstanding: 1_200_000, // dilution
  grossProfit: 200_000,
  revenue: 900_000,
  totalLiabilities: 700_000,
  retainedEarnings: 50_000,
  ebit: -40_000,
  marketCap: 400_000,
  accountsReceivable: 200_000,
  ppe: 250_000,
  depreciation: 40_000,
  sga: 200_000,
  totalDebt: 500_000,
};

const SICK_PRIOR: FundamentalsPrior = {
  netIncome: 20_000,
  totalAssets: 850_000,
  cfo: 40_000,
  longTermDebt: 380_000,
  currentAssets: 250_000,
  currentLiabilities: 250_000,
  sharesOutstanding: 1_000_000,
  grossProfit: 240_000,
  revenue: 1_000_000,
  totalLiabilities: 650_000,
  accountsReceivable: 80_000,
  ppe: 260_000,
  depreciation: 35_000,
  sga: 180_000,
  totalDebt: 450_000,
};

describe("piotroskiFScore", () => {
  it("returns null when current is missing", () => {
    expect(piotroskiFScore(null as unknown as FundamentalsCurrent, HEALTHY_PRIOR)).toBeNull();
  });
  it("returns null when prior is missing", () => {
    expect(piotroskiFScore(HEALTHY_CURRENT, null as unknown as FundamentalsPrior)).toBeNull();
  });
  it("scores 8 or 9 for an all-improving company", () => {
    const score = piotroskiFScore(HEALTHY_CURRENT, HEALTHY_PRIOR);
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThanOrEqual(8);
  });
  it("scores 0 or 1 for a deteriorating company", () => {
    const score = piotroskiFScore(SICK_CURRENT, SICK_PRIOR);
    expect(score).not.toBeNull();
    expect(score!).toBeLessThanOrEqual(1);
  });
  it("returns null when too many required fields are missing", () => {
    // Strip enough fields that we can't even compute half the checks.
    const sparse: FundamentalsCurrent = {
      netIncome: null,
      totalAssets: null,
      cfo: null,
      longTermDebt: null,
      currentAssets: null,
      currentLiabilities: null,
      sharesOutstanding: null,
      grossProfit: null,
      revenue: null,
    };
    const sparsePrior: FundamentalsPrior = {
      netIncome: null,
      totalAssets: null,
      cfo: null,
      longTermDebt: null,
      currentAssets: null,
      currentLiabilities: null,
      sharesOutstanding: null,
      grossProfit: null,
      revenue: null,
    };
    expect(piotroskiFScore(sparse, sparsePrior)).toBeNull();
  });
});

describe("altmanZScore", () => {
  it("returns null with insufficient inputs", () => {
    expect(
      altmanZScore({
        ...HEALTHY_CURRENT,
        totalAssets: null,
      }),
    ).toBeNull();
  });
  it("rates a healthy company as safe (Z > 2.99)", () => {
    const z = altmanZScore(HEALTHY_CURRENT);
    expect(z).not.toBeNull();
    expect(z!).toBeGreaterThan(2.99);
  });
  it("rates a distressed company as in distress (Z < 1.81)", () => {
    const z = altmanZScore(SICK_CURRENT);
    expect(z).not.toBeNull();
    expect(z!).toBeLessThan(1.81);
  });
});

describe("beneishMScore", () => {
  it("returns null with insufficient inputs", () => {
    expect(
      beneishMScore({ ...HEALTHY_CURRENT, accountsReceivable: null }, HEALTHY_PRIOR),
    ).toBeNull();
  });
  it("rates a stable, healthy company as non-manipulator (M < -1.78)", () => {
    const m = beneishMScore(HEALTHY_CURRENT, HEALTHY_PRIOR);
    expect(m).not.toBeNull();
    expect(m!).toBeLessThan(-1.78);
  });
  it("rates an aggressive-accruals + receivables-spike company as likely manipulator (M > -1.78)", () => {
    // Build a company with classic Beneish red flags: receivables exploding,
    // sales growth, big positive accruals, leverage rising.
    const sketchyCurrent: FundamentalsCurrent = {
      ...HEALTHY_CURRENT,
      revenue: 2_000_000, // sales +66% (huge SGI)
      accountsReceivable: 600_000, // AR exploding (DSRI flips)
      netIncome: 500_000,
      cfo: 50_000, // huge accruals
      grossProfit: 400_000, // gross margin fell vs prior
      sga: 200_000,
      totalDebt: 600_000, // leverage way up
      ppe: 200_000, // PPE fell, AQI flips
      depreciation: 20_000,
    };
    const m = beneishMScore(sketchyCurrent, HEALTHY_PRIOR);
    expect(m).not.toBeNull();
    expect(m!).toBeGreaterThan(-1.78);
  });
});

describe("sloanAccruals", () => {
  it("returns 0 when net income equals CFO", () => {
    const ratio = sloanAccruals({
      ...HEALTHY_CURRENT,
      netIncome: 100_000,
      cfo: 100_000,
      totalAssets: 1_000_000,
    });
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeCloseTo(0, 6);
  });
  it("is positive (and large) when net income greatly exceeds CFO", () => {
    const ratio = sloanAccruals({
      ...HEALTHY_CURRENT,
      netIncome: 200_000,
      cfo: 50_000,
      totalAssets: 1_000_000,
    });
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeCloseTo(0.15, 6);
  });
  it("is negative (conservative) when CFO exceeds net income", () => {
    const ratio = sloanAccruals({
      ...HEALTHY_CURRENT,
      netIncome: 50_000,
      cfo: 100_000,
      totalAssets: 1_000_000,
    });
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeCloseTo(-0.05, 6);
  });
  it("returns null when totalAssets is missing", () => {
    expect(
      sloanAccruals({
        ...HEALTHY_CURRENT,
        totalAssets: null,
      }),
    ).toBeNull();
  });
});

describe("computeQualityScores", () => {
  it("returns all 4 scores for a fully-populated current+prior", () => {
    const scores = computeQualityScores(HEALTHY_CURRENT, HEALTHY_PRIOR);
    expect(scores.piotroski).not.toBeNull();
    expect(scores.altmanZ).not.toBeNull();
    expect(scores.beneishM).not.toBeNull();
    expect(scores.sloanAccruals).not.toBeNull();
  });
  it("returns null for piotroski/beneish but a value for altman/sloan when prior is missing", () => {
    const scores = computeQualityScores(HEALTHY_CURRENT, null);
    expect(scores.piotroski).toBeNull();
    expect(scores.beneishM).toBeNull();
    // Altman + Sloan only need current period
    expect(scores.altmanZ).not.toBeNull();
    expect(scores.sloanAccruals).not.toBeNull();
  });
  it("carries priorPiotroski when both periods are present", () => {
    const scores = computeQualityScores(HEALTHY_CURRENT, HEALTHY_PRIOR);
    // priorPiotroski is undefined unless caller supplies a 'period before prior'.
    // For now we only require that the field shape exists.
    expect(scores).toHaveProperty("priorPiotroski");
  });
});
