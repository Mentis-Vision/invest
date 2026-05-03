// src/lib/dashboard/year-outlook.test.ts
import { describe, it, expect } from "vitest";
import {
  formatPacingNarrative,
  computeGlidepathDrift,
  buildProjectionSeries,
  hasPacingInputs,
} from "./year-outlook";
import { targetAllocation, pacingProjection } from "./goals";

describe("formatPacingNarrative", () => {
  it("returns empty-state when projection is null", () => {
    const n = formatPacingNarrative(null, null);
    expect(n.tone).toBe("muted");
    expect(n.headline).toMatch(/Set your goals/i);
  });

  it("renders an on-pace projection with green tone", () => {
    const target = new Date();
    target.setFullYear(target.getFullYear() + 10);
    const proj = pacingProjection(500_000, 1_000, 200_000, target, 0.07);
    const n = formatPacingNarrative(proj, target.toISOString().slice(0, 10));
    expect(n.tone).toBe("buy");
    expect(n.status).toMatch(/On pace/i);
    expect(n.headline).toMatch(/projected/);
  });

  it("renders a behind projection with rust tone + dollar gap", () => {
    const target = new Date();
    target.setFullYear(target.getFullYear() + 10);
    const proj = pacingProjection(50_000, 0, 1_000_000, target, 0.07);
    const n = formatPacingNarrative(proj, target.toISOString().slice(0, 10));
    expect(n.tone).toBe("sell");
    expect(n.status).toMatch(/Behind by \$/);
  });

  it("clamps absurd required-CAGR to em-dash", () => {
    const target = new Date();
    target.setFullYear(target.getFullYear() + 1);
    // Asking for 100x growth in 1 year — required CAGR pegs the
    // search bound, formatter should show "—" rather than "+100%".
    const proj = pacingProjection(1_000, 0, 1_000_000, target, 0.07);
    const n = formatPacingNarrative(proj, target.toISOString().slice(0, 10));
    expect(n.cagrLine).toMatch(/—/);
  });
});

describe("computeGlidepathDrift", () => {
  it("returns 'On target' when within 1pp of all buckets", () => {
    const target = targetAllocation(40, "moderate"); // 80/15/5
    const drift = computeGlidepathDrift(80, target);
    expect(drift.label).toBe("On target");
  });

  it("identifies stocks above target with a +pp label", () => {
    const target = targetAllocation(40, "moderate"); // 80/15/5
    const drift = computeGlidepathDrift(95, target);
    expect(drift.stocksDriftPp).toBe(15);
    expect(drift.label).toMatch(/\+15pp stocks above/);
  });

  it("identifies stocks below target with a -pp label", () => {
    const target = targetAllocation(40, "moderate"); // 80/15/5
    const drift = computeGlidepathDrift(60, target);
    expect(drift.stocksDriftPp).toBe(-20);
    expect(drift.label).toMatch(/-20pp stocks below/);
  });

  it("falls back to 'Allocation unknown' when actual is null", () => {
    const target = targetAllocation(40, "moderate");
    const drift = computeGlidepathDrift(null, target);
    expect(drift.label).toBe("Allocation unknown");
    expect(drift.worstBucket).toBeNull();
  });

  it("drift bucket totals sum to 0 (sanity)", () => {
    const target = targetAllocation(40, "moderate"); // 80/15/5
    const drift = computeGlidepathDrift(70, target);
    const sum =
      drift.stocksDriftPp + drift.bondsDriftPp + drift.cashDriftPp;
    expect(Math.abs(sum)).toBeLessThan(1e-9);
  });
});

describe("buildProjectionSeries", () => {
  it("returns a single point when yearsRemaining is 0 or negative", () => {
    const series = buildProjectionSeries(100_000, 500, 0, 0.07);
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(100_000);
  });

  it("samples year 0 = currentValue and year N > currentValue at +7%", () => {
    const series = buildProjectionSeries(100_000, 0, 10, 0.07);
    expect(series[0].value).toBeCloseTo(100_000, 0);
    // 100k * 1.07^10 ≈ 196,715
    expect(series[10].value).toBeGreaterThan(195_000);
    expect(series[10].value).toBeLessThan(200_000);
  });

  it("clamps to 50 sample points even with absurdly long horizons", () => {
    const series = buildProjectionSeries(1_000, 0, 200, 0.05);
    expect(series.length).toBeLessThanOrEqual(51);
  });

  it("monotonically increases with positive return + contribution", () => {
    const series = buildProjectionSeries(50_000, 1_000, 15, 0.07);
    for (let i = 1; i < series.length; i++) {
      expect(series[i].value).toBeGreaterThan(series[i - 1].value);
    }
  });
});

describe("hasPacingInputs", () => {
  it("false when goals is null", () => {
    expect(hasPacingInputs(null)).toBe(false);
  });

  it("false when targetWealth is missing", () => {
    expect(
      hasPacingInputs({
        targetWealth: null,
        targetDate: "2050-01-01",
        monthlyContribution: 500,
        currentAge: 40,
        riskTolerance: "moderate",
      }),
    ).toBe(false);
  });

  it("true when targetWealth + targetDate + currentAge are all set", () => {
    expect(
      hasPacingInputs({
        targetWealth: 1_000_000,
        targetDate: "2050-01-01",
        monthlyContribution: 500,
        currentAge: 40,
        riskTolerance: "moderate",
      }),
    ).toBe(true);
  });
});
