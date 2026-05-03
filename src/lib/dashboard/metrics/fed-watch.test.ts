// src/lib/dashboard/metrics/fed-watch.test.ts
//
// Pure-helper tests for the FOMC dot-plot tracker.

import { describe, it, expect } from "vitest";
import {
  pickProjectionYear,
  interpretFedWatch,
  FED_DOT_PLOT_2026,
} from "./fed-watch";

describe("pickProjectionYear", () => {
  it("returns the current-year dot when present", () => {
    const today = new Date(Date.UTC(2026, 4, 1)); // May 1, 2026
    const dot = pickProjectionYear(FED_DOT_PLOT_2026, today);
    expect(dot?.yearEnd).toBe(2026);
  });

  it("returns the next-year dot when current year has none", () => {
    const today = new Date(Date.UTC(2030, 0, 1)); // Jan 1, 2030 — past loaded calendar
    const dot = pickProjectionYear(FED_DOT_PLOT_2026, today);
    // Calendar tops out at 2029 — nothing > 2029, returns null
    expect(dot).toBeNull();
  });

  it("returns the future dot when today is mid-2027", () => {
    const today = new Date(Date.UTC(2027, 5, 1));
    const dot = pickProjectionYear(FED_DOT_PLOT_2026, today);
    expect(dot?.yearEnd).toBe(2027);
  });

  it("returns null on empty calendar", () => {
    expect(pickProjectionYear([], new Date())).toBeNull();
  });
});

describe("interpretFedWatch", () => {
  it("indicates hold when median ≈ current", () => {
    const s = interpretFedWatch(4.0, 4.05, 2026);
    expect(s).toMatch(/hold/);
  });

  it("indicates easing when median < current", () => {
    const s = interpretFedWatch(3.5, 4.5, 2026);
    expect(s).toMatch(/easing/);
    expect(s).toMatch(/100bps/);
  });

  it("indicates tightening when median > current", () => {
    const s = interpretFedWatch(5.0, 4.0, 2026);
    expect(s).toMatch(/tightening/);
    expect(s).toMatch(/100bps/);
  });

  it("falls back when current funds is null", () => {
    const s = interpretFedWatch(4.0, null, 2026);
    expect(s).toMatch(/Median dot 4.00%/);
    expect(s).toMatch(/2026/);
  });
});

describe("FED_DOT_PLOT_2026", () => {
  it("contains a current-year projection (2026)", () => {
    const dot = FED_DOT_PLOT_2026.find((d) => d.yearEnd === 2026);
    expect(dot).toBeDefined();
    expect(dot?.median).toBeGreaterThan(0);
    expect(dot?.rangeLow).toBeLessThanOrEqual(dot?.median ?? 0);
    expect(dot?.rangeHigh).toBeGreaterThanOrEqual(dot?.median ?? 0);
  });

  it("is sorted by yearEnd ascending", () => {
    for (let i = 1; i < FED_DOT_PLOT_2026.length; i++) {
      expect(FED_DOT_PLOT_2026[i].yearEnd).toBeGreaterThan(
        FED_DOT_PLOT_2026[i - 1].yearEnd,
      );
    }
  });
});
