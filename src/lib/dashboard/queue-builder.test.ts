// src/lib/dashboard/queue-builder.test.ts
// Tests the Decision Queue composer. Mocks the queue-sources adapter
// (which wraps the real portfolio-review + outcomes modules) and the
// shared DB pool so we exercise composition logic without touching Neon.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./queue-sources", () => ({
  getReviewSummary: vi.fn(),
  listUnactionedOutcomes: vi.fn(),
}));

vi.mock("../db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../log", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  errorInfo: (err: unknown) => ({ err: String(err) }),
}));

import { buildQueueForUser } from "./queue-builder";
import { getReviewSummary, listUnactionedOutcomes } from "./queue-sources";
import { pool } from "../db";

const PR = getReviewSummary as unknown as ReturnType<typeof vi.fn>;
const OUT = listUnactionedOutcomes as unknown as ReturnType<typeof vi.fn>;
const Q = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  PR.mockResolvedValue({
    holdings: [],
    concentrationBreaches: [],
    upcomingCatalysts: [],
    staleRecs: [],
    cashIdle: null,
    brokerStatus: "active",
    brokerName: null,
    portfolioYtdPct: 0,
    spyYtdPct: 0,
  });
  OUT.mockResolvedValue([]);
  Q.mockResolvedValue({ rows: [] });
});

describe("buildQueueForUser", () => {
  it("returns positive empty-state item when user has no data", async () => {
    const items = await buildQueueForUser("user_new");
    expect(items).toHaveLength(1);
    expect(items[0].itemType).toBe("year_pace_review");
  });

  it("emits broker_reauth at top when broker disconnected", async () => {
    PR.mockResolvedValue({
      holdings: [],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "reauth_required",
      brokerName: "Schwab",
    });
    const items = await buildQueueForUser("user_a");
    expect(items[0].itemType).toBe("broker_reauth");
    expect(items[0].horizon).toBe("TODAY");
    expect(items[0].body).toContain("Schwab");
  });

  it("emits concentration_breach_severe when weight > 2× cap", async () => {
    PR.mockResolvedValue({
      holdings: [{ ticker: "NVDA", weight: 12.0 }],
      concentrationBreaches: [{ ticker: "NVDA", weight: 12.0, cap: 5.0 }],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    const items = await buildQueueForUser("user_a");
    const breach = items.find((i) => i.itemType === "concentration_breach_severe");
    expect(breach).toBeDefined();
    expect(breach?.ticker).toBe("NVDA");
  });

  it("ranks higher-impact items first", async () => {
    PR.mockResolvedValue({
      holdings: [{ ticker: "NVDA", weight: 12.0 }],
      concentrationBreaches: [{ ticker: "NVDA", weight: 12.0, cap: 5.0 }],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: { amount: 3200, daysIdle: 30 },
      brokerStatus: "active",
      brokerName: null,
    });
    const items = await buildQueueForUser("user_a");
    const breachIdx = items.findIndex(
      (i) => i.itemType === "concentration_breach_severe",
    );
    const cashIdx = items.findIndex((i) => i.itemType === "cash_idle");
    expect(breachIdx).toBeGreaterThanOrEqual(0);
    expect(cashIdx).toBeGreaterThanOrEqual(0);
    expect(breachIdx).toBeLessThan(cashIdx);
  });

  it("filters out snoozed items", async () => {
    PR.mockResolvedValue({
      holdings: [],
      concentrationBreaches: [{ ticker: "NVDA", weight: 12.0, cap: 5.0 }],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    Q.mockResolvedValue({
      rows: [
        {
          item_key: "concentration_breach_severe:NVDA",
          status: "snoozed",
          firstSurfacedAt: new Date().toISOString(),
          snoozeUntil: future,
        },
      ],
    });
    const items = await buildQueueForUser("user_a");
    expect(
      items.find((i) => i.itemType === "concentration_breach_severe"),
    ).toBeUndefined();
  });

  it("filters out dismissed items", async () => {
    PR.mockResolvedValue({
      holdings: [],
      concentrationBreaches: [{ ticker: "NVDA", weight: 12.0, cap: 5.0 }],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    Q.mockResolvedValue({
      rows: [
        {
          item_key: "concentration_breach_severe:NVDA",
          status: "dismissed",
          firstSurfacedAt: new Date().toISOString(),
          snoozeUntil: null,
        },
      ],
    });
    const items = await buildQueueForUser("user_a");
    expect(
      items.find((i) => i.itemType === "concentration_breach_severe"),
    ).toBeUndefined();
  });

  it("filters out done items", async () => {
    OUT.mockResolvedValue([
      {
        recommendationId: "rec1",
        ticker: "META",
        outcomeMove: 0.082,
        outcomeVerdict: "win",
        originalDate: "Mar 18",
        originalVerdict: "BUY",
      },
    ]);
    Q.mockResolvedValue({
      rows: [
        {
          item_key: "outcome_action_mark:rec1",
          status: "done",
          firstSurfacedAt: new Date().toISOString(),
          snoozeUntil: null,
        },
      ],
    });
    const items = await buildQueueForUser("user_a");
    expect(
      items.find((i) => i.itemKey === "outcome_action_mark:rec1"),
    ).toBeUndefined();
  });

  it("always includes year_pace_review with horizon THIS_YEAR", async () => {
    const items = await buildQueueForUser("user_a");
    const yp = items.find((i) => i.itemType === "year_pace_review");
    expect(yp).toBeDefined();
    expect(yp?.horizon).toBe("THIS_YEAR");
  });
});
