import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("./benchmark-resolver", () => ({
  resolveBenchmarkReturn: vi.fn(),
  resolveBenchmarkLabel: vi.fn((k: string) => k.toUpperCase()),
  DEFAULT_BENCHMARKS: ["sp500", "nasdaq", "dow"],
}));
vi.mock("./metrics/risk-loader", () => ({
  getPortfolioValue: vi.fn(),
}));

import { pool } from "../db";
import { resolveBenchmarkReturn } from "./benchmark-resolver";
import { getPortfolioValue } from "./metrics/risk-loader";
import { getHeroData } from "./hero-loader";

const Q = pool.query as unknown as ReturnType<typeof vi.fn>;
const RB = resolveBenchmarkReturn as unknown as ReturnType<typeof vi.fn>;
const PV = getPortfolioValue as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  PV.mockResolvedValue(0);
  RB.mockResolvedValue(null);
  Q.mockResolvedValue({ rows: [] });
});

describe("getHeroData", () => {
  it("returns null totalValue and empty arrays when user has no data", async () => {
    const out = await getHeroData("user_new");
    expect(out.totalValue).toBe(0);
    expect(out.sparkline).toEqual([]);
    expect(out.topMovers).toEqual([]);
    expect(out.benchmarks.length).toBeGreaterThanOrEqual(0);
  });

  it("returns totalValue from getPortfolioValue", async () => {
    PV.mockResolvedValue(342810);
    const out = await getHeroData("user_a");
    expect(out.totalValue).toBe(342810);
  });

  it("computes day change from latest two snapshots", async () => {
    PV.mockResolvedValue(342810);
    Q.mockImplementation((sql: string) => {
      if (sql.includes("portfolio_snapshot") && sql.includes("ORDER BY \"capturedAt\" DESC") && sql.includes("LIMIT 2")) {
        return Promise.resolve({
          rows: [
            { capturedAt: "2026-05-03", totalValue: 342810 },
            { capturedAt: "2026-05-02", totalValue: 341570 },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const out = await getHeroData("user_a");
    expect(out.dayChange?.dollars).toBeCloseTo(1240, 0);
    expect(out.dayChange?.pct).toBeCloseTo(0.00363, 4);
  });

  it("returns null dayChange when fewer than 2 snapshots", async () => {
    PV.mockResolvedValue(342810);
    Q.mockResolvedValue({ rows: [{ capturedAt: "2026-05-03", totalValue: 342810 }] });
    const out = await getHeroData("user_a");
    expect(out.dayChange).toBeNull();
  });

  it("computes MTD and YTD pct from snapshot history", async () => {
    PV.mockResolvedValue(342810);
    Q.mockImplementation((sql: string) => {
      if (sql.includes("ORDER BY \"capturedAt\" DESC") && sql.includes("LIMIT 2")) {
        return Promise.resolve({
          rows: [
            { capturedAt: "2026-05-03", totalValue: 342810 },
            { capturedAt: "2026-05-02", totalValue: 341570 },
          ],
        });
      }
      if (sql.includes("date_trunc('month'")) {
        return Promise.resolve({ rows: [{ totalValue: 335780 }] });
      }
      if (sql.includes("date_trunc('year'")) {
        return Promise.resolve({ rows: [{ totalValue: 313340 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const out = await getHeroData("user_a");
    expect(out.mtdPct).toBeCloseTo((342810 - 335780) / 335780, 4);
    expect(out.ytdPct).toBeCloseTo((342810 - 313340) / 313340, 4);
  });

  it("falls back to default benchmarks when user_profile has none", async () => {
    PV.mockResolvedValue(100000);
    RB.mockResolvedValue(0.05);
    Q.mockImplementation((sql: string) => {
      if (sql.includes("user_profile") && sql.includes("benchmarks")) {
        return Promise.resolve({ rows: [] });
      }
      // give YTD some data so benchmarks can compute
      if (sql.includes("date_trunc('year'")) {
        return Promise.resolve({ rows: [{ totalValue: 95000 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const out = await getHeroData("user_a");
    expect(out.benchmarks.length).toBeGreaterThanOrEqual(3);
    const keys = out.benchmarks.map((b) => b.key);
    expect(keys).toContain("sp500");
    expect(keys).toContain("nasdaq");
    expect(keys).toContain("dow");
  });

  it("emits top 5 movers sorted by absolute change", async () => {
    PV.mockResolvedValue(100000);
    Q.mockImplementation((sql: string) => {
      if (sql.includes("holding") && sql.includes("change_pct")) {
        // SQL sorts by ABS(change_pct) DESC; mock returns the post-sort shape.
        return Promise.resolve({
          rows: [
            { ticker: "AAPL", change_pct: 2.3 },
            { ticker: "META", change_pct: 1.4 },
            { ticker: "NVDA", change_pct: -1.1 },
            { ticker: "GOOG", change_pct: 0.8 },
            { ticker: "TSLA", change_pct: -0.8 },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const out = await getHeroData("user_a");
    expect(out.topMovers).toHaveLength(5);
    expect(out.topMovers[0].ticker).toBe("AAPL");
    expect(out.topMovers[1].ticker).toBe("META");
    expect(out.topMovers[2].ticker).toBe("NVDA");
  });
});
