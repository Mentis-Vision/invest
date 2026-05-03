// src/lib/dashboard/metrics/kelly.test.ts
//
// Tests for the fractional Kelly position-sizer. The math is
// f* = (p*b - q) / b, then scaled by the user-chosen fraction
// (default ¼ Kelly). We assert known textbook cases plus the edge
// behavior at the win-rate boundaries.

import { describe, it, expect } from "vitest";
import { fractionalKelly } from "./kelly";

describe("fractionalKelly", () => {
  it("returns 0 for an even-money 50/50 bet (no edge)", () => {
    expect(fractionalKelly(0.5, 1, 1)).toBe(0);
  });

  it("returns ¼ Kelly for 60/40 even-money (full Kelly = 0.20)", () => {
    // f* = (0.6 * 1 - 0.4) / 1 = 0.20; quarter = 0.05
    expect(fractionalKelly(0.6, 1, 1)).toBeCloseTo(0.05, 10);
  });

  it("returns ¼ Kelly on 70% win-rate with 2:1 reward:risk", () => {
    // b = 2/1 = 2; f* = (0.7*2 - 0.3) / 2 = 1.1 / 2 = 0.55; quarter = 0.1375
    expect(fractionalKelly(0.7, 2, 1)).toBeCloseTo(0.1375, 10);
  });

  it("returns 0 on a negative-edge bet (40% win-rate, even money)", () => {
    expect(fractionalKelly(0.4, 1, 1)).toBe(0);
  });

  it("returns 0 at win-rate boundaries (0 and 1)", () => {
    expect(fractionalKelly(0, 1, 1)).toBe(0);
    expect(fractionalKelly(1, 1, 1)).toBe(0);
  });

  it("returns 0 when avgWin or avgLoss is non-positive", () => {
    expect(fractionalKelly(0.6, 0, 1)).toBe(0);
    expect(fractionalKelly(0.6, 1, 0)).toBe(0);
    expect(fractionalKelly(0.6, -1, 1)).toBe(0);
    expect(fractionalKelly(0.6, 1, -1)).toBe(0);
  });

  it("doubles the position when fraction = ½ relative to default ¼", () => {
    const quarter = fractionalKelly(0.6, 1, 1);
    const half = fractionalKelly(0.6, 1, 1, 0.5);
    expect(half).toBeCloseTo(quarter * 2, 10);
  });

  it("caps the result at 100% even at very high edges", () => {
    // 99% win, 100:1 odds, full Kelly. f* ≈ 0.99 - 0.01/100 = ~0.9899
    // Times 1.0 (full Kelly) is still under 1. Force a cap by using
    // fraction = 100 (pathological).
    const result = fractionalKelly(0.99, 100, 1, 100);
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeGreaterThan(0);
  });

  it("returns the full Kelly when fraction = 1.0", () => {
    // 60/40 even money: full Kelly = 0.20
    expect(fractionalKelly(0.6, 1, 1, 1.0)).toBeCloseTo(0.2, 10);
  });
});
