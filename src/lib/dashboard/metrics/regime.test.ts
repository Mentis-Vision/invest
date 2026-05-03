// src/lib/dashboard/metrics/regime.test.ts
//
// TDD coverage for the regime classifier and the FOMC calendar
// helper. No I/O; every input is constructed inline so the tests
// describe the contract rather than the data wiring.

import { describe, it, expect } from "vitest";
import {
  classifyRegime,
  daysToNextFOMC,
  type RegimeSignals,
} from "./regime";

function signals(overrides: Partial<RegimeSignals> = {}): RegimeSignals {
  return {
    vixLevel: null,
    vixTermRatio: null,
    daysToFOMC: 999,
    putCallRatio: null,
    ...overrides,
  };
}

describe("classifyRegime", () => {
  it("returns NEUTRAL with no signals at all", () => {
    const result = classifyRegime(signals());
    expect(result.label).toBe("NEUTRAL");
    expect(result.reasons).toEqual([]);
  });

  it("returns STRESS when VIX is high AND term structure is in backwardation", () => {
    // backwardation +2, VIX > 30 +2 => stress = 4 → STRESS
    const result = classifyRegime(
      signals({ vixLevel: 35, vixTermRatio: 1.12, daysToFOMC: 30 }),
    );
    expect(result.label).toBe("STRESS");
    expect(result.reasons.some((r) => r.includes("backwardation"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("VIX 35"))).toBe(true);
  });

  it("returns RISK_ON when VIX is subdued AND term structure is steep contango", () => {
    // contango -1, VIX < 12 -1 => stress = -2 → RISK_ON
    const result = classifyRegime(
      signals({ vixLevel: 11, vixTermRatio: 0.88, daysToFOMC: 30 }),
    );
    expect(result.label).toBe("RISK_ON");
    expect(result.reasons.some((r) => r.includes("contango"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("subdued"))).toBe(true);
  });

  it("returns FRAGILE when VIX is elevated and FOMC is imminent", () => {
    // VIX 22 +1, FOMC in 2d +1 => stress = 2 → FRAGILE
    const result = classifyRegime(
      signals({ vixLevel: 22, daysToFOMC: 2 }),
    );
    expect(result.label).toBe("FRAGILE");
    expect(result.reasons.some((r) => r.includes("FOMC in 2d"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("elevated"))).toBe(true);
  });

  it("returns NEUTRAL with mid-range VIX and no other signals", () => {
    // VIX 16: between 12 and 20, contributes 0 → stress = 0 → NEUTRAL
    const result = classifyRegime(signals({ vixLevel: 16 }));
    expect(result.label).toBe("NEUTRAL");
  });

  it("incorporates put/call ratio when provided", () => {
    // P/C ratio 1.4 +1, VIX elevated 22 +1 => stress = 2 → FRAGILE
    const result = classifyRegime(
      signals({ vixLevel: 22, putCallRatio: 1.4 }),
    );
    expect(result.label).toBe("FRAGILE");
    expect(result.reasons.some((r) => r.includes("P/C ratio 1.40"))).toBe(true);
  });

  it("treats low put/call ratio as risk-on", () => {
    // P/C ratio 0.5 -1, VIX subdued 10 -1 => stress = -2 → RISK_ON
    const result = classifyRegime(
      signals({ vixLevel: 10, putCallRatio: 0.5 }),
    );
    expect(result.label).toBe("RISK_ON");
    expect(result.reasons.some((r) => r.includes("P/C ratio low"))).toBe(true);
  });

  it("FOMC outside 3-day window does not contribute to stress", () => {
    // FOMC in 4d => no contribution; VIX 15 mid → NEUTRAL
    const result = classifyRegime(
      signals({ vixLevel: 15, daysToFOMC: 4 }),
    );
    expect(result.label).toBe("NEUTRAL");
    expect(result.reasons.some((r) => r.includes("FOMC"))).toBe(false);
  });

  it("FOMC today (daysToFOMC=0) contributes to stress", () => {
    const result = classifyRegime(
      signals({ vixLevel: 22, daysToFOMC: 0 }),
    );
    // stress = +1 elevated +1 FOMC = 2 → FRAGILE
    expect(result.label).toBe("FRAGILE");
    expect(result.reasons.some((r) => r.includes("FOMC in 0d"))).toBe(true);
  });

  it("ignores non-finite signal values", () => {
    const result = classifyRegime({
      vixLevel: Number.NaN,
      vixTermRatio: Number.POSITIVE_INFINITY,
      daysToFOMC: 999,
      putCallRatio: Number.NaN,
    });
    expect(result.label).toBe("NEUTRAL");
    expect(result.reasons).toEqual([]);
  });

  it("backwardation alone is FRAGILE (single +2 signal)", () => {
    const result = classifyRegime(signals({ vixTermRatio: 1.10 }));
    expect(result.label).toBe("FRAGILE");
  });
});

describe("daysToNextFOMC", () => {
  it("returns 0 when today IS an FOMC date", () => {
    // 2026-01-28 is the first hardcoded date.
    const today = new Date("2026-01-28T10:00:00Z");
    expect(daysToNextFOMC(today)).toBe(0);
  });

  it("returns 1 the day before an FOMC date", () => {
    const today = new Date("2026-01-27T23:00:00Z");
    expect(daysToNextFOMC(today)).toBe(1);
  });

  it("returns the gap to the next future date when today is past the most recent one", () => {
    // 2026-01-28 is past; next is 2026-03-18 → 49 days
    const today = new Date("2026-01-29T00:00:00Z");
    const days = daysToNextFOMC(today);
    expect(days).toBe(48); // Jan has 31 days: 2 + 28 (Feb 2026) + 18 = 48
  });

  it("returns 999 sentinel when no future FOMC date exists in the calendar", () => {
    const today = new Date("2030-01-01T00:00:00Z");
    expect(daysToNextFOMC(today)).toBe(999);
  });
});
