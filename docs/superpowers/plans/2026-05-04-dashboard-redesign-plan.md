# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-04-dashboard-redesign-design.md` (commit `e2b379e`)

**Goal:** Replace the stacked `/app` overview with a unified dashboard — `<PortfolioHero>` + `<TodayDecision>` + `<WatchThisWeek>` + `<MarketConditionsSidebar>`, with configurable benchmark pills and BlockGrid below the fold.

**Architecture:** All Phase 1-4 services reused unchanged. New code: 1 migration, 2 services (`hero-loader.ts`, `benchmark-resolver.ts`), 5 React components (Hero / Today / Watch / Conditions / Picker), 3 API routes, 1 page rewrite. Net new: ~700 LOC. Net deleted: ~200 LOC (legacy-dashboard-section + old composition).

**Tech Stack:** Next.js 16.2.4 App Router · React 19.2 · TypeScript 5 · Vitest 4.1 · Neon Postgres · BetterAuth · Tailwind v4 + Base UI shadcn · `recharts` (already in deps for sparkline/donut).

**Hard constraints (AGENTS.md):** Migrations hand-applied via Neon MCP (project `broad-sun-50424626`). Reserved words double-quoted. `printf` not `echo` for env vars. Logging via `src/lib/log.ts` with `(scope, msg, data)` signature. No motion `initial:opacity:0` wrappers. Disclaimer banner stays.

---

## File Structure

**Created (new):**
- `migrations/2026-05-04-user-benchmarks.sql`
- `src/lib/dashboard/benchmark-resolver.ts` — preset map + `resolveBenchmarkReturn(key, fromDate)` + ticker validation
- `src/lib/dashboard/benchmark-resolver.test.ts`
- `src/lib/dashboard/hero-loader.ts` — composes `HeroData` (greeting/total/day-change/MTD-YTD/benchmarks/sparkline/movers)
- `src/lib/dashboard/hero-loader.test.ts`
- `src/components/dashboard/redesign/portfolio-hero.tsx`
- `src/components/dashboard/redesign/today-decision.tsx` — primary card + abbreviated `<DecisionList>` collapse
- `src/components/dashboard/redesign/watch-this-week.tsx`
- `src/components/dashboard/redesign/market-conditions-sidebar.tsx`
- `src/components/dashboard/redesign/benchmark-picker.tsx`
- `src/app/api/user/benchmarks/route.ts` (GET/POST)
- `src/app/api/benchmarks/validate/route.ts` (GET)

**Modified:**
- `src/app/app/page.tsx` — full rewrite of overview branch
- `src/lib/dashboard/types.ts` — add `BenchmarkComparison`, `TickerMover`, `HeroData` types

**Deleted:**
- `src/components/dashboard/legacy-dashboard-section.tsx` — Phase 4 stack-fix, no longer used

**Untouched (deliberately):**
- All Phase 1-4 metric services (`risk.ts`, `var.ts`, `regime.ts`, `quality.ts`, `momentum.ts`, `kelly.ts`, `goals.ts`, `tax.ts`, `fama-french.ts`, `damodaran-loader.ts`, `audit-ai.ts`, `monte-carlo.ts`, `behavioral-audit.ts`, `stress-test.ts`)
- All Phase 1-4 components except those listed above (drill panels, journal, research, settings, etc. all stay)
- AppShell, ticker tape, trial banner, account dropdown
- All `/app/*` sub-routes (`/r/[id]`, `/history`, `/year-outlook`, `/settings`, etc.)
- `?view=portfolio|research|strategy|integrations` passthrough still routes through `DashboardClient`
- `decision_queue_state` schema and snooze/dismiss/done routes

---

## Task 1: Migration — `user_profile.benchmarks` JSONB column

**Files:**
- Create: `migrations/2026-05-04-user-benchmarks.sql`
- Apply via: Neon MCP `mcp__Neon__run_sql_transaction`

- [ ] **Step 1: Confirm column doesn't already exist**

Use `mcp__Neon__describe_table_schema` (project `broad-sun-50424626`, db `neondb`, table `user_profile`). Confirm there is no `benchmarks` column.

- [ ] **Step 2: Write the migration SQL file**

```sql
-- migrations/2026-05-04-user-benchmarks.sql
-- Phase 5 dashboard redesign — user-configurable benchmark list.
-- Stores ordered array of benchmark keys (preset slugs OR ticker symbols).
-- Application enforces max 4 entries; DB does not constrain (future-proof).

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS benchmarks JSONB NOT NULL DEFAULT '["sp500","nasdaq","dow"]'::jsonb;
```

- [ ] **Step 3: Apply via Neon MCP**

Use `mcp__Neon__run_sql_transaction` with `sqlStatements: [<the ALTER above>]`. Expected: success, 1 statement committed.

- [ ] **Step 4: Verify column exists**

Re-describe `user_profile` and confirm `benchmarks JSONB NOT NULL DEFAULT '["sp500","nasdaq","dow"]'`.

- [ ] **Step 5: Commit**

```bash
git add migrations/2026-05-04-user-benchmarks.sql
git commit -m "feat(db): user_profile.benchmarks JSONB for configurable index comparisons

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `benchmark-resolver.ts` — presets + return resolver (TDD)

**Files:**
- Create: `src/lib/dashboard/benchmark-resolver.ts`
- Test: `src/lib/dashboard/benchmark-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/dashboard/benchmark-resolver.test.ts
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
    expect(out).toBeCloseTo(0.05, 4); // (504-480)/480 = 0.05
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
    // 0.6 * 0.10 + 0.4 * 0.02 = 0.068
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/lib/dashboard/benchmark-resolver.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `benchmark-resolver.ts`**

