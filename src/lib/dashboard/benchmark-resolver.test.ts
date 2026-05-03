import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "../db";
import {
  BENCHMARK_PRESETS,
  resolveBenchmarkLabel,
  resolveBenchmarkTicker,
  isPresetKey,
  resolveBenchmarkReturn,
  validateCustomTicker,
  DEFAULT_BENCHMARKS,
} from "./benchmark-resolver";

const Q = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  Q.mockResolvedValue({ rows: [] });
});

describe("BENCHMARK_PRESETS", () => {
  it("includes the three defaults", () => {
    expect(BENCHMARK_PRESETS.sp500.ticker).toBe("SPY");
    expect(BENCHMARK_PRESETS.nasdaq.ticker).toBe("QQQ");
    expect(BENCHMARK_PRESETS.dow.ticker).toBe("DIA");
  });
  it("includes 60-40 synthetic", () => {
    expect(BENCHMARK_PRESETS["60-40"].synthetic).toEqual({
      components: [
        { ticker: "SPY", weight: 0.6 },
        { ticker: "AGG", weight: 0.4 },
      ],
    });
  });
});

describe("resolveBenchmarkLabel / resolveBenchmarkTicker", () => {
  it("returns preset label and ticker", () => {
    expect(resolveBenchmarkLabel("sp500")).toBe("S&P 500");
    expect(resolveBenchmarkTicker("sp500")).toBe("SPY");
  });
  it("returns custom ticker as both label and ticker", () => {
    expect(resolveBenchmarkLabel("ARKK")).toBe("ARKK");
    expect(resolveBenchmarkTicker("ARKK")).toBe("ARKK");
  });
});

describe("isPresetKey", () => {
  it("recognizes presets", () => {
    expect(isPresetKey("sp500")).toBe(true);
    expect(isPresetKey("xlk")).toBe(true);
  });
  it("rejects custom tickers", () => {
    expect(isPresetKey("ARKK")).toBe(false);
    expect(isPresetKey("BTC-USD")).toBe(false);
  });
});

describe("resolveBenchmarkReturn", () => {
  it("returns null when no warehouse rows", async () => {
    Q.mockResolvedValueOnce({ rows: [] });
    const out = await resolveBenchmarkReturn("sp500", "2026-01-01");
    expect(out).toBeNull();
  });

  it("computes simple return for a single-ticker preset", async () => {
    Q.mockResolvedValueOnce({
      rows: [
        { ticker: "SPY", captured_at: "2026-01-02", close: 480 },
        { ticker: "SPY", captured_at: "2026-05-03", close: 504 },
      ],
    });
    const out = await resolveBenchmarkReturn("sp500", "2026-01-01");
    expect(out).toBeCloseTo(0.05, 4);
  });

  it("computes weighted return for 60-40 synthetic", async () => {
    Q.mockResolvedValueOnce({
      rows: [
        { ticker: "SPY", captured_at: "2026-01-02", close: 100 },
        { ticker: "SPY", captured_at: "2026-05-03", close: 110 },
        { ticker: "AGG", captured_at: "2026-01-02", close: 100 },
        { ticker: "AGG", captured_at: "2026-05-03", close: 102 },
      ],
    });
    const out = await resolveBenchmarkReturn("60-40", "2026-01-01");
    expect(out).toBeCloseTo(0.068, 4);
  });

  it("handles custom ticker (key === ticker)", async () => {
    Q.mockResolvedValueOnce({
      rows: [
        { ticker: "ARKK", captured_at: "2026-01-02", close: 50 },
        { ticker: "ARKK", captured_at: "2026-05-03", close: 60 },
      ],
    });
    const out = await resolveBenchmarkReturn("ARKK", "2026-01-01");
    expect(out).toBeCloseTo(0.2, 4);
  });
});

describe("validateCustomTicker", () => {
  it("rejects when no warehouse rows", async () => {
    Q.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    const out = await validateCustomTicker("FAKEXYZ");
    expect(out.valid).toBe(false);
  });

  it("accepts when ≥30 days of history", async () => {
    Q.mockResolvedValueOnce({ rows: [{ count: "120" }] });
    const out = await validateCustomTicker("ARKK");
    expect(out.valid).toBe(true);
    expect(out.historyDays).toBe(120);
  });

  it("rejects when < 30 days of history", async () => {
    Q.mockResolvedValueOnce({ rows: [{ count: "8" }] });
    const out = await validateCustomTicker("NEWIPO");
    expect(out.valid).toBe(false);
    expect(out.historyDays).toBe(8);
  });

  it("normalizes ticker case", async () => {
    Q.mockResolvedValueOnce({ rows: [{ count: "120" }] });
    await validateCustomTicker("arkk");
    expect(Q).toHaveBeenCalledWith(expect.any(String), ["ARKK"]);
  });
});

describe("DEFAULT_BENCHMARKS", () => {
  it("matches migration default", () => {
    expect(DEFAULT_BENCHMARKS).toEqual(["sp500", "nasdaq", "dow"]);
  });
});
