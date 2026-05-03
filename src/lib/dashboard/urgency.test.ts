// src/lib/dashboard/urgency.test.ts
import { describe, it, expect } from "vitest";
import {
  computeTimeDecay,
  computeFreshnessDecay,
  computeUrgencyScore,
  resolveHorizonTag,
  STATIC_IMPACT,
} from "./urgency";

describe("computeTimeDecay", () => {
  it("returns 1.0 for events within 24h", () => {
    expect(computeTimeDecay(12)).toBe(1.0);
    expect(computeTimeDecay(24)).toBe(1.0);
  });
  it("returns 0.7 for events 1-7d out", () => {
    expect(computeTimeDecay(48)).toBe(0.7);
    expect(computeTimeDecay(24 * 7)).toBe(0.7);
  });
  it("returns 0.4 for events 7-30d out", () => {
    expect(computeTimeDecay(24 * 8)).toBe(0.4);
    expect(computeTimeDecay(24 * 30)).toBe(0.4);
  });
  it("returns 0.2 for events 30-365d out", () => {
    expect(computeTimeDecay(24 * 60)).toBe(0.2);
    expect(computeTimeDecay(24 * 365)).toBe(0.2);
  });
  it("returns 0.1 for items with no time component (null)", () => {
    expect(computeTimeDecay(null)).toBe(0.1);
  });
});

describe("computeFreshnessDecay", () => {
  it("returns 1.0 for items first surfaced today", () => {
    expect(computeFreshnessDecay(0)).toBe(1.0);
  });
  it("returns 0.85 for items 1-3 days old", () => {
    expect(computeFreshnessDecay(1)).toBe(0.85);
    expect(computeFreshnessDecay(3)).toBe(0.85);
  });
  it("returns 0.6 for items 4-7 days old", () => {
    expect(computeFreshnessDecay(4)).toBe(0.6);
    expect(computeFreshnessDecay(7)).toBe(0.6);
  });
  it("returns 0.3 for items older than 7 days", () => {
    expect(computeFreshnessDecay(8)).toBe(0.3);
    expect(computeFreshnessDecay(60)).toBe(0.3);
  });
});

describe("computeUrgencyScore", () => {
  it("multiplies impact * timeDecay * freshnessDecay", () => {
    expect(
      computeUrgencyScore({ impact: 90, hoursToEvent: 12, daysSinceSurfaced: 0 }),
    ).toBeCloseTo(90, 5);
  });
  it("decays correctly for stale week-old item", () => {
    expect(
      computeUrgencyScore({ impact: 60, hoursToEvent: null, daysSinceSurfaced: 5 }),
    ).toBeCloseTo(60 * 0.1 * 0.6, 5);
  });
});

describe("resolveHorizonTag", () => {
  it("returns TODAY when impact is 90+", () => {
    expect(resolveHorizonTag({ impact: 100, hoursToEvent: null })).toBe("TODAY");
    expect(resolveHorizonTag({ impact: 90, hoursToEvent: null })).toBe("TODAY");
  });
  it("returns TODAY when event is within 24h", () => {
    expect(resolveHorizonTag({ impact: 50, hoursToEvent: 12 })).toBe("TODAY");
  });
  it("returns THIS_WEEK for events 1-7d", () => {
    expect(resolveHorizonTag({ impact: 50, hoursToEvent: 48 })).toBe("THIS_WEEK");
    expect(resolveHorizonTag({ impact: 60, hoursToEvent: 24 * 7 })).toBe("THIS_WEEK");
  });
  it("returns THIS_MONTH for events 7-30d", () => {
    expect(resolveHorizonTag({ impact: 40, hoursToEvent: 24 * 14 })).toBe("THIS_MONTH");
  });
  it("returns THIS_YEAR for events > 30d", () => {
    expect(resolveHorizonTag({ impact: 30, hoursToEvent: 24 * 90 })).toBe("THIS_YEAR");
  });
  it("returns THIS_MONTH as default for items with no event when impact < 60", () => {
    expect(resolveHorizonTag({ impact: 50, hoursToEvent: null })).toBe("THIS_MONTH");
  });
  it("returns THIS_WEEK for items with no event when impact 60-89", () => {
    expect(resolveHorizonTag({ impact: 60, hoursToEvent: null })).toBe("THIS_WEEK");
  });
});

describe("STATIC_IMPACT table", () => {
  it("matches spec §6.1", () => {
    expect(STATIC_IMPACT.broker_reauth).toBe(100);
    expect(STATIC_IMPACT.concentration_breach_severe).toBe(90);
    expect(STATIC_IMPACT.concentration_breach_moderate).toBe(70);
    expect(STATIC_IMPACT.catalyst_prep_imminent).toBe(80);
    expect(STATIC_IMPACT.catalyst_prep_upcoming).toBe(50);
    expect(STATIC_IMPACT.stale_rec_held).toBe(60);
    expect(STATIC_IMPACT.stale_rec_watched).toBe(30);
    expect(STATIC_IMPACT.outcome_action_mark).toBe(40);
    expect(STATIC_IMPACT.cash_idle).toBe(50);
    expect(STATIC_IMPACT.year_pace_review).toBe(30);
  });
});