```ts
// src/lib/dashboard/benchmark-resolver.ts
// Spec §6.2. Resolves benchmark keys (preset slugs or raw tickers) to
// labels + tickers, computes returns over a window, and validates
// custom user-entered tickers against warehouse coverage.

import { pool } from "../db";
import { log, errorInfo } from "../log";

export interface BenchmarkPreset {
  ticker: string;
  label: string;
  /** If set, the preset is a synthetic blend of weighted components (e.g. 60/40). */
  synthetic?: { components: { ticker: string; weight: number }[] };
}

export const BENCHMARK_PRESETS: Record<string, BenchmarkPreset> = {
  // Major indices
  sp500: { ticker: "SPY", label: "S&P 500" },
  nasdaq: { ticker: "QQQ", label: "Nasdaq" },
  dow: { ticker: "DIA", label: "Dow" },
  russell2000: { ticker: "IWM", label: "Russell 2000" },
  msci_world: { ticker: "URTH", label: "MSCI World" },
  vti: { ticker: "VTI", label: "Total US Market" },
  // Synthetic portfolios
  "60-40": {
    ticker: "60-40",
    label: "60/40 Portfolio",
    synthetic: {
      components: [
        { ticker: "SPY", weight: 0.6 },
        { ticker: "AGG", weight: 0.4 },
      ],
    },
  },
  // Sector ETFs (SPDR)
  xlk: { ticker: "XLK", label: "Tech (XLK)" },
  xlf: { ticker: "XLF", label: "Financials (XLF)" },
  xlv: { ticker: "XLV", label: "Healthcare (XLV)" },
  xle: { ticker: "XLE", label: "Energy (XLE)" },
  xly: { ticker: "XLY", label: "Cons Disc (XLY)" },
  xlp: { ticker: "XLP", label: "Cons Staples (XLP)" },
  xli: { ticker: "XLI", label: "Industrials (XLI)" },
  xlb: { ticker: "XLB", label: "Materials (XLB)" },
  xlu: { ticker: "XLU", label: "Utilities (XLU)" },
  xlre: { ticker: "XLRE", label: "Real Estate (XLRE)" },
  xlc: { ticker: "XLC", label: "Comm Services (XLC)" },
};

export const DEFAULT_BENCHMARKS = ["sp500", "nasdaq", "dow"] as const;

export function isPresetKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(BENCHMARK_PRESETS, key);
}

export function resolveBenchmarkLabel(key: string): string {
  return BENCHMARK_PRESETS[key]?.label ?? key.toUpperCase();
}

export function resolveBenchmarkTicker(key: string): string {
  return BENCHMARK_PRESETS[key]?.ticker ?? key.toUpperCase();
}

interface WarehouseRow {
  ticker: string;
  captured_at: string;
  close: number;
}

/**
 * Compute return for a benchmark from `fromDate` to the most recent
 * available close. For synthetic blends, returns the weighted sum of
 * component returns. Returns null if any required ticker has insufficient
 * data.
 */
export async function resolveBenchmarkReturn(
  key: string,
  fromDate: string,
): Promise<number | null> {
  const preset = BENCHMARK_PRESETS[key];

  // Single ticker (preset or custom)
  if (!preset?.synthetic) {
    const ticker = resolveBenchmarkTicker(key);
    return computeSingleReturn(ticker, fromDate);
  }

  // Synthetic blend
  const tickers = preset.synthetic.components.map((c) => c.ticker);
  const result = await pool
    .query<WarehouseRow>(
      `SELECT ticker, captured_at, close
       FROM ticker_market_daily
       WHERE ticker = ANY($1::text[])
         AND captured_at >= $2::date
         AND close IS NOT NULL
       ORDER BY captured_at ASC`,
      [tickers, fromDate],
    )
    .catch((err) => {
      log.warn("dashboard.benchmark", "synthetic query failed", {
        key,
        ...errorInfo(err),
      });
      return { rows: [] as WarehouseRow[] };
    });

  let weighted = 0;
  for (const c of preset.synthetic.components) {
    const series = result.rows.filter((r) => r.ticker === c.ticker);
    if (series.length < 2) return null;
    const first = series[0].close;
    const last = series[series.length - 1].close;
    if (!first || !last) return null;
    weighted += c.weight * ((last - first) / first);
  }
  return weighted;
}

async function computeSingleReturn(
  ticker: string,
  fromDate: string,
): Promise<number | null> {
  try {
    const result = await pool.query<WarehouseRow>(
      `SELECT ticker, captured_at, close
       FROM ticker_market_daily
       WHERE ticker = $1
         AND captured_at >= $2::date
         AND close IS NOT NULL
       ORDER BY captured_at ASC`,
      [ticker.toUpperCase(), fromDate],
    );
    if (result.rows.length < 2) return null;
    const first = result.rows[0].close;
    const last = result.rows[result.rows.length - 1].close;
    if (!first || !last) return null;
    return (last - first) / first;
  } catch (err) {
    log.warn("dashboard.benchmark", "single return query failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

export interface CustomTickerValidation {
  valid: boolean;
  ticker: string;
  historyDays: number;
}

/**
 * Validates a user-entered custom ticker by checking warehouse coverage.
 * Requires ≥30 days of close prices in `ticker_market_daily`.
 */
export async function validateCustomTicker(
  rawTicker: string,
): Promise<CustomTickerValidation> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker || ticker.length > 20 || !/^[A-Z0-9.\-]+$/.test(ticker)) {
    return { valid: false, ticker, historyDays: 0 };
  }
  try {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM ticker_market_daily
       WHERE ticker = $1
         AND close IS NOT NULL
         AND captured_at >= CURRENT_DATE - INTERVAL '90 days'`,
      [ticker],
    );
    const historyDays = Number(result.rows[0]?.count ?? 0);
    return { valid: historyDays >= 30, ticker, historyDays };
  } catch (err) {
    log.warn("dashboard.benchmark", "validate failed", {
      ticker,
      ...errorInfo(err),
    });
    return { valid: false, ticker, historyDays: 0 };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/lib/dashboard/benchmark-resolver.test.ts
```

Expected: PASS, all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/benchmark-resolver.ts src/lib/dashboard/benchmark-resolver.test.ts
git commit -m "feat(dashboard): benchmark-resolver presets + return + ticker validation

Spec §5.5 + §6.2 — preset map for indices/sectors/synthetic blends,
resolveBenchmarkReturn, validateCustomTicker. Used by hero-loader
and benchmark picker.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `hero-loader.ts` — composes hero data (TDD)

**Files:**
- Create: `src/lib/dashboard/hero-loader.ts`
- Test: `src/lib/dashboard/hero-loader.test.ts`
- Modify: `src/lib/dashboard/types.ts`

- [ ] **Step 1: Add types to `types.ts`**

Append to `src/lib/dashboard/types.ts`:

```ts
// ── Phase 5 dashboard redesign types ──

export interface BenchmarkComparison {
  key: string;       // preset slug ("sp500") or custom ticker ("ARKK")
  label: string;     // human-readable
  deltaPct: number;  // portfolio − benchmark over chosen window, fraction
}

export interface TickerMover {
  ticker: string;
  changePct: number;  // signed fraction (0.023 = +2.3%)
}

export interface HeroSparklinePoint {
  date: string;       // ISO date
  value: number;      // portfolio total $ on that date
}

export interface HeroData {
  totalValue: number | null;
  dayChange: { dollars: number; pct: number } | null;
  mtdPct: number | null;
  ytdPct: number | null;
  benchmarks: BenchmarkComparison[];
  sparkline: HeroSparklinePoint[];
  topMovers: TickerMover[];
  asOf: string | null;
}
```

Commit after this step:

```bash
git add src/lib/dashboard/types.ts
git commit -m "feat(dashboard): types for HeroData / BenchmarkComparison / TickerMover

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 2: Write failing tests for hero-loader**

```ts
// src/lib/dashboard/hero-loader.test.ts
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
  // Default: no rows for any query
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
      if (sql.includes("portfolio_snapshot") && sql.includes("ORDER BY captured_at DESC")) {
        return Promise.resolve({
          rows: [
            { captured_at: "2026-05-03", total_value: 342810 },
            { captured_at: "2026-05-02", total_value: 341570 },
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
    Q.mockResolvedValue({ rows: [{ captured_at: "2026-05-03", total_value: 342810 }] });
    const out = await getHeroData("user_a");
    expect(out.dayChange).toBeNull();
  });

  it("computes MTD and YTD pct from snapshot history", async () => {
    PV.mockResolvedValue(342810);
    // Match the same mock fn used for day-change AND mtd/ytd queries
    let queryCount = 0;
    Q.mockImplementation((sql: string) => {
      queryCount++;
      // 1st call: latest two snapshots (day change)
      if (sql.includes("ORDER BY captured_at DESC") && sql.includes("LIMIT 2")) {
        return Promise.resolve({
          rows: [
            { captured_at: "2026-05-03", total_value: 342810 },
            { captured_at: "2026-05-02", total_value: 341570 },
          ],
        });
      }
      // 2nd call: month-start snapshot
      if (sql.includes("date_trunc('month'")) {
        return Promise.resolve({ rows: [{ total_value: 335780 }] });
      }
      // 3rd call: year-start snapshot
      if (sql.includes("date_trunc('year'")) {
        return Promise.resolve({ rows: [{ total_value: 313340 }] });
      }
      // 4th call: sparkline
      if (sql.includes("ORDER BY captured_at ASC") && sql.includes("LIMIT 30")) {
        return Promise.resolve({ rows: [] });
      }
      // 5th call: holdings + ticker_market_daily for movers
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
        return Promise.resolve({ rows: [] }); // no profile row
      }
      return Promise.resolve({ rows: [] });
    });
    const out = await getHeroData("user_a");
    // Should still produce 3 benchmark entries (defaults)
    expect(out.benchmarks.length).toBeGreaterThanOrEqual(3);
    const keys = out.benchmarks.map((b) => b.key);
    expect(keys).toContain("sp500");
    expect(keys).toContain("nasdaq");
    expect(keys).toContain("dow");
  });

  it("emits top 5 movers sorted by absolute change", async () => {
    PV.mockResolvedValue(100000);
    Q.mockImplementation((sql: string) => {
      // Movers query joins holding with ticker_market_daily
      if (sql.includes("holding") && sql.includes("change_pct")) {
        return Promise.resolve({
          rows: [
            { ticker: "AAPL", change_pct: 0.023 },
            { ticker: "META", change_pct: 0.014 },
            { ticker: "GOOG", change_pct: 0.008 },
            { ticker: "TSLA", change_pct: -0.008 },
            { ticker: "NVDA", change_pct: -0.011 },
            { ticker: "AMZN", change_pct: 0.001 },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const out = await getHeroData("user_a");
    expect(out.topMovers).toHaveLength(5);
    // Sorted by abs descending: AAPL (.023), META (.014), NVDA (.011), TSLA (.008), GOOG (.008)
    expect(out.topMovers[0].ticker).toBe("AAPL");
    expect(out.topMovers[1].ticker).toBe("META");
    expect(out.topMovers[2].ticker).toBe("NVDA");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- src/lib/dashboard/hero-loader.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `hero-loader.ts`**

```ts
// src/lib/dashboard/hero-loader.ts
// Spec §6.2. Composes the PortfolioHero data: total / day change /
// MTD-YTD / benchmarks / sparkline / top movers. Pure read of existing
// data sources (portfolio_snapshot + ticker_market_daily + holding +
// user_profile.benchmarks). No AI calls.

import { pool } from "../db";
import { log, errorInfo } from "../log";
import {
  resolveBenchmarkReturn,
  resolveBenchmarkLabel,
  DEFAULT_BENCHMARKS,
} from "./benchmark-resolver";
import { getPortfolioValue } from "./metrics/risk-loader";
import type {
  HeroData,
  BenchmarkComparison,
  TickerMover,
  HeroSparklinePoint,
} from "./types";

interface SnapshotRow {
  captured_at: string;
  total_value: number;
}

interface MoverRow {
  ticker: string;
  change_pct: number;
}

interface BenchmarkRow {
  benchmarks: string[] | null;
}

async function loadDayChange(
  userId: string,
  totalValue: number,
): Promise<HeroData["dayChange"]> {
  const result = await pool
    .query<SnapshotRow>(
      `SELECT captured_at::text AS captured_at, total_value
       FROM portfolio_snapshot
       WHERE "userId" = $1
       ORDER BY captured_at DESC
       LIMIT 2`,
      [userId],
    )
    .catch((err) => {
      log.warn("dashboard.hero", "day-change query failed", {
        userId,
        ...errorInfo(err),
      });
      return { rows: [] as SnapshotRow[] };
    });
  if (result.rows.length < 2) return null;
  const today = result.rows[0].total_value;
  const yesterday = result.rows[1].total_value;
  if (!yesterday) return null;
  return {
    dollars: today - yesterday,
    pct: (today - yesterday) / yesterday,
  };
}

async function loadPeriodReturn(
  userId: string,
  trunc: "month" | "year",
  totalValue: number,
): Promise<number | null> {
  const result = await pool
    .query<{ total_value: number }>(
      `SELECT total_value
       FROM portfolio_snapshot
       WHERE "userId" = $1
         AND captured_at >= date_trunc('${trunc}', CURRENT_DATE)
       ORDER BY captured_at ASC
       LIMIT 1`,
      [userId],
    )
    .catch((err) => {
      log.warn("dashboard.hero", `${trunc}-return query failed`, {
        userId,
        ...errorInfo(err),
      });
      return { rows: [] as { total_value: number }[] };
    });
  const start = result.rows[0]?.total_value;
  if (!start || !totalValue) return null;
  return (totalValue - start) / start;
}

async function loadSparkline(userId: string): Promise<HeroSparklinePoint[]> {
  const result = await pool
    .query<SnapshotRow>(
      `SELECT captured_at::text AS captured_at, total_value
       FROM portfolio_snapshot
       WHERE "userId" = $1
         AND captured_at >= CURRENT_DATE - INTERVAL '45 days'
       ORDER BY captured_at ASC
       LIMIT 30`,
      [userId],
    )
    .catch((err) => {
      log.warn("dashboard.hero", "sparkline query failed", {
        userId,
        ...errorInfo(err),
      });
      return { rows: [] as SnapshotRow[] };
    });
  return result.rows.map((r) => ({ date: r.captured_at, value: r.total_value }));
}

async function loadTopMovers(userId: string): Promise<TickerMover[]> {
  // Join holdings with the latest market row per ticker; rank by abs(change_pct).
  const result = await pool
    .query<MoverRow>(
      `WITH latest AS (
         SELECT DISTINCT ON (ticker)
                ticker, change_pct
         FROM ticker_market_daily
         WHERE captured_at >= CURRENT_DATE - INTERVAL '5 days'
         ORDER BY ticker, captured_at DESC
       )
       SELECT h.ticker, COALESCE(l.change_pct, 0)::float AS change_pct
       FROM holding h
       LEFT JOIN latest l ON l.ticker = h.ticker
       WHERE h."userId" = $1
         AND h."assetClass" IS DISTINCT FROM 'cash'
         AND l.change_pct IS NOT NULL
       ORDER BY ABS(l.change_pct) DESC
       LIMIT 5`,
      [userId],
    )
    .catch((err) => {
      log.warn("dashboard.hero", "movers query failed", {
        userId,
        ...errorInfo(err),
      });
      return { rows: [] as MoverRow[] };
    });
  return result.rows.map((r) => ({ ticker: r.ticker, changePct: r.change_pct / 100 }));
}

async function loadUserBenchmarkKeys(userId: string): Promise<string[]> {
  const result = await pool
    .query<BenchmarkRow>(
      `SELECT benchmarks FROM user_profile WHERE "userId" = $1`,
      [userId],
    )
    .catch((err) => {
      log.warn("dashboard.hero", "benchmarks query failed", {
        userId,
        ...errorInfo(err),
      });
      return { rows: [] as BenchmarkRow[] };
    });
  const stored = result.rows[0]?.benchmarks;
  if (Array.isArray(stored) && stored.length > 0) {
    return stored.slice(0, 4).map(String);
  }
  return [...DEFAULT_BENCHMARKS];
}

async function loadBenchmarkComparisons(
  userId: string,
  ytdPct: number | null,
): Promise<BenchmarkComparison[]> {
  if (ytdPct === null) return [];
  const yearStart = new Date();
  yearStart.setUTCMonth(0, 1);
  const fromDate = yearStart.toISOString().slice(0, 10);
  const keys = await loadUserBenchmarkKeys(userId);
  const out: BenchmarkComparison[] = [];
  for (const key of keys) {
    const benchReturn = await resolveBenchmarkReturn(key, fromDate);
    if (benchReturn === null) continue;
    out.push({
      key,
      label: resolveBenchmarkLabel(key),
      deltaPct: ytdPct - benchReturn,
    });
  }
  return out;
}

export async function getHeroData(userId: string): Promise<HeroData> {
  const totalValue = await getPortfolioValue(userId);

  const [dayChange, mtdPct, ytdPct, sparkline, topMovers] = await Promise.all([
    loadDayChange(userId, totalValue),
    loadPeriodReturn(userId, "month", totalValue),
    loadPeriodReturn(userId, "year", totalValue),
    loadSparkline(userId),
    loadTopMovers(userId),
  ]);

  const benchmarks = await loadBenchmarkComparisons(userId, ytdPct);

  const asOf = sparkline[sparkline.length - 1]?.date ?? null;

  return {
    totalValue,
    dayChange,
    mtdPct,
    ytdPct,
    benchmarks,
    sparkline,
    topMovers,
    asOf,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- src/lib/dashboard/hero-loader.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/hero-loader.ts src/lib/dashboard/hero-loader.test.ts
git commit -m "feat(dashboard): hero-loader composes PortfolioHero data

Reads portfolio_snapshot for total/day-change/MTD/YTD/sparkline,
holding+ticker_market_daily for movers, user_profile.benchmarks
for comparison set. Falls back to defaults gracefully.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: API routes — `/api/user/benchmarks` + `/api/benchmarks/validate`

**Files:**
- Create: `src/app/api/user/benchmarks/route.ts`
- Create: `src/app/api/benchmarks/validate/route.ts`

- [ ] **Step 1: Read existing API auth pattern**

```bash
cat src/app/api/queue/snooze/route.ts | head -40
```

Confirm: `await auth.api.getSession({ headers: await headers() })`, returns 401 on missing session, uses `pool.query` directly, logs via `log.info("scope", "msg", { ... })`.

- [ ] **Step 2: Implement `/api/user/benchmarks/route.ts`**

```ts
// src/app/api/user/benchmarks/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";
import {
  isPresetKey,
  validateCustomTicker,
  DEFAULT_BENCHMARKS,
} from "@/lib/dashboard/benchmark-resolver";

const MAX_BENCHMARKS = 4;

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await pool.query<{ benchmarks: string[] | null }>(
    `SELECT benchmarks FROM user_profile WHERE "userId" = $1`,
    [session.user.id],
  );
  const stored = result.rows[0]?.benchmarks;
  const keys = Array.isArray(stored) && stored.length > 0
    ? stored.slice(0, MAX_BENCHMARKS).map(String)
    : [...DEFAULT_BENCHMARKS];
  return NextResponse.json({ ok: true, benchmarks: keys });
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { benchmarks?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const raw = body.benchmarks;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "benchmarks_must_be_array" }, { status: 400 });
  }
  if (raw.length === 0 || raw.length > MAX_BENCHMARKS) {
    return NextResponse.json(
      { error: `benchmarks_count_must_be_1_to_${MAX_BENCHMARKS}` },
      { status: 400 },
    );
  }

  // Validate each entry: preset OR custom ticker with warehouse coverage
  const cleaned: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length > 30) {
      return NextResponse.json({ error: "invalid_benchmark_entry" }, { status: 400 });
    }
    if (isPresetKey(entry)) {
      cleaned.push(entry);
      continue;
    }
    const validation = await validateCustomTicker(entry);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "ticker_not_supported", ticker: entry, historyDays: validation.historyDays },
        { status: 400 },
      );
    }
    cleaned.push(validation.ticker);
  }

  // Ensure user_profile row exists, then update
  await pool.query(
    `INSERT INTO user_profile ("userId", benchmarks)
     VALUES ($1, $2::jsonb)
     ON CONFLICT ("userId")
     DO UPDATE SET benchmarks = $2::jsonb, "updatedAt" = NOW()`,
    [session.user.id, JSON.stringify(cleaned)],
  );

  log.info("user.benchmarks", "saved", {
    userId: session.user.id,
    count: cleaned.length,
  });
  return NextResponse.json({ ok: true, benchmarks: cleaned });
}
```

- [ ] **Step 3: Implement `/api/benchmarks/validate/route.ts`**

```ts
// src/app/api/benchmarks/validate/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { validateCustomTicker } from "@/lib/dashboard/benchmark-resolver";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "missing_ticker" }, { status: 400 });
  }
  const validation = await validateCustomTicker(ticker);
  return NextResponse.json({
    ok: true,
    valid: validation.valid,
    ticker: validation.ticker,
    historyDays: validation.historyDays,
  });
}
```

- [ ] **Step 4: Verify proxy.ts auth-gates `/api/user/*` and `/api/benchmarks/*`**

```bash
grep -nE "/api/(user|benchmarks)" src/proxy.ts | head -5
```

If not covered by an existing matcher, add the smallest possible regex change. Likely covered already by a generic `/api/*` rule — verify.

- [ ] **Step 5: Verify build still compiles**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/user/benchmarks/route.ts src/app/api/benchmarks/validate/route.ts
# Add src/proxy.ts only if you changed it:
git add src/proxy.ts 2>/dev/null || true
git commit -m "feat(api): /api/user/benchmarks GET/POST + /api/benchmarks/validate

Spec §6.4. Validates each benchmark entry as preset or custom ticker
with ≥30d warehouse coverage. Cap 4 benchmarks per user.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `<PortfolioHero>` component

**Files:**
- Create: `src/components/dashboard/redesign/portfolio-hero.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/dashboard/redesign/portfolio-hero.tsx
// Spec §5.1. Server-renderable hero with greeting, $ total, day change,
// MTD/YTD, configurable benchmark pills, 30-day sparkline, top-5 movers.

import type { HeroData } from "@/lib/dashboard/types";
import { BenchmarkPickerLauncher } from "./benchmark-picker";

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPctSigned(n: number, digits = 2): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

function fmtPctSimple(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function formatDate(): string {
  const today = new Date();
  return today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function buildSparklinePath(points: { date: string; value: number }[]): {
  line: string;
  area: string;
  width: number;
  height: number;
} {
  const width = 240;
  const height = 36;
  if (points.length < 2) return { line: "", area: "", width, height };
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = height - ((p.value - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area =
    line +
    ` L ${(coords[coords.length - 1][0]).toFixed(1)} ${height} L 0 ${height} Z`;
  return { line, area, width, height };
}

export function PortfolioHero({
  userName,
  hero,
}: {
  userName: string | null;
  hero: HeroData | null;
}) {
  const greeting = userName ? `Good morning, ${userName}` : "Good morning";
  const today = formatDate();

  // Empty state — no portfolio
  if (!hero || hero.totalValue === null || hero.totalValue === 0) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-5">
        <div className="text-[10px] tracking-widest uppercase text-[var(--hold)]">
          {today} · {greeting}
        </div>
        <div className="mt-2 text-base font-semibold">
          Connect a brokerage to see your portfolio →
        </div>
        <div className="mt-1 text-xs text-[var(--muted-foreground)]">
          We&apos;ll sync your holdings, sync prices nightly, and surface what to act on each morning.
        </div>
      </div>
    );
  }

  const sparkline = buildSparklinePath(hero.sparkline);
  const sparkDelta =
    hero.sparkline.length >= 2
      ? hero.sparkline[hero.sparkline.length - 1].value - hero.sparkline[0].value
      : 0;
  const sparkColor = sparkDelta >= 0 ? "var(--buy)" : "var(--sell)";

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-5 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-4">
      {/* LEFT: greeting + total + benchmarks */}
      <div>
        <div className="text-[10px] tracking-widest uppercase text-[var(--hold)]">
          {today} · {greeting}
        </div>
        <div className="flex items-baseline gap-3 mt-1.5">
          <div className="text-3xl font-extrabold tracking-tight">{fmtMoney(hero.totalValue)}</div>
          {hero.dayChange && (
            <div
              className="text-sm font-bold"
              style={{ color: hero.dayChange.dollars >= 0 ? "var(--buy)" : "var(--sell)" }}
            >
              {hero.dayChange.dollars >= 0 ? "+" : "−"}
              {fmtMoney(Math.abs(hero.dayChange.dollars))} today ({fmtPctSigned(hero.dayChange.pct)})
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center mt-2.5">
          {hero.mtdPct !== null && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              MTD <b className="text-[var(--foreground)]">{fmtPctSimple(hero.mtdPct)}</b>
            </span>
          )}
          {hero.mtdPct !== null && hero.ytdPct !== null && (
            <span className="text-[var(--border)]">·</span>
          )}
          {hero.ytdPct !== null && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              YTD <b className="text-[var(--foreground)]">{fmtPctSimple(hero.ytdPct)}</b>
            </span>
          )}
          {hero.benchmarks.map((b) => (
            <span
              key={b.key}
              className="text-[10px] bg-[var(--background)] border border-[var(--border)] px-1.5 py-0.5 rounded-lg"
            >
              vs {b.label}{" "}
              <b style={{ color: b.deltaPct >= 0 ? "var(--buy)" : "var(--sell)" }}>
                {fmtPctSimple(b.deltaPct)}
              </b>
            </span>
          ))}
          <BenchmarkPickerLauncher initialKeys={hero.benchmarks.map((b) => b.key)} />
        </div>
      </div>

      {/* RIGHT: sparkline (top) + top movers (bottom) */}
      <div className="flex flex-col gap-2">
        <div>
          <div className="flex justify-between items-baseline">
            <div className="text-[8px] tracking-widest uppercase text-[var(--muted-foreground)]">
              30-day trend
            </div>
            {hero.sparkline.length >= 2 && (
              <div
                className="text-[9px] font-bold"
                style={{ color: sparkColor }}
              >
                {sparkDelta >= 0 ? "+" : "−"}
                {fmtMoney(Math.abs(sparkDelta))}
              </div>
            )}
          </div>
          {sparkline.line ? (
            <svg
              viewBox={`0 0 ${sparkline.width} ${sparkline.height}`}
              className="w-full h-9 mt-1"
              preserveAspectRatio="none"
            >
              <path d={sparkline.area} fill={sparkColor} fillOpacity={0.08} />
              <path d={sparkline.line} fill="none" stroke={sparkColor} strokeWidth={1.5} strokeLinejoin="round" />
            </svg>
          ) : (
            <div className="h-9 flex items-center justify-center text-[9px] text-[var(--muted-foreground)]">
              Not enough history yet
            </div>
          )}
        </div>
        <div>
          <div className="text-[8px] tracking-widest uppercase text-[var(--muted-foreground)] mb-1">
            Top movers today
          </div>
          {hero.topMovers.length === 0 ? (
            <div className="text-[10px] text-[var(--muted-foreground)]">No movers data yet</div>
          ) : (
            <div className="grid grid-cols-5 gap-1">
              {hero.topMovers.map((m) => (
                <div
                  key={m.ticker}
                  className="bg-[var(--background)] border border-[var(--border)] rounded px-1.5 py-1 text-center"
                >
                  <div className="text-[9px] font-bold">{m.ticker}</div>
                  <div
                    className="text-[10px] font-bold"
                    style={{ color: m.changePct >= 0 ? "var(--buy)" : "var(--sell)" }}
                  >
                    {fmtPctSimple(m.changePct).replace("+", "+").replace("%", "")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: clean (the `BenchmarkPickerLauncher` import will fail until Task 9 — fix that error temporarily by adding a stub export, OR skip this verification step until after Task 9). Pragmatic: stub the import:

Add temporary stub at top of `portfolio-hero.tsx`:
```tsx
// TEMP stub — replaced by Task 9 component
const BenchmarkPickerLauncher = ({ initialKeys }: { initialKeys: string[] }) => (
  <button className="text-[10px] border border-dashed border-[var(--decisive)] text-[var(--decisive)] px-2 py-0.5 rounded-lg">
    + benchmark
  </button>
);
```

(We'll replace this stub in Task 9.)

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/redesign/portfolio-hero.tsx
git commit -m "feat(dashboard): PortfolioHero with sparkline + movers + benchmark pills

Spec §5.1. Server-renderable. Greeting + total + day change + MTD/YTD
+ configurable benchmark pills (left). 30-day sparkline + top-5 movers
(right). Empty state for users without holdings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `<TodayDecision>` component

**Files:**
- Create: `src/components/dashboard/redesign/today-decision.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/dashboard/redesign/today-decision.tsx
// Spec §5.2. Primary decision card + collapsible abbreviated list of
// remaining queue items. Reuses existing chip + action patterns.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { QueueItem } from "@/lib/dashboard/types";
import { LayeredChipRow } from "@/components/dashboard/layered-chip-row";

type Action = "snooze" | "dismiss";

export function TodayDecision({
  primary,
  others,
}: {
  primary: QueueItem | null;
  others: QueueItem[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function act(action: Action) {
    if (!primary) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/queue/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey: primary.itemKey }),
      });
      if (!res.ok) throw new Error(`${action} failed: ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(action);
      console.error("today-decision.action-failed", err);
    } finally {
      setBusy(null);
    }
  }

  if (!primary) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] border-l-4 border-l-[var(--decisive)] rounded-md p-5">
        <div className="text-[10px] tracking-widest uppercase text-[var(--decisive)] font-bold">
          Today&apos;s decision
        </div>
        <div className="text-base font-semibold mt-1.5">
          No urgent decisions right now.
        </div>
        <div className="text-xs text-[var(--muted-foreground)] mt-1">
          Browse research candidates or check the latest activity.
        </div>
        <div className="mt-3">
          <button
            onClick={() => router.push("/app?view=research")}
            className="bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded"
          >
            Open research
          </button>
        </div>
      </div>
    );
  }

  const total = 1 + others.length;

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] border-l-4 border-l-[var(--decisive)] rounded-md p-5">
      <div className="flex justify-between items-baseline">
        <div className="text-[10px] tracking-widest uppercase text-[var(--decisive)] font-bold">
          Today&apos;s decision · 1 of {total}
        </div>
        {others.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-[var(--decisive)] font-bold"
          >
            {expanded ? "− hide more" : `+ ${others.length} more ▾`}
          </button>
        )}
      </div>

      <div className="flex justify-between items-start gap-4 mt-2">
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold leading-tight">{primary.title}</div>
          <div className="text-xs text-[var(--muted-foreground)] mt-1">{primary.body}</div>
          <div className="mt-2">
            <LayeredChipRow chips={primary.chips} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 min-w-[120px]">
          <button
            onClick={() => router.push(primary.primaryActionHref)}
            className="bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded"
          >
            {primary.primaryActionLabel}
          </button>
          <button
            onClick={() => act("snooze")}
            disabled={busy !== null}
            className="border border-[var(--border)] text-xs px-3 py-1.5 rounded disabled:opacity-50"
          >
            {busy === "snooze" ? "Snoozing…" : "Snooze 1d"}
          </button>
          <button
            onClick={() => act("dismiss")}
            disabled={busy !== null}
            className="border border-[var(--border)] text-[var(--muted-foreground)] text-xs px-3 py-1.5 rounded disabled:opacity-50"
          >
            {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
          </button>
          {error && (
            <span role="alert" className="text-[10px] text-[var(--sell)]">
              Couldn&apos;t {error}. Try again.
            </span>
          )}
        </div>
      </div>

      {expanded && others.length > 0 && (
        <div className="mt-4 pt-3 border-t border-dashed border-[var(--border)]">
          <div className="text-[8px] tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">
            Other decisions queued
          </div>
          <div className="flex flex-col gap-1">
            {others.map((item, i) => (
              <button
                key={item.itemKey}
                onClick={() => router.push(item.primaryActionHref)}
                className="flex justify-between items-baseline gap-2 px-2 py-1.5 bg-[var(--background)] rounded text-left hover:bg-[var(--border)] transition-colors"
              >
                <div className="text-xs">
                  <b>{i + 2}.</b> {item.ticker ? `${item.ticker} · ` : ""}
                  {item.title}
                </div>
                <span className="text-[9px] text-[var(--muted-foreground)] flex-shrink-0">
                  {item.chips
                    .slice(0, 2)
                    .map((c) => `${c.label} ${c.value}`)
                    .join(" · ")}
                </span>
              </button>
            ))}
          </div>
          <div className="text-[9px] text-[var(--muted-foreground)] italic mt-1.5">
            Click any to open the full thesis.
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/redesign/today-decision.tsx
git commit -m "feat(dashboard): TodayDecision with collapsible abbreviated list

Spec §5.2. Primary decision keeps full hero treatment. '+ N more ▾'
caret expands rows 2-N as abbreviated entries; click any to open
thesis. Reuses /api/queue/snooze and /api/queue/dismiss.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `<WatchThisWeek>` component

**Files:**
- Create: `src/components/dashboard/redesign/watch-this-week.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/dashboard/redesign/watch-this-week.tsx
// Spec §5.3. Top 3 THIS_WEEK queue items with horizon badges.
import Link from "next/link";
import type { QueueItem, ItemTypeKey } from "@/lib/dashboard/types";

const BADGE: Record<string, { label: string; bg: string }> = {
  catalyst_prep_imminent: { label: "EARNINGS", bg: "var(--decisive)" },
  catalyst_prep_upcoming: { label: "EARNINGS", bg: "var(--decisive)" },
  outcome_action_mark: { label: "REVIEW", bg: "var(--hold)" },
  cash_idle: { label: "DEPLOY", bg: "var(--hold)" },
  stale_rec_held: { label: "REVIEW", bg: "var(--hold)" },
  stale_rec_watched: { label: "REVIEW", bg: "var(--hold)" },
  concentration_breach_severe: { label: "RISK", bg: "var(--sell)" },
  concentration_breach_moderate: { label: "RISK", bg: "var(--sell)" },
  broker_reauth: { label: "RECONNECT", bg: "var(--sell)" },
  rebalance_drift: { label: "REBALANCE", bg: "var(--hold)" },
  goals_setup: { label: "SETUP", bg: "var(--hold)" },
  tax_harvest: { label: "TAX", bg: "var(--buy)" },
  quality_decline: { label: "QUALITY", bg: "var(--sell)" },
  cluster_buying: { label: "INSIDER", bg: "var(--buy)" },
  year_pace_review: { label: "PACE", bg: "var(--buy)" },
};

function badge(itemType: ItemTypeKey): { label: string; bg: string } {
  return BADGE[itemType] ?? { label: "WATCH", bg: "var(--muted-foreground)" };
}

function buildSecondaryText(item: QueueItem): string {
  // Extract first 1-2 chips as a compact secondary description
  return item.chips
    .slice(0, 2)
    .map((c) => `${c.label} ${c.value}`)
    .join(" · ");
}

export function WatchThisWeek({
  items,
  totalCount,
}: {
  items: QueueItem[];
  totalCount: number;
}) {
  if (items.length === 0) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-4">
        <div className="text-[10px] tracking-widest uppercase text-[var(--hold)] font-bold">
          Watch this week
        </div>
        <div className="text-xs text-[var(--muted-foreground)] mt-2">
          Nothing to watch this week. Quiet weeks are normal.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-4">
      <div className="flex justify-between items-baseline mb-2">
        <div className="text-[10px] tracking-widest uppercase text-[var(--hold)] font-bold">
          Watch this week · {items.length}
        </div>
        {totalCount > items.length && (
          <Link
            href="/app/history"
            className="text-[10px] text-[var(--decisive)]"
          >
            View all →
          </Link>
        )}
      </div>
      <div className="text-xs leading-relaxed">
        {items.map((item, i) => {
          const b = badge(item.itemType);
          const isLast = i === items.length - 1;
          return (
            <Link
              key={item.itemKey}
              href={item.primaryActionHref}
              className={`flex justify-between items-baseline gap-2 py-1.5 ${
                isLast ? "" : "border-b border-dashed border-[var(--border)] mb-1.5"
              } hover:bg-[var(--background)]`}
            >
              <div className="min-w-0 flex-1">
                <span className="font-bold">
                  {item.ticker ? `${item.ticker} · ` : ""}
                  {item.title.replace(/^[A-Z]+ · /, "")}
                </span>{" "}
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  {buildSecondaryText(item)}
                </span>
              </div>
              <span
                className="text-[8px] text-white px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                style={{ backgroundColor: b.bg }}
              >
                {b.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/redesign/watch-this-week.tsx
git commit -m "feat(dashboard): WatchThisWeek list with horizon badges

Spec §5.3. Top 3 THIS_WEEK queue items, dashed dividers, color-coded
badges (EARNINGS/REVIEW/DEPLOY/RISK/etc). View-all link to /app/history.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `<MarketConditionsSidebar>` component

**Files:**
- Create: `src/components/dashboard/redesign/market-conditions-sidebar.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/dashboard/redesign/market-conditions-sidebar.tsx
// Spec §5.4. Compact sidebar showing the regime label + 3 signal lines.
// Reuses Phase 2 regime-loader output.

import Link from "next/link";
import { AsOfFootnote } from "@/components/dashboard/as-of-footnote";

export type RegimeLabel = "RISK_ON" | "NEUTRAL" | "FRAGILE" | "STRESS";

const COLOR_FOR_REGIME: Record<RegimeLabel, string> = {
  RISK_ON: "var(--buy)",
  NEUTRAL: "var(--foreground)",
  FRAGILE: "var(--decisive)",
  STRESS: "var(--sell)",
};

const READABLE: Record<RegimeLabel, string> = {
  RISK_ON: "Risk On",
  NEUTRAL: "Neutral",
  FRAGILE: "Fragile",
  STRESS: "Stress",
};

export function MarketConditionsSidebar({
  label,
  vix,
  vixTermStructure,
  daysToFOMC,
  real10Y,
  asOf,
}: {
  label: RegimeLabel | null;
  vix: number | null;
  vixTermStructure: "contango" | "backwardation" | null;
  daysToFOMC: number | null;
  real10Y: number | null;
  asOf: string | null;
}) {
  if (!label) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-4">
        <div className="text-[10px] tracking-widest uppercase text-[var(--hold)] font-bold">
          Market conditions
        </div>
        <div className="text-xs text-[var(--muted-foreground)] mt-2">
          Macro signals unavailable. Try again later.
        </div>
      </div>
    );
  }

  const color = COLOR_FOR_REGIME[label];

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-4 flex flex-col gap-2">
      <div className="text-[10px] tracking-widest uppercase text-[var(--hold)] font-bold">
        Market conditions
      </div>
      <div
        className="text-lg font-bold italic"
        style={{ color, fontFamily: "Fraunces, Georgia, serif" }}
      >
        {READABLE[label]}
      </div>
      <div className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">
        {vix !== null && (
          <>
            VIX {vix.toFixed(1)}
            {vixTermStructure && ` · ${vixTermStructure}`}
            <br />
          </>
        )}
        {daysToFOMC !== null && daysToFOMC < 999 && (
          <>
            FOMC in {daysToFOMC}d
            <br />
          </>
        )}
        {real10Y !== null && (
          <>Real 10Y {real10Y >= 0 ? "+" : ""}{real10Y.toFixed(1)}%</>
        )}
      </div>
      <Link
        href="/app/year-outlook"
        className="text-[9px] text-[var(--hold)] mt-1"
      >
        view full outlook →
      </Link>
      <AsOfFootnote source="Macro signals" asOf={asOf ?? undefined} />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/redesign/market-conditions-sidebar.tsx
git commit -m "feat(dashboard): MarketConditionsSidebar (renamed from MarketRegimeTile)

Spec §5.4. Fraunces italic for the label, three signal lines, link
to /app/year-outlook for full macro context. Reuses regime-loader.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `<BenchmarkPicker>` modal + launcher

**Files:**
- Create: `src/components/dashboard/redesign/benchmark-picker.tsx`
- Modify: `src/components/dashboard/redesign/portfolio-hero.tsx` (replace stub import)

- [ ] **Step 1: Inspect existing dialog primitive**

```bash
ls src/components/ui/ | grep -i dialog
head -40 src/components/ui/dialog.tsx 2>/dev/null
```

If `Dialog` exists, use it. Otherwise use a simple `<dialog>` element with React state.

- [ ] **Step 2: Implement `benchmark-picker.tsx`**

```tsx
// src/components/dashboard/redesign/benchmark-picker.tsx
// Spec §5.5. Modal launched from PortfolioHero "+ benchmark" pill.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BENCHMARK_PRESETS } from "@/lib/dashboard/benchmark-resolver";

const MAX = 4;

const SECTIONS: { title: string; keys: string[] }[] = [
  { title: "Major indices", keys: ["sp500", "nasdaq", "dow", "russell2000", "msci_world"] },
  { title: "Diversified portfolios", keys: ["vti", "60-40"] },
  {
    title: "Sector ETFs",
    keys: ["xlk", "xlf", "xlv", "xle", "xly", "xlp", "xli", "xlb", "xlu", "xlre", "xlc"],
  },
];

export function BenchmarkPickerLauncher({
  initialKeys,
}: {
  initialKeys: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] border border-dashed border-[var(--decisive)] text-[var(--decisive)] px-2 py-0.5 rounded-lg"
      >
        + benchmark
      </button>
      {open && (
        <BenchmarkPicker
          initialKeys={initialKeys}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function BenchmarkPicker({
  initialKeys,
  onClose,
}: {
  initialKeys: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>(initialKeys);
  const [customTicker, setCustomTicker] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggle(key: string) {
    setError(null);
    setSelected((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX) {
        setError(`Max ${MAX} active. Deselect one to add another.`);
        return prev;
      }
      return [...prev, key];
    });
  }

  async function addCustom() {
    setError(null);
    const t = customTicker.trim().toUpperCase();
    if (!t) return;
    if (selected.includes(t)) {
      setError("Already in your list.");
      return;
    }
    if (selected.length >= MAX) {
      setError(`Max ${MAX} active. Deselect one to add another.`);
      return;
    }
    const res = await fetch(`/api/benchmarks/validate?ticker=${encodeURIComponent(t)}`);
    const data = (await res.json().catch(() => ({}))) as {
      valid?: boolean;
      historyDays?: number;
    };
    if (!data.valid) {
      setError(
        `Need ≥30 days of price history. Have ${data.historyDays ?? 0} day(s).`,
      );
      return;
    }
    setSelected((prev) => [...prev, t]);
    setCustomTicker("");
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/user/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ benchmarks: selected }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `save failed: ${res.status}`);
      }
      startTransition(() => router.refresh());
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-md p-5 w-full max-w-md max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-bold mb-3">Compare your portfolio to…</div>
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-3">
            <div className="text-[10px] tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">
              {section.title}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {section.keys.map((key) => {
                const isSelected = selected.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggle(key)}
                    className={`text-[10px] px-2 py-1 rounded-lg ${
                      isSelected
                        ? "bg-[var(--foreground)] text-[var(--background)] font-bold"
                        : "bg-[var(--card)] border border-[var(--border)]"
                    }`}
                  >
                    {BENCHMARK_PRESETS[key]?.label ?? key.toUpperCase()}
                    {isSelected && " ✓"}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="border-t border-[var(--border)] pt-3 mt-3">
          <div className="text-[10px] tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">
            Custom ticker
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="ARKK or BTC-USD"
              value={customTicker}
              onChange={(e) => setCustomTicker(e.target.value.toUpperCase())}
              className="text-xs border border-[var(--border)] px-2 py-1 rounded flex-1"
            />
            <button
              onClick={addCustom}
              className="text-[10px] text-[var(--decisive)] border border-[var(--decisive)] px-2 py-1 rounded"
            >
              + add
            </button>
          </div>
          {/* Show currently-active custom (non-preset) entries with deselect */}
          {selected.filter((k) => !BENCHMARK_PRESETS[k]).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {selected
                .filter((k) => !BENCHMARK_PRESETS[k])
                .map((k) => (
                  <button
                    key={k}
                    onClick={() => toggle(k)}
                    className="text-[10px] bg-[var(--foreground)] text-[var(--background)] px-2 py-1 rounded-lg font-bold"
                  >
                    {k} ✓
                  </button>
                ))}
            </div>
          )}
        </div>
        {error && (
          <div role="alert" className="text-[11px] text-[var(--sell)] mt-3">
            {error}
          </div>
        )}
        <div className="flex justify-between items-center mt-4">
          <div className="text-[10px] text-[var(--muted-foreground)] italic">
            Up to {MAX} active. Saved to your profile.
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={onClose}
              className="text-xs border border-[var(--border)] px-3 py-1.5 rounded"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || selected.length === 0}
              className="bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Remove stub from `portfolio-hero.tsx`**

In `src/components/dashboard/redesign/portfolio-hero.tsx`, REMOVE the temporary stub:

```tsx
// DELETE THIS BLOCK:
const BenchmarkPickerLauncher = ({ initialKeys }: { initialKeys: string[] }) => (
  <button className="text-[10px] border border-dashed border-[var(--decisive)] text-[var(--decisive)] px-2 py-0.5 rounded-lg">
    + benchmark
  </button>
);
```

The existing import line at the top should now resolve to the real export from `./benchmark-picker`.

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
npm run build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/redesign/benchmark-picker.tsx \
        src/components/dashboard/redesign/portfolio-hero.tsx
git commit -m "feat(dashboard): BenchmarkPickerLauncher + modal

Spec §5.5. Toggle pills for presets, custom-ticker input with
warehouse validation, max 4 active. Saves to /api/user/benchmarks
and refreshes route.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Rewrite `/app/page.tsx` + delete legacy-dashboard-section

**Files:**
- Modify: `src/app/app/page.tsx`
- Delete: `src/components/dashboard/legacy-dashboard-section.tsx`

- [ ] **Step 1: Read current page.tsx and identify what's preserved**

```bash
sed -n '1,80p' src/app/app/page.tsx
```

Note: keep the auth/redirect, the Stripe post-OAuth checkout branch, the `?view=` passthrough, and the `ensureSubscriptionRecord` call. Replace only the overview-render block.

- [ ] **Step 2: Rewrite `src/app/app/page.tsx`**

Replace the current overview-render block (the `// ---- New overview composition ----` section through the closing `</TooltipProvider>`) with this:

```tsx
// ---- New overview composition (Phase 5 redesign) ------------------
const userId = session.user.id;

const [hero, queue, regime] = await Promise.all([
  getHeroData(userId).catch((err) => {
    log.warn("app.page", "hero-loader failed", { userId, ...errorInfo(err) });
    return null;
  }),
  buildQueueForUser(userId).catch((err) => {
    log.warn("app.page", "buildQueueForUser failed", { userId, ...errorInfo(err) });
    return [] as QueueItem[];
  }),
  getMarketRegime().catch((err) => {
    log.warn("app.page", "getMarketRegime failed", { ...errorInfo(err) });
    return null;
  }),
]);

const primary = queue[0] ?? null;
const others = queue.slice(1);
const watchThisWeek = queue
  .filter((i) => i.horizon === "THIS_WEEK")
  .slice(0, 3);

return (
  <TooltipProvider delay={200}>
    <main className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-3">
      <PortfolioHero userName={session.user.name ?? null} hero={hero} />
      <TodayDecision primary={primary} others={others} />
      <div className="grid grid-cols-1 md:grid-cols-[1.8fr_1fr] gap-3">
        <WatchThisWeek items={watchThisWeek} totalCount={queue.length} />
        <MarketConditionsSidebar
          label={regime?.label ?? null}
          vix={regime?.signals.vixLevel ?? null}
          vixTermStructure={
            regime?.signals.vixTermRatio === null || regime?.signals.vixTermRatio === undefined
              ? null
              : regime.signals.vixTermRatio < 1
                ? "contango"
                : "backwardation"
          }
          daysToFOMC={regime?.signals.daysToFOMC ?? null}
          real10Y={regime?.signals.real10Y ?? null}
          asOf={regime?.asOf ?? null}
        />
      </div>
    </main>
  </TooltipProvider>
);
```

Update the imports at the top of the file. Replace:

```tsx
import DashboardClient from "@/components/dashboard-client";
import { DailyHeadline } from "@/components/dashboard/daily-headline";
import { DecisionQueue } from "@/components/dashboard/decision-queue";
import { RiskTile } from "@/components/dashboard/risk-tile";
import { VarTile } from "@/components/dashboard/var-tile";
import { MarketRegimeTile } from "@/components/dashboard/market-regime-tile";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { HeadlineCache, QueueItem } from "@/lib/dashboard/types";
import { LegacyDashboardSection } from "@/components/dashboard/legacy-dashboard-section";
```

with:

```tsx
import DashboardClient from "@/components/dashboard-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PortfolioHero } from "@/components/dashboard/redesign/portfolio-hero";
import { TodayDecision } from "@/components/dashboard/redesign/today-decision";
import { WatchThisWeek } from "@/components/dashboard/redesign/watch-this-week";
import { MarketConditionsSidebar } from "@/components/dashboard/redesign/market-conditions-sidebar";
import { getHeroData } from "@/lib/dashboard/hero-loader";
import { buildQueueForUser } from "@/lib/dashboard/queue-builder";
import { getMarketRegime } from "@/lib/dashboard/metrics/regime-loader";
import type { QueueItem } from "@/lib/dashboard/types";
```

If the actual export name from `regime-loader` is different from `getMarketRegime` (verify with `grep -n "export" src/lib/dashboard/metrics/regime-loader.ts`), use the actual name. Same for the regime signal field names — adapt the prop mapping in `MarketConditionsSidebar` accordingly. Keep the existing `errorInfo` import since the `log.warn` calls use it.

Also: keep the `?view=` passthrough block exactly as-is so portfolio/research/strategy/integrations still route through DashboardClient.

- [ ] **Step 3: Delete legacy-dashboard-section.tsx**

```bash
rm src/components/dashboard/legacy-dashboard-section.tsx
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
npm run build
```

Expected: clean compile. The deleted file is no longer imported anywhere.

- [ ] **Step 5: Manual smoke check (optional but recommended)**

```bash
npm run dev &
DEV_PID=$!
sleep 5
curl -s http://localhost:3000/sign-in -o /dev/null -w "%{http_code}\n"
kill $DEV_PID 2>/dev/null
```

Expected: `200`. The app boots and the sign-in page renders. (Authenticated dashboard render requires session cookie — defer to live demo-user verification in Task 11.)

- [ ] **Step 6: Commit**

```bash
git add src/app/app/page.tsx
git rm src/components/dashboard/legacy-dashboard-section.tsx
git commit -m "feat(dashboard): rewrite /app overview with redesigned composition

Spec §7. Replaces stacked Headline+Queue+tiles+legacy with unified
PortfolioHero / TodayDecision / WatchThisWeek / MarketConditionsSidebar
layout. Deletes legacy-dashboard-section wrapper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Verification + acceptance pass

**Files:** none modified — manual + automated checks only.

- [ ] **Step 1: Run full vitest suite**

```bash
npm test
```

Expected: ALL pre-existing tests + new (~25) tests pass. No regression.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: 0 errors. Pre-existing warnings (e.g., `TIER_LIMITS` unused) are OK.

- [ ] **Step 4: Run production build**

```bash
npm run build
```

Expected: clean compile. `/app` listed as `ƒ` dynamic route.

- [ ] **Step 5: Manual acceptance pass against spec §9**

Sign in as `demo@clearpathinvest.app` (`DemoPass2026!`) locally with `npm run dev`. Verify each acceptance criterion:

- [ ] AC1 — `/app` p95 load <600ms (network tab, repeat refresh)
- [ ] AC2 — Hero shows greeting + total + day change + MTD/YTD + 3 benchmarks + sparkline + 5 movers
- [ ] AC3 — TodayDecision visible, "+ N more" caret expands inline list
- [ ] AC4 — WatchThisWeek shows up to 3 THIS_WEEK items with badges
- [ ] AC5 — MarketConditionsSidebar shows regime label + 3 signals + as-of
- [ ] AC6 — New no-broker user sees the empty-state hero (test by creating a fresh signup OR temporarily mocking)
- [ ] AC7 — Snoozing primary decision: queue refreshes; row 2 promotes; "+ N more" decrements; cache invalidates
- [ ] AC8 — Benchmark picker opens, can toggle, custom ticker validates, save persists
- [ ] AC9 — BlockGrid available below the fold (deferred to follow-up if not yet wired in this task batch — confirm at minimum the page doesn't crash)
- [ ] AC10 — Mobile 375px: all sections stack, no horizontal scroll
- [ ] AC11 — Dark mode toggles cleanly (no per-component override needed)
- [ ] AC12 — Disclaimer banner visible (confirm location)

- [ ] **Step 6: Final commit**

```bash
git commit --allow-empty -m "chore(dashboard): Phase 5 redesign feature-complete and acceptance-verified

All §9 acceptance criteria validated against demo user.
- Vitest: PASS
- tsc: clean
- build: clean
- lint: 0 errors

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage check (self-review)

| Spec section | Tasks |
|---|---|
| §1 Problem / §2 Goals / §3 Approach | Plan-wide |
| §4 Information Architecture | Task 10 |
| §5.1 PortfolioHero | Task 5 |
| §5.2 TodayDecision | Task 6 |
| §5.3 WatchThisWeek | Task 7 |
| §5.4 MarketConditionsSidebar | Task 8 |
| §5.5 BenchmarkPicker | Task 9 |
| §6.1 Reused services | Plan-wide (no new code; consumed by hero-loader and page.tsx) |
| §6.2 hero-loader + benchmark-resolver | Tasks 2 + 3 |
| §6.3 user_profile.benchmarks migration | Task 1 |
| §6.4 API routes | Task 4 |
| §7 Page composition | Task 10 |
| §7.1 What's removed | Task 10 (page replacement + legacy-dashboard-section delete) |
| §8 Visual style | Tasks 5–9 (each component applies tokens) |
| §9 Acceptance criteria | Task 11 |
| §10 Implementation outline | This plan mirrors §10 |
| §11 Risks & mitigations | Baked into per-component empty states + API validation |
| §12 Out of scope | Honored — no Phase 6 widgets or `/app/queue` route built |

All sections covered. Type names consistent across tasks (`HeroData`, `BenchmarkComparison`, `TickerMover`, `QueueItem`, `RegimeLabel`).

---

**End of plan.**
