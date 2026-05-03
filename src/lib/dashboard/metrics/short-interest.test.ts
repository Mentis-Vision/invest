// src/lib/dashboard/metrics/short-interest.test.ts
//
// Pure-math tests for FINRA short-interest velocity.

import { describe, it, expect } from "vitest";
import {
  computeShortVelocity,
  formatVelocityChip,
  type ShortInterestPeriod,
} from "./short-interest";

function p(
  settlementDate: string,
  sharesShort: number,
  avgDailyVolume: number,
  shortPctFloat?: number,
): ShortInterestPeriod {
  return { settlementDate, sharesShort, avgDailyVolume, shortPctFloat };
}

describe("computeShortVelocity", () => {
  it("returns null with fewer than 2 periods", () => {
    expect(computeShortVelocity([])).toBeNull();
    expect(
      computeShortVelocity([p("2026-01-15", 1_000_000, 100_000)]),
    ).toBeNull();
  });

  it("computes positive velocity when shares-short rose", () => {
    const result = computeShortVelocity([
      p("2026-01-15", 1_000_000, 100_000),
      p("2026-01-30", 1_300_000, 100_000),
    ]);
    expect(result?.velocityPct).toBe(30);
    expect(result?.daysToCover).toBe(13);
    expect(result?.isMaterial).toBe(true);
  });

  it("computes negative velocity when shares-short fell", () => {
    const result = computeShortVelocity([
      p("2026-01-15", 1_000_000, 100_000),
      p("2026-01-30", 700_000, 100_000),
    ]);
    expect(result?.velocityPct).toBe(-30);
    expect(result?.isMaterial).toBe(true); // 7 dtc and -30% velocity both material
  });

  it("flags material on high days-to-cover even when velocity is small", () => {
    const result = computeShortVelocity([
      p("2026-01-15", 595_000, 100_000),
      p("2026-01-30", 600_000, 100_000), // 0.84% velocity, but 6 dtc
    ]);
    expect(Math.abs(result?.velocityPct ?? 0)).toBeLessThan(2);
    expect(result?.daysToCover).toBe(6);
    expect(result?.isMaterial).toBe(true);
  });

  it("does not flag material on small changes within thresholds", () => {
    const result = computeShortVelocity([
      p("2026-01-15", 200_000, 100_000),
      p("2026-01-30", 220_000, 100_000), // 10% velocity, 2.2 dtc
    ]);
    expect(result?.velocityPct).toBe(10);
    expect(result?.daysToCover).toBe(2.2);
    expect(result?.isMaterial).toBe(false);
  });

  it("returns null when prior shares-short is zero", () => {
    const result = computeShortVelocity([
      p("2026-01-15", 0, 100_000),
      p("2026-01-30", 1_000_000, 100_000),
    ]);
    expect(result).toBeNull();
  });

  it("returns null when latest avg volume is zero", () => {
    const result = computeShortVelocity([
      p("2026-01-15", 1_000_000, 100_000),
      p("2026-01-30", 1_300_000, 0),
    ]);
    expect(result).toBeNull();
  });

  it("preserves shortPctFloat when supplied", () => {
    const result = computeShortVelocity([
      p("2026-01-15", 1_000_000, 100_000, 4.5),
      p("2026-01-30", 1_300_000, 100_000, 5.8),
    ]);
    expect(result?.currentShortPctFloat).toBe(5.8);
  });

  it("sorts unsorted input correctly", () => {
    const result = computeShortVelocity([
      p("2026-01-30", 1_300_000, 100_000),
      p("2026-01-15", 1_000_000, 100_000),
    ]);
    expect(result?.velocityPct).toBe(30);
    expect(result?.asOf).toBe("2026-01-30");
  });
});

describe("formatVelocityChip", () => {
  it("formats positive velocity with +", () => {
    expect(formatVelocityChip(24.3)).toBe("+24.3%");
  });

  it("formats negative velocity without +", () => {
    expect(formatVelocityChip(-15.2)).toBe("-15.2%");
  });

  it("formats zero without sign", () => {
    expect(formatVelocityChip(0)).toBe("0.0%");
  });
});
