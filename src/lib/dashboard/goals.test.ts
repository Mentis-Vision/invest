// src/lib/dashboard/goals.test.ts
import { describe, it, expect } from "vitest";
import { targetAllocation, pacingProjection } from "./goals";

describe("targetAllocation — glidepath rule", () => {
  it("30yo moderate → stocks 90 / bonds 5 / cash 5", () => {
    const a = targetAllocation(30, "moderate");
    expect(a).toEqual({ stocksPct: 90, bondsPct: 5, cashPct: 5 });
  });

  it("70yo moderate → stocks 50 / bonds 45 / cash 5", () => {
    const a = targetAllocation(70, "moderate");
    expect(a).toEqual({ stocksPct: 50, bondsPct: 45, cashPct: 5 });
  });

  it("50yo conservative shifts -15pp stocks → 55 / 40 / 5", () => {
    const a = targetAllocation(50, "conservative");
    expect(a).toEqual({ stocksPct: 55, bondsPct: 40, cashPct: 5 });
  });

  it("50yo aggressive shifts +10pp stocks → 80 / 15 / 5", () => {
    const a = targetAllocation(50, "aggressive");
    expect(a).toEqual({ stocksPct: 80, bondsPct: 15, cashPct: 5 });
  });

  it("95yo moderate clamps stocks to 25 (120 - 95) — never below floor", () => {
    const a = targetAllocation(95, "moderate");
    expect(a.stocksPct).toBe(25);
    expect(a.stocksPct + a.bondsPct + a.cashPct).toBe(100);
  });

  it("very young aggressive caps stocks at 95", () => {
    const a = targetAllocation(20, "aggressive");
    expect(a.stocksPct).toBe(95);
    expect(a.stocksPct + a.bondsPct + a.cashPct).toBe(100);
  });

  it("buckets always sum to exactly 100", () => {
    const cases: Array<[number, "conservative" | "moderate" | "aggressive"]> = [
      [25, "conservative"],
      [40, "moderate"],
      [60, "aggressive"],
      [80, "conservative"],
      [99, "aggressive"],
    ];
    for (const [age, risk] of cases) {
      const a = targetAllocation(age, risk);
      expect(a.stocksPct + a.bondsPct + a.cashPct).toBe(100);
    }
  });
});

describe("pacingProjection — future-value math", () => {
  it("$100k + $0/mo + $200k target in 10y at 7% is NOT on track", () => {
    const target = new Date();
    target.setFullYear(target.getFullYear() + 10);
    const r = pacingProjection(100_000, 0, 200_000, target, 0.07);
    // 100k * 1.07^10 ≈ 196,715 → ~3.3k short of 200k
    expect(r.projectedValue).toBeGreaterThan(195_000);
    expect(r.projectedValue).toBeLessThan(200_000);
    expect(r.onTrack).toBe(false);
    expect(r.gapDollars).toBeGreaterThan(0);
    expect(r.gapDollars).toBeLessThan(5_000);
  });

  it("$100k + $1k/mo + $500k target in 20y at 7% IS on track", () => {
    const target = new Date();
    target.setFullYear(target.getFullYear() + 20);
    const r = pacingProjection(100_000, 1_000, 500_000, target, 0.07);
    expect(r.projectedValue).toBeGreaterThan(500_000);
    expect(r.onTrack).toBe(true);
    expect(r.gapDollars).toBeLessThan(0); // ahead of target
  });

  it("targetDate in the past → yearsRemaining=0; on-track iff current ≥ target", () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    const ahead = pacingProjection(150_000, 500, 100_000, past, 0.07);
    expect(ahead.yearsRemaining).toBe(0);
    expect(ahead.onTrack).toBe(true);
    expect(ahead.projectedValue).toBe(150_000);

    const behind = pacingProjection(50_000, 500, 100_000, past, 0.07);
    expect(behind.onTrack).toBe(false);
    expect(behind.gapDollars).toBe(50_000);
  });

  it("requiredAnnualReturn solves to within ~1% of the FV exactly hitting target", () => {
    const target = new Date();
    target.setFullYear(target.getFullYear() + 10);
    const r = pacingProjection(100_000, 0, 200_000, target, 0.07);
    // PV * (1+r)^10 = 200,000  →  r = (2)^(1/10) - 1 ≈ 0.07177
    expect(r.requiredAnnualReturn).toBeGreaterThan(0.071);
    expect(r.requiredAnnualReturn).toBeLessThan(0.073);
  });

  it("zero contribution + zero target → projection equals current value", () => {
    const target = new Date();
    target.setFullYear(target.getFullYear() + 5);
    const r = pacingProjection(50_000, 0, 0, target, 0);
    // r = 0 path uses 1e-9 floor; FV ≈ PV
    expect(r.projectedValue).toBeCloseTo(50_000, 0);
    expect(r.onTrack).toBe(true);
  });
});
