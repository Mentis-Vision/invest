// src/lib/dashboard/queue-builder.test.ts
// Tests the Decision Queue composer. Mocks the queue-sources adapter
// (which wraps the real portfolio-review + outcomes modules) and the
// shared DB pool so we exercise composition logic without touching Neon.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./queue-sources", () => ({
  getReviewSummary: vi.fn(),
  listUnactionedOutcomes: vi.fn(),
}));

vi.mock("./metrics/quality-loader", () => ({
  getQualityScores: vi.fn(),
}));

vi.mock("./metrics/momentum-loader", () => ({
  getTickerMomentum: vi.fn(),
}));

vi.mock("./metrics/kelly-loader", () => ({
  getKellyFraction: vi.fn(),
}));

vi.mock("./metrics/risk-loader", () => ({
  getPortfolioValue: vi.fn(),
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
import { getQualityScores } from "./metrics/quality-loader";
import { getTickerMomentum } from "./metrics/momentum-loader";
import { getKellyFraction } from "./metrics/kelly-loader";
import { getPortfolioValue } from "./metrics/risk-loader";
import { pool } from "../db";

const PR = getReviewSummary as unknown as ReturnType<typeof vi.fn>;
const OUT = listUnactionedOutcomes as unknown as ReturnType<typeof vi.fn>;
const QS = getQualityScores as unknown as ReturnType<typeof vi.fn>;
const MOM = getTickerMomentum as unknown as ReturnType<typeof vi.fn>;
const KELLY = getKellyFraction as unknown as ReturnType<typeof vi.fn>;
const PV = getPortfolioValue as unknown as ReturnType<typeof vi.fn>;
const Q = pool.query as unknown as ReturnType<typeof vi.fn>;

/**
 * Default goals row used by the existing test fixtures so the
 * Phase 3 Batch F goals_setup emit doesn't fire unless a test
 * explicitly disables targetWealth. Existing tests don't care about
 * goals_setup, so this keeps their assertions about other item types
 * unaffected.
 */
const SET_GOALS = {
  targetWealth: 1_000_000,
  targetDate: "2050-01-01",
  monthlyContribution: 1000,
  currentAge: 40,
  riskTolerance: "moderate" as const,
};

/**
 * Merge the per-test `getReviewSummary` mock value with the Phase 3
 * Batch F defaults (`goals = SET_GOALS`, `stockAllocationPct = null`)
 * so we don't have to repeat them in every override. Tests that want
 * to exercise goals_setup / rebalance_drift override these explicitly.
 */
function mockReview(value: Record<string, unknown>): void {
  PR.mockResolvedValue({
    goals: SET_GOALS,
    stockAllocationPct: null,
    portfolioYtdPct: 0,
    spyYtdPct: 0,
    ...value,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReview({
    holdings: [],
    concentrationBreaches: [],
    upcomingCatalysts: [],
    staleRecs: [],
    cashIdle: null,
    brokerStatus: "active",
    brokerName: null,
  });
  OUT.mockResolvedValue([]);
  Q.mockResolvedValue({ rows: [] });
  QS.mockResolvedValue(null);
  MOM.mockResolvedValue(null);
  KELLY.mockResolvedValue(null);
  PV.mockResolvedValue(0);
});

describe("buildQueueForUser", () => {
  it("returns positive empty-state item when user has no data", async () => {
    const items = await buildQueueForUser("user_new");
    expect(items).toHaveLength(1);
    expect(items[0].itemType).toBe("year_pace_review");
  });

  it("emits broker_reauth at top when broker disconnected", async () => {
    mockReview({
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
    mockReview({
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
    mockReview({
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
    mockReview({
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
    mockReview({
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

  it("emits quality_decline when held ticker's Piotroski drops ≥2 points", async () => {
    mockReview({
      holdings: [{ ticker: "AAPL", weight: 5.0 }],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    QS.mockResolvedValue({
      piotroski: 4,
      altmanZ: 2.5,
      beneishM: -2.5,
      sloanAccruals: 0.05,
      priorPiotroski: 7,
    });
    const items = await buildQueueForUser("user_a");
    const qd = items.find((i) => i.itemType === "quality_decline");
    expect(qd).toBeDefined();
    expect(qd?.ticker).toBe("AAPL");
    expect(qd?.body).toMatch(/Piotroski dropped 7.+4/);
    expect(qd?.chips.some((c) => c.label === "F-Score")).toBe(true);
  });

  it("does NOT emit quality_decline when drop is < 2 points", async () => {
    mockReview({
      holdings: [{ ticker: "AAPL", weight: 5.0 }],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    QS.mockResolvedValue({
      piotroski: 6,
      altmanZ: 2.5,
      beneishM: -2.5,
      sloanAccruals: 0.05,
      priorPiotroski: 7,
    });
    const items = await buildQueueForUser("user_a");
    expect(items.find((i) => i.itemType === "quality_decline")).toBeUndefined();
  });

  it("does NOT emit quality_decline when prior Piotroski is missing", async () => {
    mockReview({
      holdings: [{ ticker: "AAPL", weight: 5.0 }],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    QS.mockResolvedValue({
      piotroski: 4,
      altmanZ: 2.5,
      beneishM: -2.5,
      sloanAccruals: 0.05,
      priorPiotroski: null,
    });
    const items = await buildQueueForUser("user_a");
    expect(items.find((i) => i.itemType === "quality_decline")).toBeUndefined();
  });

  it("enriches existing concentration_breach with quality chips when scores available", async () => {
    mockReview({
      holdings: [{ ticker: "NVDA", weight: 12.0 }],
      concentrationBreaches: [{ ticker: "NVDA", weight: 12.0, cap: 5.0 }],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    QS.mockResolvedValue({
      piotroski: 8,
      altmanZ: 5.5,
      beneishM: -2.4,
      sloanAccruals: 0.02,
      priorPiotroski: 8,
    });
    const items = await buildQueueForUser("user_a");
    const breach = items.find(
      (i) => i.itemType === "concentration_breach_severe",
    );
    expect(breach).toBeDefined();
    const chipLabels = breach?.chips.map((c) => c.label) ?? [];
    expect(chipLabels).toContain("conc");
    expect(chipLabels).toContain("F-Score");
    expect(chipLabels).toContain("Z");
    expect(chipLabels).toContain("M");
    expect(chipLabels).toContain("accruals");
  });

  it("adds a momentum chip to ticker-keyed items when 12-1 momentum is available", async () => {
    mockReview({
      holdings: [{ ticker: "NVDA", weight: 12.0 }],
      concentrationBreaches: [{ ticker: "NVDA", weight: 12.0, cap: 5.0 }],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    MOM.mockImplementation(async (ticker: string) =>
      ticker === "NVDA" ? 0.082 : null,
    );
    const items = await buildQueueForUser("user_a");
    const breach = items.find(
      (i) => i.itemType === "concentration_breach_severe",
    );
    expect(breach).toBeDefined();
    const momChip = breach?.chips.find((c) => c.label === "mom");
    expect(momChip).toBeDefined();
    expect(momChip?.value).toBe("+8.2%");
    expect(momChip?.tooltipKey).toBe("mom");
  });

  it("does NOT add a momentum chip when the loader returns null", async () => {
    mockReview({
      holdings: [{ ticker: "NVDA", weight: 12.0 }],
      concentrationBreaches: [{ ticker: "NVDA", weight: 12.0, cap: 5.0 }],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    MOM.mockResolvedValue(null);
    const items = await buildQueueForUser("user_a");
    const breach = items.find(
      (i) => i.itemType === "concentration_breach_severe",
    );
    expect(breach?.chips.find((c) => c.label === "mom")).toBeUndefined();
  });

  it("formats negative momentum without a leading + sign", async () => {
    mockReview({
      holdings: [{ ticker: "META", weight: 4.0 }],
      concentrationBreaches: [{ ticker: "META", weight: 4.0, cap: 3.0 }],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    MOM.mockResolvedValue(-0.135);
    const items = await buildQueueForUser("user_a");
    const breach = items.find(
      (i) => i.itemType === "concentration_breach_moderate",
    );
    const momChip = breach?.chips.find((c) => c.label === "mom");
    expect(momChip?.value).toBe("-13.5%");
  });

  it("adds a Kelly chip to stale_rec_held items when Kelly is computable", async () => {
    mockReview({
      holdings: [{ ticker: "AAPL", weight: 5.0 }],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [
        {
          ticker: "AAPL",
          recommendationId: "rec_1",
          daysAgo: 90,
          moveSinceRec: 12,
          originalVerdict: "BUY",
          priceAtRec: 180,
          isHeld: true,
        },
      ],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    KELLY.mockResolvedValue(0.0875);
    const items = await buildQueueForUser("user_a");
    const stale = items.find((i) => i.itemType === "stale_rec_held");
    expect(stale).toBeDefined();
    const kellyChip = stale?.chips.find((c) => c.label === "Kelly ¼");
    expect(kellyChip).toBeDefined();
    expect(kellyChip?.value).toBe("8.8%");
    expect(kellyChip?.tooltipKey).toBe("Kelly");
  });

  it("does NOT add a Kelly chip when the loader returns null", async () => {
    mockReview({
      holdings: [{ ticker: "AAPL", weight: 5.0 }],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [
        {
          ticker: "AAPL",
          recommendationId: "rec_1",
          daysAgo: 90,
          moveSinceRec: 12,
          originalVerdict: "BUY",
          priceAtRec: 180,
          isHeld: true,
        },
      ],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
    });
    KELLY.mockResolvedValue(null);
    const items = await buildQueueForUser("user_a");
    const stale = items.find((i) => i.itemType === "stale_rec_held");
    expect(stale?.chips.find((c) => c.label === "Kelly ¼")).toBeUndefined();
  });

  it("does NOT add a Kelly chip to non-eligible item types like cash_idle", async () => {
    mockReview({
      holdings: [],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: { amount: 3200, daysIdle: 30 },
      brokerStatus: "active",
      brokerName: null,
    });
    KELLY.mockResolvedValue(0.0875);
    const items = await buildQueueForUser("user_a");
    const cash = items.find((i) => i.itemType === "cash_idle");
    expect(cash?.chips.find((c) => c.label === "Kelly ¼")).toBeUndefined();
  });

  // -----------------------------------------------------------------
  // Phase 3 Batch F — goals_setup + rebalance_drift integration
  // -----------------------------------------------------------------

  it("emits goals_setup when no goals are set", async () => {
    mockReview({
      holdings: [],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
      goals: null,
      stockAllocationPct: null,
    });
    const items = await buildQueueForUser("user_a");
    const setup = items.find((i) => i.itemType === "goals_setup");
    expect(setup).toBeDefined();
    expect(setup?.title).toContain("Set your goals");
    expect(setup?.primaryActionHref).toBe("/app/settings/goals");
  });

  it("emits goals_setup when targetWealth is null even if other fields exist", async () => {
    mockReview({
      holdings: [],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
      goals: {
        targetWealth: null,
        targetDate: null,
        monthlyContribution: null,
        currentAge: 40,
        riskTolerance: "moderate" as const,
      },
      stockAllocationPct: 75,
    });
    const items = await buildQueueForUser("user_a");
    expect(items.find((i) => i.itemType === "goals_setup")).toBeDefined();
    // rebalance_drift must not also fire when goals_setup wins.
    expect(items.find((i) => i.itemType === "rebalance_drift")).toBeUndefined();
  });

  it("does NOT emit goals_setup when goals are fully set and no drift", async () => {
    mockReview({
      holdings: [],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
      // Glidepath for age 40 / moderate is 80% stocks, so 80% current
      // is zero drift — no rebalance_drift either.
      stockAllocationPct: 80,
    });
    const items = await buildQueueForUser("user_a");
    expect(items.find((i) => i.itemType === "goals_setup")).toBeUndefined();
    expect(items.find((i) => i.itemType === "rebalance_drift")).toBeUndefined();
  });

  it("emits rebalance_drift when stock allocation drift exceeds 5pp", async () => {
    // Glidepath for age 40 / moderate = 80% stocks. Current 60% =
    // 20pp under target → rebalance_drift fires with rebalanceDollars
    // = portfolioValue * 0.20.
    mockReview({
      holdings: [{ ticker: "VOO", weight: 60.0 }],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
      stockAllocationPct: 60,
    });
    PV.mockResolvedValue(100_000);
    const items = await buildQueueForUser("user_a");
    const reb = items.find((i) => i.itemType === "rebalance_drift");
    expect(reb).toBeDefined();
    expect(reb?.title).toMatch(/Allocation drift 20pp/);
    expect(reb?.body).toContain("Add stocks");
    expect(reb?.body).toContain("$20,000");
    const driftChip = reb?.chips.find((c) => c.label === "drift");
    expect(driftChip?.value).toBe("20pp");
  });

  it("does NOT emit rebalance_drift when drift is exactly 5pp", async () => {
    // Glidepath = 80% stocks, current 75% = 5pp under target. Strict
    // > 5 gate means no rebalance_drift.
    mockReview({
      holdings: [{ ticker: "VOO", weight: 75.0 }],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
      stockAllocationPct: 75,
    });
    PV.mockResolvedValue(100_000);
    const items = await buildQueueForUser("user_a");
    expect(items.find((i) => i.itemType === "rebalance_drift")).toBeUndefined();
  });

  it("does NOT emit rebalance_drift when stockAllocationPct is null", async () => {
    mockReview({
      holdings: [],
      concentrationBreaches: [],
      upcomingCatalysts: [],
      staleRecs: [],
      cashIdle: null,
      brokerStatus: "active",
      brokerName: null,
      stockAllocationPct: null,
    });
    const items = await buildQueueForUser("user_a");
    expect(items.find((i) => i.itemType === "rebalance_drift")).toBeUndefined();
  });
});
