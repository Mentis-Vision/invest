// src/lib/dashboard/metrics/skew.test.ts
//
// Pure-math tests for the CBOE SKEW classifier and percentile rank.

import { describe, it, expect } from "vitest";
import { classifySkew, getSkewReading } from "./skew";

describe("classifySkew", () => {
  it("returns null for non-finite latest", () => {
    expect(classifySkew(NaN, [120, 130], "2026-05-01")).toBeNull();
    expect(classifySkew(Infinity, [120, 130], "2026-05-01")).toBeNull();
  });

  it("returns null for empty history", () => {
    expect(classifySkew(125, [], "2026-05-01")).toBeNull();
  });

  it("classifies < 110 as complacent", () => {
    const r = classifySkew(105, [100, 110, 120, 130, 140], "2026-05-01");
    expect(r?.band).toBe("complacent");
  });

  it("classifies 110–130 as neutral", () => {
    const r = classifySkew(125, [100, 110, 120, 130, 140], "2026-05-01");
    expect(r?.band).toBe("neutral");
  });

  it("classifies 130–145 as elevated", () => {
    const r = classifySkew(140, [100, 110, 120, 130, 140], "2026-05-01");
    expect(r?.band).toBe("elevated");
  });

  it("classifies > 145 as extreme", () => {
    const r = classifySkew(150, [100, 110, 120, 130, 140], "2026-05-01");
    expect(r?.band).toBe("extreme");
  });

  it("computes 2y percentile rank correctly", () => {
    // Latest = 130, history of [100, 110, 120, 130, 140]
    // Values <= 130: 100, 110, 120, 130 = 4 of 5 = 0.8
    const r = classifySkew(130, [100, 110, 120, 130, 140], "2026-05-01");
    expect(r?.percentile2y).toBe(0.8);
  });

  it("rounds value to one decimal", () => {
    const r = classifySkew(125.678, [100, 130], "2026-05-01");
    expect(r?.value).toBe(125.7);
  });

  it("preserves asOf date", () => {
    const r = classifySkew(125, [100, 130], "2026-05-01");
    expect(r?.asOf).toBe("2026-05-01");
  });
});

describe("getSkewReading", () => {
  it("returns null when fetcher returns null", async () => {
    const result = await getSkewReading(async () => null);
    expect(result).toBeNull();
  });

  it("classifies the last close from the fetcher result", async () => {
    const result = await getSkewReading(async () => ({
      closes: [110, 120, 125, 132],
      lastDate: "2026-05-01",
    }));
    expect(result?.value).toBe(132);
    expect(result?.band).toBe("elevated");
    expect(result?.asOf).toBe("2026-05-01");
  });
});
