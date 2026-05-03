// src/lib/dashboard/metrics/revision-breadth.test.ts
//
// Synthetic-history tests for REV6. Each row collapses into a
// "bullishness" integer; month-over-month deltas count as
// up/downgrades.

import { describe, it, expect } from "vitest";
import {
  computeRev6,
  formatRev6Chip,
  type AnalystRecommendation,
} from "./revision-breadth";

function row(
  period: string,
  strongBuy: number,
  buy: number,
  hold: number,
  sell: number,
  strongSell: number,
): AnalystRecommendation {
  return { period, strongBuy, buy, hold, sell, strongSell };
}

describe("computeRev6", () => {
  it("counts upgrades when bullishness rises month over month", () => {
    const history: AnalystRecommendation[] = [
      row("2026-01-01", 1, 5, 4, 1, 0),  // bullishness = 2 + 5 - 1 = 6
      row("2026-02-01", 2, 5, 4, 1, 0),  // bullishness = 4 + 5 - 1 = 8 → up
      row("2026-03-01", 3, 5, 4, 1, 0),  // 6 + 5 - 1 = 10 → up
      row("2026-04-01", 3, 4, 5, 1, 0),  // 6 + 4 - 1 = 9 → down
    ];
    const r = computeRev6(history);
    expect(r.upgrades).toBe(2);
    expect(r.downgrades).toBe(1);
    expect(r.netRevisions).toBe(1);
    expect(r.ratio).toBeCloseTo(2 / 3, 3);
    expect(r.observations).toBe(3);
  });

  it("returns zeroed result when only one observation", () => {
    const r = computeRev6([row("2026-01-01", 5, 5, 5, 0, 0)]);
    expect(r.upgrades).toBe(0);
    expect(r.downgrades).toBe(0);
    expect(r.ratio).toBeNull();
    expect(r.observations).toBe(0);
  });

  it("ratio is null when no movement occurs (all flat)", () => {
    const history = [
      row("2026-01-01", 2, 5, 5, 0, 0),
      row("2026-02-01", 2, 5, 5, 0, 0),
      row("2026-03-01", 2, 5, 5, 0, 0),
    ];
    const r = computeRev6(history);
    expect(r.upgrades).toBe(0);
    expect(r.downgrades).toBe(0);
    expect(r.ratio).toBeNull();
  });

  it("clips to the trailing N months", () => {
    // 8 months of data, ask for trailing 3. Should consume 4 rows
    // (last 3 deltas = last 4 observations).
    const history: AnalystRecommendation[] = [];
    for (let m = 1; m <= 8; m++) {
      const period = `2025-${String(m).padStart(2, "0")}-01`;
      // Alternate up/down
      history.push(row(period, m % 2 === 0 ? 3 : 1, 5, 4, 1, 0));
    }
    const r = computeRev6(history, 3);
    expect(r.observations).toBe(3);
  });

  it("handles unsorted input (sorts internally)", () => {
    const history: AnalystRecommendation[] = [
      row("2026-03-01", 3, 5, 4, 1, 0),
      row("2026-01-01", 1, 5, 4, 1, 0),
      row("2026-02-01", 2, 5, 4, 1, 0),
    ];
    const r = computeRev6(history);
    expect(r.upgrades).toBe(2);
    expect(r.downgrades).toBe(0);
  });

  it("formatRev6Chip produces the canonical chip value", () => {
    expect(
      formatRev6Chip({
        upgrades: 5,
        downgrades: 2,
        netRevisions: 3,
        ratio: 5 / 7,
        observations: 6,
      }),
    ).toBe("+5/-2");
  });

  it("counts a downgrade when bullishness falls", () => {
    const history = [
      row("2026-01-01", 5, 5, 0, 0, 0),  // 10+5 = 15
      row("2026-02-01", 0, 5, 5, 0, 0),  // 0+5 = 5 → down
    ];
    const r = computeRev6(history);
    expect(r.upgrades).toBe(0);
    expect(r.downgrades).toBe(1);
    expect(r.netRevisions).toBe(-1);
    expect(r.ratio).toBe(0);
  });
});
