// src/lib/dashboard/metrics/var.test.ts
//
// TDD coverage for the Value-at-Risk / Conditional VaR primitives.
// All tests run on synthetic series — no DB, no I/O. The "normally
// distributed" cases use a fixed-seed Box-Muller to keep them
// deterministic across machines.

import { describe, it, expect } from "vitest";
import {
  historicalVaR,
  expectedShortfall,
  scaleToMonthly,
  computeVaR,
} from "./var";

// Deterministic pseudo-random generator (mulberry32) so the
// "normally distributed" tests don't flake.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianSeries(n: number, mean: number, sigma: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  while (out.length < n) {
    // Box-Muller transform — consumes two uniforms per pair.
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const mag = Math.sqrt(-2 * Math.log(u1));
    const z0 = mag * Math.cos(2 * Math.PI * u2);
    const z1 = mag * Math.sin(2 * Math.PI * u2);
    out.push(mean + sigma * z0);
    if (out.length < n) out.push(mean + sigma * z1);
  }
  return out;
}

describe("historicalVaR", () => {
  it("returns 0 on empty input", () => {
    expect(historicalVaR([], 0.95)).toBe(0);
  });
  it("returns 0 on too-small input (< 20 samples)", () => {
    expect(historicalVaR([0.01, -0.01, 0.005], 0.95)).toBe(0);
  });
  it("returns 0 for invalid confidence levels", () => {
    const series = gaussianSeries(100, 0, 0.01, 42);
    expect(historicalVaR(series, 0)).toBe(0);
    expect(historicalVaR(series, 1)).toBe(0);
    expect(historicalVaR(series, -0.5)).toBe(0);
    expect(historicalVaR(series, 1.5)).toBe(0);
  });
  it("VaR95 for ~N(0, 0.01) lands roughly near -1.65σ", () => {
    const series = gaussianSeries(2000, 0, 0.01, 7);
    const v95 = historicalVaR(series, 0.95);
    // 95% normal quantile ≈ -1.6449 * sigma. Allow a generous
    // band — 2000 samples gets us to within ~10% of theory.
    expect(v95).toBeGreaterThan(-0.02);
    expect(v95).toBeLessThan(-0.012);
  });
  it("VaR99 is at least as extreme as VaR95 (more negative)", () => {
    const series = gaussianSeries(2000, 0, 0.01, 7);
    const v95 = historicalVaR(series, 0.95);
    const v99 = historicalVaR(series, 0.99);
    expect(v99).toBeLessThanOrEqual(v95);
  });
});

describe("expectedShortfall", () => {
  it("returns 0 on empty input", () => {
    expect(expectedShortfall([], 0.95)).toBe(0);
  });
  it("returns 0 on too-small input", () => {
    expect(expectedShortfall([0.01, -0.01, 0.005], 0.95)).toBe(0);
  });
  it("returns 0 for invalid confidence levels", () => {
    const series = gaussianSeries(100, 0, 0.01, 99);
    expect(expectedShortfall(series, 0)).toBe(0);
    expect(expectedShortfall(series, 1)).toBe(0);
  });
  it("CVaR95 is at least as extreme as VaR95 (mean of the tail beyond)", () => {
    const series = gaussianSeries(2000, 0, 0.01, 11);
    const v95 = historicalVaR(series, 0.95);
    const cv95 = expectedShortfall(series, 0.95);
    expect(cv95).toBeLessThanOrEqual(v95);
  });
  it("CVaR is the arithmetic mean of the worst-tail returns", () => {
    // Hand-verifiable: 100 returns, sorted, the bottom 5 should
    // average to CVaR95.
    const series = Array.from({ length: 100 }, (_, i) => (i - 50) * 0.001);
    const cv95 = expectedShortfall(series, 0.95);
    const sorted = [...series].sort((a, b) => a - b);
    const cutoff = Math.floor(0.05 * 100);
    const tail = sorted.slice(0, cutoff);
    const expected = tail.reduce((s, r) => s + r, 0) / tail.length;
    expect(cv95).toBeCloseTo(expected, 10);
  });
});

describe("scaleToMonthly", () => {
  it("scales by sqrt(21) by default", () => {
    expect(scaleToMonthly(-0.01)).toBeCloseTo(-0.01 * Math.sqrt(21), 10);
  });
  it("dailyVar -0.01 → monthly ≈ -0.0458", () => {
    // sqrt(21) ≈ 4.5826 → -0.01 * 4.5826 ≈ -0.04583
    expect(scaleToMonthly(-0.01)).toBeCloseTo(-0.04583, 4);
  });
  it("custom days argument", () => {
    expect(scaleToMonthly(-0.01, 252)).toBeCloseTo(-0.01 * Math.sqrt(252), 10);
  });
});

describe("computeVaR", () => {
  it("returns null for fewer than 20 samples", () => {
    expect(computeVaR([])).toBeNull();
    expect(computeVaR([0.001, -0.001])).toBeNull();
    expect(computeVaR(Array.from({ length: 19 }, (_, i) => i * 0.0001))).toBeNull();
  });
  it("returns an object with all 7 fields populated", () => {
    const series = gaussianSeries(100, 0, 0.01, 1);
    const out = computeVaR(series);
    expect(out).not.toBeNull();
    expect(out).toHaveProperty("var95Daily");
    expect(out).toHaveProperty("var99Daily");
    expect(out).toHaveProperty("cvar95Daily");
    expect(out).toHaveProperty("cvar99Daily");
    expect(out).toHaveProperty("var95Monthly");
    expect(out).toHaveProperty("var99Monthly");
    expect(out).toHaveProperty("sampleSize");
    expect(out!.sampleSize).toBe(series.length);
  });
  it("var95Monthly equals var95Daily * sqrt(21)", () => {
    const series = gaussianSeries(100, 0, 0.01, 2);
    const out = computeVaR(series)!;
    expect(out.var95Monthly).toBeCloseTo(out.var95Daily * Math.sqrt(21), 10);
    expect(out.var99Monthly).toBeCloseTo(out.var99Daily * Math.sqrt(21), 10);
  });
  it("VaR99 ≤ VaR95 and CVaR ≤ VaR (tail-loss ordering)", () => {
    const series = gaussianSeries(500, 0, 0.012, 3);
    const out = computeVaR(series)!;
    expect(out.var99Daily).toBeLessThanOrEqual(out.var95Daily);
    expect(out.cvar95Daily).toBeLessThanOrEqual(out.var95Daily);
    expect(out.cvar99Daily).toBeLessThanOrEqual(out.var99Daily);
  });
});
