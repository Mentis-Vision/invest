// src/lib/dashboard/metrics/audit-ai.test.ts
//
// TDD coverage for the public-facing track-record math. Synthetic
// outcome rows let us assert hit-rate, p-value direction, and
// per-model attribution against hand-computed values.

import { describe, it, expect } from "vitest";
import { computeTrackRecord, type OutcomeRecord } from "./audit-ai";

function buy(
  id: string,
  recReturn: number,
  benchReturn: number,
  perLens?: Record<string, string>,
): OutcomeRecord {
  return {
    recommendationId: id,
    recommendation: "BUY",
    priceAtRec: 100,
    priceAtCheck: 100 * (1 + recReturn),
    spyStart: 100,
    spyEnd: 100 * (1 + benchReturn),
    perLensRecs: perLens as OutcomeRecord["perLensRecs"],
  };
}

describe("computeTrackRecord", () => {
  it("returns empty result on empty input", () => {
    const r = computeTrackRecord({ outcomes: [] });
    expect(r.totalBuys).toBe(0);
    expect(r.beatBenchmarkPct).toBe(0);
    expect(r.pValue).toBe(1);
  });

  it("counts wins correctly when BUY beats SPY", () => {
    const outcomes = [
      buy("a", 0.05, 0.02), // win
      buy("b", 0.03, 0.04), // loss
      buy("c", 0.10, 0.05), // win
    ];
    const r = computeTrackRecord({ outcomes });
    expect(r.totalBuys).toBe(3);
    expect(r.beatBenchmarkPct).toBeCloseTo(2 / 3, 3);
  });

  it("p-value is small when many wins on a large sample", () => {
    // 70 wins / 100 BUYs at p=0.5 → very small p-value.
    const outcomes: OutcomeRecord[] = [];
    for (let i = 0; i < 70; i++) outcomes.push(buy(`w${i}`, 0.05, 0.02));
    for (let i = 0; i < 30; i++) outcomes.push(buy(`l${i}`, 0.01, 0.02));
    const r = computeTrackRecord({ outcomes });
    expect(r.totalBuys).toBe(100);
    expect(r.pValue).toBeLessThan(0.001);
  });

  it("p-value is large when wins are near 50%", () => {
    const outcomes: OutcomeRecord[] = [];
    for (let i = 0; i < 50; i++) outcomes.push(buy(`w${i}`, 0.05, 0.02));
    for (let i = 0; i < 50; i++) outcomes.push(buy(`l${i}`, 0.01, 0.02));
    const r = computeTrackRecord({ outcomes });
    expect(r.pValue).toBeGreaterThan(0.4);
  });

  it("attributes hits to lens when only that lens issued BUY", () => {
    const outcomes = [
      buy("a", 0.05, 0.02, { claude: "BUY", gpt: "HOLD", gemini: "HOLD" }),
      buy("b", 0.04, 0.02, { claude: "BUY", gpt: "HOLD", gemini: "HOLD" }),
      buy("c", 0.01, 0.02, { claude: "BUY", gpt: "HOLD", gemini: "HOLD" }), // loss for claude
      buy("d", 0.05, 0.02, { claude: "HOLD", gpt: "BUY", gemini: "HOLD" }),
    ];
    const r = computeTrackRecord({ outcomes });
    expect(r.perModelAttribution.claude.evaluated).toBe(3);
    expect(r.perModelAttribution.claude.hits).toBe(2);
    expect(r.perModelAttribution.claude.hitRate).toBeCloseTo(2 / 3, 3);
    expect(r.perModelAttribution.gpt.evaluated).toBe(1);
    expect(r.perModelAttribution.gpt.hits).toBe(1);
    expect(r.perModelAttribution.gpt.hitRate).toBe(1);
    expect(r.perModelAttribution.gemini.evaluated).toBe(0);
    expect(r.perModelAttribution.gemini.hitRate).toBeNull();
  });

  it("excludes BUYs with missing benchmark prices", () => {
    const outcomes: OutcomeRecord[] = [
      buy("ok", 0.05, 0.02),
      {
        recommendationId: "noBench",
        recommendation: "BUY",
        priceAtRec: 100,
        priceAtCheck: 105,
        spyStart: null,
        spyEnd: null,
      },
    ];
    const r = computeTrackRecord({ outcomes });
    expect(r.totalBuys).toBe(1);
  });

  it("excludes non-BUY recommendations entirely", () => {
    const outcomes: OutcomeRecord[] = [
      buy("a", 0.05, 0.02),
      {
        recommendationId: "hold",
        recommendation: "HOLD",
        priceAtRec: 100,
        priceAtCheck: 110,
        spyStart: 100,
        spyEnd: 102,
      },
    ];
    const r = computeTrackRecord({ outcomes });
    expect(r.totalBuys).toBe(1);
  });

  it("respects the limit parameter to take only the most recent N", () => {
    const outcomes: OutcomeRecord[] = [];
    // 150 BUYs, all wins.
    for (let i = 0; i < 150; i++) outcomes.push(buy(`w${i}`, 0.05, 0.02));
    const r = computeTrackRecord({ outcomes, limit: 100 });
    expect(r.totalBuys).toBe(100);
  });
});
