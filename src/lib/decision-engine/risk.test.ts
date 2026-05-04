// Focused tests for the fractional-Kelly integration in
// computePositionSizing. The wider decision-engine smoke coverage
// lives in decision-engine.test.ts; here we exercise just the
// Kelly-vs-risk-profile interaction so the safety property
// (Kelly never raises the suggested max) is locked in.

import { describe, expect, it } from "vitest";
import { computePositionSizing } from "./risk";
import type { DecisionEngineInput } from "./types";

function makeInput(
  overrides: {
    riskProfile?: DecisionEngineInput["riskProfile"];
    portfolio?: DecisionEngineInput["portfolio"];
    snapshot?: Partial<DecisionEngineInput["snapshot"]>;
  } = {},
): DecisionEngineInput {
  return {
    ticker: "ACME",
    asOf: "2026-04-29T00:00:00.000Z",
    riskProfile: overrides.riskProfile ?? "balanced",
    snapshot: {
      price: 100,
      marketCap: 50_000_000_000,
      peRatio: 24,
      forwardPE: 20,
      eps: 5,
      dividendYield: 0.01,
      fiftyTwoWeekHigh: 125,
      fiftyTwoWeekLow: 75,
      fiftyDayAvg: 104,
      twoHundredDayAvg: 90,
      volume: 2_000_000,
      avgVolume: 1_800_000,
      beta: 1.1,
      sector: "Technology",
      industry: "Software",
      analystTarget: 145,
      recommendationKey: "buy",
      ...overrides.snapshot,
    },
    portfolio: overrides.portfolio ?? {
      portfolioKnown: true,
      totalValue: 100_000,
      currentTickerValue: 2_000,
      currentTickerPct: 2,
      sectorExposurePct: 15,
    },
  };
}

describe("computePositionSizing — fractional Kelly integration", () => {
  it("without Kelly, returns the risk-profile suggested max", () => {
    // balanced profile + a high tradeQualityScore → baseMax = 5
    const sizing = computePositionSizing(makeInput(), 80);
    expect(sizing.suggestedMaxPositionPct).toBe(5);
  });

  it("with Kelly null, returns the risk-profile suggested max", () => {
    const sizing = computePositionSizing(makeInput(), 80, null);
    expect(sizing.suggestedMaxPositionPct).toBe(5);
  });

  it("with Kelly higher than risk-profile, returns risk-profile (Kelly never raises)", () => {
    // balanced profile baseline = 5%, Kelly suggests 8% → cap stays 5
    const sizing = computePositionSizing(makeInput(), 80, 8);
    expect(sizing.suggestedMaxPositionPct).toBe(5);
  });

  it("with Kelly lower than risk-profile, returns Kelly (Kelly tightens the cap)", () => {
    // balanced profile baseline = 5%, Kelly suggests 2% → 2 wins
    const sizing = computePositionSizing(makeInput(), 80, 2);
    expect(sizing.suggestedMaxPositionPct).toBe(2);
  });

  it("with Kelly = 0 (negative edge), returns risk-profile suggestion (treated as null)", () => {
    // Kelly returning 0 means the user has a temporarily-negative edge.
    // Treating it as null avoids zeroing out the suggested max.
    const sizing = computePositionSizing(makeInput(), 80, 0);
    expect(sizing.suggestedMaxPositionPct).toBe(5);
  });

  it("with Kelly negative, returns risk-profile suggestion (treated as null)", () => {
    const sizing = computePositionSizing(makeInput(), 80, -1);
    expect(sizing.suggestedMaxPositionPct).toBe(5);
  });

  it("respects the trade-quality-score floor when Kelly is undefined", () => {
    // Low trade quality → 1% cap, Kelly absent should not bump it back up.
    const sizing = computePositionSizing(makeInput(), 30);
    expect(sizing.suggestedMaxPositionPct).toBe(1);
  });

  it("Kelly cannot raise the trade-quality-score-imposed floor", () => {
    // Low trade quality → floor at 1%, Kelly suggests 4 → still 1.
    const sizing = computePositionSizing(makeInput(), 30, 4);
    expect(sizing.suggestedMaxPositionPct).toBe(1);
  });

  it("aggressive profile baseline stays capped at 8 when Kelly is higher", () => {
    const sizing = computePositionSizing(
      makeInput({ riskProfile: "aggressive" }),
      80,
      12,
    );
    expect(sizing.suggestedMaxPositionPct).toBe(8);
  });

  it("conservative profile cap of 3 is tightened by Kelly = 1.5", () => {
    const sizing = computePositionSizing(
      makeInput({ riskProfile: "conservative" }),
      80,
      1.5,
    );
    expect(sizing.suggestedMaxPositionPct).toBe(1.5);
  });
});
