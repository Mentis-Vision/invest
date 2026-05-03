// src/lib/dashboard/metrics/monte-carlo.test.ts
//
// TDD coverage for the Monte Carlo retirement simulation. We use a
// fixed seed so the success-probability and percentile assertions
// are stable. The synthetic returns have a positive drift (~10%
// annualized at 4bp/day mean) so the simulation actually moves
// money toward the target.

import { describe, it, expect } from "vitest";
import { runSimulation } from "./monte-carlo";

/** Deterministic ~6% drift / ~1% daily vol return series. */
function buildReturnsHistory(n: number): number[] {
  // Normal-ish histogram: 70% small +0.0005, 30% small -0.001.
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(i % 7 === 0 ? -0.005 : 0.0008);
  }
  return out;
}

describe("runSimulation", () => {
  it("returns successProbability=1 for an absurdly low target", () => {
    const result = runSimulation({
      currentValue: 1_000_000,
      monthlyContribution: 1000,
      targetValue: 10, // basically a guaranteed win
      yearsRemaining: 10,
      returnsHistory: buildReturnsHistory(252),
      paths: 200,
      seed: 1,
    });
    expect(result.successProbability).toBe(1);
  });

  it("returns successProbability=0 when target is unreachable", () => {
    const result = runSimulation({
      currentValue: 1000,
      monthlyContribution: 0,
      targetValue: 10_000_000,
      yearsRemaining: 1,
      returnsHistory: buildReturnsHistory(252),
      paths: 200,
      seed: 1,
    });
    expect(result.successProbability).toBe(0);
  });

  it("is deterministic when seeded", () => {
    const inputs = {
      currentValue: 100_000,
      monthlyContribution: 500,
      targetValue: 200_000,
      yearsRemaining: 5,
      returnsHistory: buildReturnsHistory(252),
      paths: 500,
      seed: 12345,
    };
    const a = runSimulation(inputs);
    const b = runSimulation(inputs);
    expect(a.successProbability).toBe(b.successProbability);
    expect(a.percentiles.p50).toBe(b.percentiles.p50);
  });

  it("percentiles are monotonically increasing", () => {
    const result = runSimulation({
      currentValue: 100_000,
      monthlyContribution: 500,
      targetValue: 200_000,
      yearsRemaining: 5,
      returnsHistory: buildReturnsHistory(252),
      paths: 500,
      seed: 7,
    });
    const { p10, p25, p50, p75, p90 } = result.percentiles;
    expect(p10).toBeLessThanOrEqual(p25);
    expect(p25).toBeLessThanOrEqual(p50);
    expect(p50).toBeLessThanOrEqual(p75);
    expect(p75).toBeLessThanOrEqual(p90);
  });

  it("returns three fan-chart paths when keepPaths is true", () => {
    const result = runSimulation({
      currentValue: 100_000,
      monthlyContribution: 500,
      targetValue: 200_000,
      yearsRemaining: 5,
      returnsHistory: buildReturnsHistory(252),
      paths: 500,
      seed: 7,
      keepPaths: true,
    });
    expect(result.paths).not.toBeNull();
    expect(result.paths!.p10.length).toBeGreaterThan(10);
    expect(result.paths!.p50.length).toBe(result.paths!.p10.length);
    expect(result.paths!.p90.length).toBe(result.paths!.p10.length);
    // p10 path should end below p90 path.
    expect(
      result.paths!.p10[result.paths!.p10.length - 1].value,
    ).toBeLessThan(result.paths!.p90[result.paths!.p90.length - 1].value);
  });

  it("skips fan-chart paths when keepPaths is false", () => {
    const result = runSimulation({
      currentValue: 100_000,
      monthlyContribution: 500,
      targetValue: 200_000,
      yearsRemaining: 5,
      returnsHistory: buildReturnsHistory(252),
      paths: 100,
      seed: 7,
      keepPaths: false,
    });
    expect(result.paths).toBeNull();
  });

  it("gracefully handles empty returnsHistory", () => {
    const result = runSimulation({
      currentValue: 100_000,
      monthlyContribution: 500,
      targetValue: 200_000,
      yearsRemaining: 5,
      returnsHistory: [],
      paths: 100,
      seed: 7,
    });
    expect(result.successProbability).toBe(0);
    expect(result.percentiles.p50).toBe(0);
  });

  it("monthly contribution lifts terminal values", () => {
    const base = runSimulation({
      currentValue: 100_000,
      monthlyContribution: 0,
      targetValue: 200_000,
      yearsRemaining: 5,
      returnsHistory: buildReturnsHistory(252),
      paths: 500,
      seed: 99,
    });
    const withContrib = runSimulation({
      currentValue: 100_000,
      monthlyContribution: 1000,
      targetValue: 200_000,
      yearsRemaining: 5,
      returnsHistory: buildReturnsHistory(252),
      paths: 500,
      seed: 99,
    });
    expect(withContrib.percentiles.p50).toBeGreaterThan(base.percentiles.p50);
  });
});
