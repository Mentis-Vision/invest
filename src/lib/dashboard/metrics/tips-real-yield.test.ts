// src/lib/dashboard/metrics/tips-real-yield.test.ts
//
// Pure-helper tests for the TIPS real-yield classifier and interpretation
// string. The loader piece is tested implicitly via the integration tier;
// this file covers the math.

import { describe, it, expect } from "vitest";
import {
  classifyRealYieldStance,
  interpretTipsTriad,
} from "./tips-real-yield";

describe("classifyRealYieldStance", () => {
  it("returns null on null/non-finite input", () => {
    expect(classifyRealYieldStance(null)).toBeNull();
    expect(classifyRealYieldStance(NaN)).toBeNull();
  });

  it("classifies > 1.0 as restrictive", () => {
    expect(classifyRealYieldStance(1.5)).toBe("restrictive");
    expect(classifyRealYieldStance(2.3)).toBe("restrictive");
  });

  it("classifies < 0.0 as accommodative", () => {
    expect(classifyRealYieldStance(-0.5)).toBe("accommodative");
    expect(classifyRealYieldStance(-1.2)).toBe("accommodative");
  });

  it("classifies 0–1 as neutral", () => {
    expect(classifyRealYieldStance(0.5)).toBe("neutral");
    expect(classifyRealYieldStance(0.0)).toBe("neutral");
    expect(classifyRealYieldStance(1.0)).toBe("neutral");
  });
});

describe("interpretTipsTriad", () => {
  it("indicates unavailable when all legs are null", () => {
    expect(interpretTipsTriad(null, null, null)).toMatch(/unavailable/i);
  });

  it("falls back when nominal+breakeven present but real is missing", () => {
    const s = interpretTipsTriad(4.5, null, 2.5);
    expect(s).toMatch(/Nominal 10y 4.50%/);
    expect(s).toMatch(/breakeven 2.50%/);
  });

  it("renders restrictive interpretation", () => {
    const s = interpretTipsTriad(4.5, 2.0, 2.5);
    expect(s).toMatch(/restrictive/);
    expect(s).toMatch(/2.00%/);
  });

  it("renders accommodative interpretation", () => {
    const s = interpretTipsTriad(2.0, -0.3, 2.3);
    expect(s).toMatch(/accommodative/);
    expect(s).toMatch(/-0.30%/);
  });

  it("renders neutral interpretation", () => {
    const s = interpretTipsTriad(3.0, 0.5, 2.5);
    expect(s).toMatch(/neutral real-yield/);
  });

  it("includes breakeven in restrictive case when present", () => {
    const s = interpretTipsTriad(4.5, 2.0, 2.5);
    expect(s).toMatch(/breakeven 2.50%/);
  });
});
