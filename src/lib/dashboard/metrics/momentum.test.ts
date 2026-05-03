// src/lib/dashboard/metrics/momentum.test.ts
//
// Pure-math tests for the Jegadeesh-Titman 12-1 momentum factor.
// Asserts the math layer returns null on insufficient data and
// degenerate prices, and computes the expected return spread on
// well-formed input.

import { describe, it, expect } from "vitest";
import { compute12_1Momentum } from "./momentum";

function flat(value: number, length: number): number[] {
  return Array.from({ length }, () => value);
}

function linearUp(start: number, end: number, length: number): number[] {
  if (length < 2) return [start];
  const step = (end - start) / (length - 1);
  return Array.from({ length }, (_, i) => start + step * i);
}

describe("compute12_1Momentum", () => {
  it("returns null on empty input", () => {
    expect(compute12_1Momentum([])).toBeNull();
  });

  it("returns null when fewer than 252 prices supplied", () => {
    expect(compute12_1Momentum(flat(100, 251))).toBeNull();
    expect(compute12_1Momentum(linearUp(100, 200, 100))).toBeNull();
  });

  it("returns 0 for a perfectly flat 252-day series", () => {
    expect(compute12_1Momentum(flat(100, 252))).toBe(0);
  });

  it("returns 0 for a flat series longer than 252 days", () => {
    expect(compute12_1Momentum(flat(100, 260))).toBe(0);
  });

  it("returns the 12m minus 1m return on a linear-up 252-day series", () => {
    // 252 prices linearly rising 100 → 200, sampled at integer indices.
    const prices = linearUp(100, 200, 252);
    const today = prices[prices.length - 1];
    const oneMonthAgo = prices[prices.length - 21];
    const twelveMonthsAgo = prices[prices.length - 252];
    const expected =
      (today - twelveMonthsAgo) / twelveMonthsAgo -
      (today - oneMonthAgo) / oneMonthAgo;
    expect(compute12_1Momentum(prices)).toBeCloseTo(expected, 10);
  });

  it("returns null when the 1-month-ago price is non-positive", () => {
    const prices = flat(100, 252);
    prices[prices.length - 21] = 0;
    expect(compute12_1Momentum(prices)).toBeNull();

    const prices2 = flat(100, 252);
    prices2[prices2.length - 21] = -5;
    expect(compute12_1Momentum(prices2)).toBeNull();
  });

  it("returns null when the 12-months-ago price is non-positive", () => {
    const prices = flat(100, 252);
    prices[prices.length - 252] = 0;
    expect(compute12_1Momentum(prices)).toBeNull();
  });

  it("ignores extra leading prices beyond the 252-day window", () => {
    // 260 prices, last 252 are flat at 100, first 8 are noise. Should
    // still return 0 because the function references back from the end.
    const prices = [...linearUp(50, 90, 8), ...flat(100, 252)];
    expect(compute12_1Momentum(prices)).toBe(0);
  });

  it("returns the formula spread on a sharp last-month rally", () => {
    // Flat 100 for the first 231 days, then jump to 130 over the last 21.
    const prices = [...flat(100, 231), ...linearUp(100, 130, 21)];
    const today = prices[prices.length - 1];
    const oneMonthAgo = prices[prices.length - 21];
    const twelveMonthsAgo = prices[prices.length - 252];
    const expected =
      (today - twelveMonthsAgo) / twelveMonthsAgo -
      (today - oneMonthAgo) / oneMonthAgo;
    expect(compute12_1Momentum(prices)).toBeCloseTo(expected, 10);
  });
});
