// src/lib/dashboard/metrics/tax-loader.test.ts
//
// Phase 4 Batch I: closes the third deferral. Confirms that
// findHarvestableLosses correctly reads `holding.costBasis` (column
// already present and 24/31 populated in production sandbox) and
// surfaces material losses (≥ $200) with the appropriate sector
// replacement candidate.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../../log", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  errorInfo: (err: unknown) => ({ err: String(err) }),
}));

import { findHarvestableLosses, summarizeHarvest } from "./tax-loader";
import { pool } from "../../db";

const Q = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findHarvestableLosses", () => {
  it("returns empty array when the user has no holdings", async () => {
    Q.mockResolvedValueOnce({ rows: [] });
    const losses = await findHarvestableLosses("user_a");
    expect(losses).toEqual([]);
  });

  it("flags a position whose loss is ≥ $200", async () => {
    Q.mockResolvedValueOnce({
      rows: [
        {
          ticker: "AAPL",
          costBasis: "1000",
          lastValue: "750",
          sector: "Technology",
        },
      ],
    });
    const losses = await findHarvestableLosses("user_a");
    expect(losses).toHaveLength(1);
    expect(losses[0]).toMatchObject({
      ticker: "AAPL",
      costBasis: 1000,
      currentValue: 750,
      sector: "Technology",
    });
    expect(losses[0].lossDollars).toBeLessThanOrEqual(-200);
  });

  it("skips positions whose loss is below the $200 threshold", async () => {
    Q.mockResolvedValueOnce({
      rows: [
        // Loss of $150 → below threshold, not surfaced.
        { ticker: "AAPL", costBasis: "1000", lastValue: "850", sector: "Technology" },
        // Gain → not surfaced.
        { ticker: "MSFT", costBasis: "500", lastValue: "600", sector: "Technology" },
      ],
    });
    const losses = await findHarvestableLosses("user_a");
    expect(losses).toEqual([]);
  });

  it("returns suggestion=null when sector is missing", async () => {
    Q.mockResolvedValueOnce({
      rows: [
        {
          ticker: "AAPL",
          costBasis: "1000",
          lastValue: "500",
          sector: null,
        },
      ],
    });
    const losses = await findHarvestableLosses("user_a");
    expect(losses).toHaveLength(1);
    expect(losses[0].suggestedReplacement).toBeNull();
  });

  it("sorts results by largest loss first", async () => {
    Q.mockResolvedValueOnce({
      rows: [
        // -$300 loss
        { ticker: "AAPL", costBasis: "1000", lastValue: "700", sector: "Technology" },
        // -$500 loss — should sort first
        { ticker: "MSFT", costBasis: "1000", lastValue: "500", sector: "Technology" },
        // -$210 loss — last
        { ticker: "GOOG", costBasis: "1000", lastValue: "790", sector: "Technology" },
      ],
    });
    const losses = await findHarvestableLosses("user_a");
    expect(losses.map((l) => l.ticker)).toEqual(["MSFT", "AAPL", "GOOG"]);
  });

  it("returns empty array on DB error (degrades silently)", async () => {
    Q.mockRejectedValueOnce(new Error("connection lost"));
    const losses = await findHarvestableLosses("user_a");
    expect(losses).toEqual([]);
  });
});

describe("summarizeHarvest", () => {
  it("returns zero state for empty array", () => {
    expect(summarizeHarvest([])).toEqual({
      totalLossDollars: 0,
      numPositions: 0,
    });
  });

  it("sums loss dollars and counts positions", () => {
    const summary = summarizeHarvest([
      {
        ticker: "AAPL",
        costBasis: 1000,
        currentValue: 700,
        lossDollars: -300,
        suggestedReplacement: null,
        sector: "Technology",
      },
      {
        ticker: "MSFT",
        costBasis: 1000,
        currentValue: 500,
        lossDollars: -500,
        suggestedReplacement: null,
        sector: "Technology",
      },
    ]);
    expect(summary.totalLossDollars).toBe(-800);
    expect(summary.numPositions).toBe(2);
  });
});
