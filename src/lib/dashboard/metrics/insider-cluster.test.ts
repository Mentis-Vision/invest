// src/lib/dashboard/metrics/insider-cluster.test.ts
//
// Pure-math tests for the Form 4 insider-cluster detector.

import { describe, it, expect } from "vitest";
import {
  detectClusterBuying,
  formatClusterDollars,
  type Form4Transaction,
} from "./insider-cluster";

function tx(
  filerName: string,
  date: string,
  dollars: number,
  opts: Partial<Form4Transaction> = {},
): Form4Transaction {
  return {
    filerName,
    transactionDate: date,
    transactionCode: "P",
    is10b5_1: false,
    approxDollarValue: dollars,
    isOfficer: false,
    isDirector: false,
    ...opts,
  };
}

describe("detectClusterBuying", () => {
  it("returns empty on empty input", () => {
    expect(detectClusterBuying([])).toEqual([]);
  });

  it("returns empty when only one insider buys", () => {
    expect(
      detectClusterBuying([
        tx("Alice", "2026-04-01", 200_000),
        tx("Alice", "2026-04-05", 200_000),
        tx("Alice", "2026-04-10", 200_000),
      ]),
    ).toEqual([]);
  });

  it("emits a cluster when 3 distinct insiders buy 100k+ within 14 days", () => {
    const result = detectClusterBuying([
      tx("Alice", "2026-04-01", 150_000),
      tx("Bob", "2026-04-05", 200_000),
      tx("Carol", "2026-04-10", 110_000),
    ]);
    expect(result.length).toBe(1);
    expect(result[0].insiderCount).toBe(3);
    expect(result[0].totalDollars).toBe(460_000);
    expect(result[0].insiderNames).toEqual(["alice", "bob", "carol"]);
    expect(result[0].windowStart).toBe("2026-04-01");
    expect(result[0].windowEnd).toBe("2026-04-10");
  });

  it("does not emit when transactions span more than 14 days", () => {
    const result = detectClusterBuying([
      tx("Alice", "2026-04-01", 150_000),
      tx("Bob", "2026-04-05", 200_000),
      tx("Carol", "2026-04-20", 110_000),
    ]);
    expect(result).toEqual([]);
  });

  it("excludes 10b5-1 plan trades from the count", () => {
    const result = detectClusterBuying([
      tx("Alice", "2026-04-01", 150_000),
      tx("Bob", "2026-04-05", 200_000),
      tx("Carol", "2026-04-10", 110_000, { is10b5_1: true }),
    ]);
    expect(result).toEqual([]);
  });

  it("excludes insiders who don't aggregate to 100k", () => {
    const result = detectClusterBuying([
      tx("Alice", "2026-04-01", 150_000),
      tx("Bob", "2026-04-05", 200_000),
      tx("Carol", "2026-04-10", 50_000), // below threshold
    ]);
    expect(result).toEqual([]);
  });

  it("aggregates multiple transactions per insider in the window", () => {
    const result = detectClusterBuying([
      tx("Alice", "2026-04-01", 60_000),
      tx("Alice", "2026-04-03", 60_000), // sums to 120k
      tx("Bob", "2026-04-05", 200_000),
      tx("Carol", "2026-04-10", 110_000),
    ]);
    expect(result.length).toBe(1);
    expect(result[0].insiderCount).toBe(3);
  });

  it("ignores non-purchase codes (S, A, M)", () => {
    const result = detectClusterBuying([
      tx("Alice", "2026-04-01", 150_000),
      tx("Bob", "2026-04-05", 200_000),
      tx("Carol", "2026-04-10", 110_000, { transactionCode: "S" }),
    ]);
    expect(result).toEqual([]);
  });

  it("normalizes filer names to count distinct insiders", () => {
    // Same insider in two reporting formats should not count as 3.
    const result = detectClusterBuying([
      tx("Alice Smith", "2026-04-01", 150_000),
      tx("ALICE SMITH", "2026-04-03", 100_000),
      tx("Bob", "2026-04-05", 200_000),
    ]);
    expect(result).toEqual([]);
  });

  it("emits two non-overlapping clusters when separated by > 14 days", () => {
    const result = detectClusterBuying([
      // Cluster 1
      tx("Alice", "2026-01-01", 150_000),
      tx("Bob", "2026-01-05", 200_000),
      tx("Carol", "2026-01-10", 110_000),
      // Cluster 2
      tx("Dave", "2026-04-01", 150_000),
      tx("Eve", "2026-04-05", 200_000),
      tx("Frank", "2026-04-10", 110_000),
    ]);
    expect(result.length).toBe(2);
    expect(result[0].windowStart).toBe("2026-01-01");
    expect(result[1].windowStart).toBe("2026-04-01");
  });

  it("treats null transactionDate as ineligible", () => {
    const result = detectClusterBuying([
      tx("Alice", null as unknown as string, 150_000),
      tx("Bob", "2026-04-05", 200_000),
      tx("Carol", "2026-04-10", 110_000),
    ]);
    expect(result).toEqual([]);
  });
});

describe("formatClusterDollars", () => {
  it("formats millions with one decimal", () => {
    expect(formatClusterDollars(1_400_000)).toBe("$1.4M");
    expect(formatClusterDollars(2_000_000)).toBe("$2.0M");
  });

  it("formats thousands as round k", () => {
    expect(formatClusterDollars(420_000)).toBe("$420k");
    expect(formatClusterDollars(120_500)).toBe("$121k");
  });

  it("formats sub-1k as raw dollars", () => {
    expect(formatClusterDollars(800)).toBe("$800");
  });
});
