# Ticker Data Warehouse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a privacy-first, anonymized, ticker-keyed data warehouse (5 tables) that powers dashboard / alerts / research / analytics without storing any per-user data in the warehouse itself.

**Architecture:** Domain-split tables populated by the nightly cron from free sources (Yahoo, SEC, FRED, Finnhub). Typed readers in `src/lib/warehouse.ts` are the only path from app code into the warehouse. App handlers join warehouse + user data at request time; warehouse never contains `userId`.

**Tech Stack:** Next.js 16 App Router · Neon Postgres (`@neondatabase/serverless`) · Vercel cron · yahoo-finance2 v3 · SEC EDGAR REST · FRED REST · Finnhub (optional) · `technicalindicators` npm (new, for RSI/MACD/Bollinger).

**Spec:** `docs/superpowers/specs/2026-04-16-ticker-data-warehouse-design.md`

**Project rules (from AGENTS.md):**
- Never use `echo` for Vercel env vars — always `printf "VALUE" | vercel env add NAME production --scope mentisvision`
- Deploy command: `vercel --prod --scope mentisvision --yes`
- Direct provider keys, never AI Gateway
- Demo user `demo@clearpath.com` / `DemoPass2026!` — do not delete
- `proxy.ts` matcher must exclude `_next/static`
- No motion wrappers with `initial: opacity: 0`
- `generateObject` is still valid in `ai@^6.0.162` — ignore false-positive hook warnings

**Verification stack (this repo has no Jest/Vitest):**
- Types: `./node_modules/.bin/tsc --noEmit`
- Build: `npm run build`
- SQL verification: Neon MCP (`run_sql`, `describe_table_schema`)
- Deployed smoke: `curl` against `https://clearpath-invest.vercel.app` with demo session cookie
- Cron trigger: `curl -H "Authorization: Bearer $CRON_SECRET" https://clearpath-invest.vercel.app/api/cron/evaluate-outcomes`

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `src/lib/warehouse/types.ts` | Typed row shapes for all 5 tables + shared enums |
| `src/lib/warehouse/index.ts` | Re-export surface: typed readers callers import |
| `src/lib/warehouse/market.ts` | `getTickerMarket`, `getTickerMarketBatch`, `warmTickerMarket` |
| `src/lib/warehouse/fundamentals.ts` | `getTickerFundamentals`, `upsertFundamentalsFromYahoo` |
| `src/lib/warehouse/events.ts` | `getUpcomingEvents`, `getRecentEvents`, event insertion helpers |
| `src/lib/warehouse/sentiment.ts` | `getTickerSentiment`, `upsertSentimentFromFinnhub` |
| `src/lib/warehouse/aggregate.ts` | `upsertSystemMetric`, rollup computation |
| `src/lib/warehouse/universe.ts` | `getTickerUniverse(): Promise<string[]>` — the one boundary that reads `holding.ticker` |
| `src/lib/warehouse/indicators.ts` | Pure compute: RSI, MACD, Bollinger, rel-strength from OHLC arrays |
| `src/lib/warehouse/refresh.ts` | Orchestrator: top-level `refreshWarehouse()` the cron calls; composes all domain refreshers |
| `src/app/api/cron/warehouse-retention/route.ts` | Weekly retention sweeper (separate cron entry) |
| `src/app/api/warehouse/ticker/[ticker]/route.ts` | Read API for dashboard — returns all 4 ticker-keyed tables in one response |
| `src/components/dashboard/ticker-card.tsx` | Tiered-display card component (Basic / Intermediate / Advanced) |

**Modified files:**

| File | Change |
|---|---|
| `src/app/api/cron/evaluate-outcomes/route.ts` | Add steps 8–12 calling `refreshWarehouse()` |
| `src/app/api/research/route.ts` | DATA block splits into live (Yahoo) + warehouse sources |
| `src/app/api/portfolio-review/route.ts` | Batch-read warehouse for holdings |
| `src/lib/alerts.ts` | `scanPriceMoves` reads warehouse instead of Yahoo direct |
| `src/lib/outcomes.ts` | `getOrFetchPrice` reads warehouse first |
| `src/components/views/dashboard.tsx` | Use new tiered `TickerCard` component |
| `src/app/app/settings/settings-client.tsx` | Add Dashboard density selector |
| `src/lib/user-profile.ts` | Add `density` to preferences type + sanitize |
| `vercel.json` | Register `/api/cron/warehouse-retention` weekly cron |
| `AGENTS.md` | Add warehouse rules |

---

## Phase 1 — Schema + read helpers (no behavior change)

Goal: 5 empty tables exist, typed readers compile, nothing else visible.

Acceptance test: `./node_modules/.bin/tsc --noEmit` passes, `npm run build` passes, all 5 tables visible in Neon, app behaves identically to pre-change.

---

### Task 1.1: Migrate the 5 warehouse tables

**Files:**
- Execute via Neon MCP (`run_sql_transaction`), no repo file changes.

- [ ] **Step 1: Verify tables don't exist yet**

Run via Neon MCP:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'ticker_market_daily',
    'ticker_fundamentals',
    'ticker_events',
    'ticker_sentiment_daily',
    'system_aggregate_daily'
  );
```
Expected: empty result set.

- [ ] **Step 2: Run the migration as a single transaction**

Use `mcp__Neon__run_sql_transaction` with projectId `broad-sun-50424626` and the following `sqlStatements` array:

```sql
-- Statement 1
CREATE TABLE "ticker_market_daily" (
  ticker TEXT NOT NULL,
  captured_at DATE NOT NULL,
  as_of TIMESTAMP NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'yahoo',
  open NUMERIC(14,4), high NUMERIC(14,4), low NUMERIC(14,4),
  close NUMERIC(14,4), volume BIGINT, change_pct NUMERIC(8,4),
  ma_50 NUMERIC(14,4), ma_200 NUMERIC(14,4),
  bollinger_upper NUMERIC(14,4), bollinger_lower NUMERIC(14,4),
  vwap_20d NUMERIC(14,4),
  high_52w NUMERIC(14,4), low_52w NUMERIC(14,4), beta NUMERIC(6,3),
  market_cap BIGINT, pe_trailing NUMERIC(10,3), pe_forward NUMERIC(10,3),
  price_to_book NUMERIC(10,3), price_to_sales NUMERIC(10,3),
  ev_to_ebitda NUMERIC(10,3), dividend_yield NUMERIC(8,5),
  eps_ttm NUMERIC(12,4),
  rsi_14 NUMERIC(6,2), macd NUMERIC(10,4), macd_signal NUMERIC(10,4),
  rel_strength_spy_30d NUMERIC(8,4),
  analyst_target_mean NUMERIC(14,4), analyst_count INT, analyst_rating TEXT,
  short_interest_pct NUMERIC(6,4),
  PRIMARY KEY (ticker, captured_at)
)

-- Statement 2
CREATE INDEX "ticker_market_daily_date_idx"
  ON "ticker_market_daily" (captured_at DESC)

-- Statement 3
CREATE TABLE "ticker_fundamentals" (
  ticker TEXT NOT NULL,
  period_ending DATE NOT NULL,
  period_type TEXT NOT NULL,
  filing_accession TEXT, reported_at DATE,
  as_of TIMESTAMP NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'yahoo',
  revenue BIGINT, gross_profit BIGINT, operating_income BIGINT,
  net_income BIGINT, ebitda BIGINT,
  eps_basic NUMERIC(12,4), eps_diluted NUMERIC(12,4),
  total_assets BIGINT, total_liabilities BIGINT, total_equity BIGINT,
  total_debt BIGINT, total_cash BIGINT, shares_outstanding BIGINT,
  operating_cash_flow BIGINT, free_cash_flow BIGINT, capex BIGINT,
  gross_margin NUMERIC(8,5), operating_margin NUMERIC(8,5), net_margin NUMERIC(8,5),
  roe NUMERIC(8,5), roa NUMERIC(8,5),
  current_ratio NUMERIC(8,3), debt_to_equity NUMERIC(8,3),
  PRIMARY KEY (ticker, period_ending, period_type)
)

-- Statement 4
CREATE INDEX "ticker_fundamentals_ticker_idx"
  ON "ticker_fundamentals" (ticker, period_ending DESC)

-- Statement 5
CREATE TABLE "ticker_events" (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_time TIMESTAMP,
  details JSONB NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  as_of TIMESTAMP NOT NULL DEFAULT NOW()
)

-- Statement 6
CREATE INDEX "ticker_events_ticker_date_idx"
  ON "ticker_events" (ticker, event_date DESC)

-- Statement 7
CREATE INDEX "ticker_events_date_idx"
  ON "ticker_events" (event_date DESC)

-- Statement 8
CREATE INDEX "ticker_events_type_date_idx"
  ON "ticker_events" (event_type, event_date DESC)

-- Statement 9
CREATE UNIQUE INDEX "ticker_events_dedup_uniq"
  ON "ticker_events" (ticker, event_type, event_date, (details->>'dedupKey'))
  WHERE details->>'dedupKey' IS NOT NULL

-- Statement 10
CREATE TABLE "ticker_sentiment_daily" (
  ticker TEXT NOT NULL,
  captured_at DATE NOT NULL,
  as_of TIMESTAMP NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'finnhub',
  news_count INT NOT NULL DEFAULT 0,
  bullish_pct NUMERIC(6,4), bearish_pct NUMERIC(6,4), neutral_pct NUMERIC(6,4),
  buzz_ratio NUMERIC(8,3),
  company_news_score NUMERIC(6,4), sector_avg_score NUMERIC(6,4),
  top_headlines JSONB,
  PRIMARY KEY (ticker, captured_at)
)

-- Statement 11
CREATE INDEX "ticker_sentiment_daily_date_idx"
  ON "ticker_sentiment_daily" (captured_at DESC)

-- Statement 12
-- NOTE: PostgreSQL does NOT allow expressions in PRIMARY KEY constraints.
-- Use the same pattern as alert_event_dedup_uniq: no PK, use UNIQUE INDEX
-- on the COALESCE expression instead (Statement 13 below).
CREATE TABLE "system_aggregate_daily" (
  captured_at DATE NOT NULL,
  metric_name TEXT NOT NULL,
  dimension TEXT,
  value_numeric NUMERIC(18,4),
  value_json JSONB,
  as_of TIMESTAMP NOT NULL DEFAULT NOW()
)

-- Statement 13 (unique index replaces the expression-PK from the original design)
CREATE UNIQUE INDEX "system_aggregate_daily_pk"
  ON "system_aggregate_daily" (captured_at, metric_name, COALESCE(dimension, ''))

-- Statement 14
CREATE INDEX "system_aggregate_daily_metric_idx"
  ON "system_aggregate_daily" (metric_name, captured_at DESC)
```

- [ ] **Step 3: Verify tables exist with expected column counts**

Run via Neon MCP:
```sql
SELECT table_name, count(*) AS cols
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'ticker_market_daily',
    'ticker_fundamentals',
    'ticker_events',
    'ticker_sentiment_daily',
    'system_aggregate_daily'
  )
GROUP BY table_name ORDER BY table_name;
```
Expected (row order: alphabetical):
- `system_aggregate_daily` — 6 cols
- `ticker_events` — 8 cols
- `ticker_fundamentals` — 30 cols
- `ticker_market_daily` — 34 cols
- `ticker_sentiment_daily` — 12 cols

- [ ] **Step 4: Verify privacy-boundary assertion (no userId columns)**

Run via Neon MCP:
```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'ticker_market_daily',
    'ticker_fundamentals',
    'ticker_events',
    'ticker_sentiment_daily',
    'system_aggregate_daily'
  )
  AND column_name ILIKE ANY(ARRAY['%user%', '%email%', '%session%', '%account%', '%ip_address%']);
```
Expected: empty result. If anything returns, **stop** — privacy boundary violated.

- [ ] **Step 5: Commit migration note**

```bash
cd /Volumes/Sang-Dev-SSD/invest
git commit --allow-empty -m "chore: warehouse tables migration (Neon, manual)

Provisioned 5 warehouse tables via Neon MCP:
  ticker_market_daily, ticker_fundamentals, ticker_events,
  ticker_sentiment_daily, system_aggregate_daily
No repo changes in this commit — migrations are hand-run per AGENTS.md.
Verified: no userId / email / ip_address columns anywhere.

Spec: docs/superpowers/specs/2026-04-16-ticker-data-warehouse-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: Typed row shapes + shared enums

**Files:**
- Create: `src/lib/warehouse/types.ts`

- [ ] **Step 1: Write the file**

Create `src/lib/warehouse/types.ts`:

```typescript
/**
 * Typed shapes for rows in the warehouse tables.
 * These are the ONLY shapes app code should see — never raw query rows.
 *
 * Nullable fields are typed as `number | null` (or `string | null`) because
 * upstream data is often partial (Yahoo doesn't return EPS for every ticker,
 * Finnhub isn't always configured, etc.). Readers must handle null.
 *
 * PRIVACY INVARIANT: None of these types contain a userId field. Adding one
 * would be an audit violation.
 */

export type WarehouseSource =
  | "yahoo"
  | "coingecko"
  | "sec"
  | "fred"
  | "finnhub"
  | "computed"
  | "multi";

export type TickerEventType =
  | "earnings"
  | "dividend_ex"
  | "dividend_pay"
  | "split"
  | "filing_8k"
  | "filing_10q"
  | "filing_10k"
  | "guidance"
  | "conference"
  | "other";

export type PeriodType = "quarterly" | "annual";

export type TickerMarketRow = {
  ticker: string;
  capturedAt: string; // ISO date
  asOf: string;
  source: WarehouseSource;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  changePct: number | null;
  ma50: number | null;
  ma200: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  vwap20d: number | null;
  high52w: number | null;
  low52w: number | null;
  beta: number | null;
  marketCap: number | null;
  peTrailing: number | null;
  peForward: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;
  dividendYield: number | null;
  epsTtm: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  relStrengthSpy30d: number | null;
  analystTargetMean: number | null;
  analystCount: number | null;
  analystRating: string | null;
  shortInterestPct: number | null;
};

export type TickerFundamentalsRow = {
  ticker: string;
  periodEnding: string; // ISO date
  periodType: PeriodType;
  filingAccession: string | null;
  reportedAt: string | null;
  asOf: string;
  source: WarehouseSource;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  ebitda: number | null;
  epsBasic: number | null;
  epsDiluted: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  sharesOutstanding: number | null;
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
  capex: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  roa: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
};

export type TickerEventRow = {
  id: string;
  ticker: string;
  eventType: TickerEventType;
  eventDate: string; // ISO date
  eventTime: string | null; // ISO timestamp
  details: Record<string, unknown>;
  source: WarehouseSource;
  asOf: string;
};

export type TickerSentimentRow = {
  ticker: string;
  capturedAt: string; // ISO date
  asOf: string;
  source: WarehouseSource;
  newsCount: number;
  bullishPct: number | null;
  bearishPct: number | null;
  neutralPct: number | null;
  buzzRatio: number | null;
  companyNewsScore: number | null;
  sectorAvgScore: number | null;
  topHeadlines:
    | Array<{
        title: string;
        url: string | null;
        source: string | null;
        publishedAt: string | null;
      }>
    | null;
};

export type SystemAggregateRow = {
  capturedAt: string; // ISO date
  metricName: string;
  dimension: string | null;
  valueNumeric: number | null;
  valueJson: unknown;
  asOf: string;
};
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/warehouse/types.ts
git commit -m "Warehouse: typed row shapes for the 5 tables

Declares the canonical types for ticker_market_daily, ticker_fundamentals,
ticker_events, ticker_sentiment_daily, system_aggregate_daily. These
shapes are what readers in src/lib/warehouse/*.ts return to app code —
raw rows never leak out.

Privacy invariant: none of these types include userId fields.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: Universe helper (the privacy boundary)

**Files:**
- Create: `src/lib/warehouse/universe.ts`

- [ ] **Step 1: Write the file**

Create `src/lib/warehouse/universe.ts`:

```typescript
import { pool } from "../db";
import { log, errorInfo } from "../log";

/**
 * THE PRIVACY BOUNDARY.
 *
 * This is the ONE place in the entire codebase that reads `holding.ticker`
 * for the warehouse refresh. It returns a deduplicated string[] — never an
 * object, never a userId, never a map.
 *
 * Callers: the nightly cron's refreshWarehouse() only.
 * Do NOT call this from request handlers.
 *
 * If a PR adds a caller in an app route, it is a privacy violation.
 */
export async function getTickerUniverse(): Promise<string[]> {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ticker FROM "holding" WHERE ticker IS NOT NULL`
    );
    return rows.map((r: Record<string, unknown>) => r.ticker as string);
  } catch (err) {
    log.warn("warehouse.universe", "getTickerUniverse failed", errorInfo(err));
    return [];
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Write a smoke test (inline, one-shot verification)**

Create a temporary file `test-universe.mjs` at the repo root:

```javascript
import { getTickerUniverse } from "./src/lib/warehouse/universe.ts";
const tickers = await getTickerUniverse();
console.log("tickers type:", Array.isArray(tickers) ? "array" : typeof tickers);
console.log("tickers count:", tickers.length);
console.log("first 5:", tickers.slice(0, 5));
console.log("has userId/email/etc:", tickers.some(t => typeof t !== "string"));
```

This is NOT committed — it's a one-off sanity check.

- [ ] **Step 4: Skip running the one-off (TS file, would need ts-node). Instead verify in prod after deploy.**

The `.ts` import won't run under plain node. Delete the temp file:
```bash
rm -f test-universe.mjs
```

Verification happens once Phase 2 deploys and the cron calls `getTickerUniverse()` — we'll check Neon then.

- [ ] **Step 5: Commit**

```bash
git add src/lib/warehouse/universe.ts
git commit -m "Warehouse: getTickerUniverse — the single privacy-boundary reader

Returns string[] — a flat, deduped list of tickers. Never an object,
never a userId. This is the ONLY code path in the repo that reads
holding.ticker for warehouse purposes. Callable only from the nightly
refresh orchestrator (enforced by code review, not type system).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.4: Market reader (getTickerMarket, getTickerMarketBatch)

**Files:**
- Create: `src/lib/warehouse/market.ts`

- [ ] **Step 1: Write the file**

Create `src/lib/warehouse/market.ts`:

```typescript
import { pool } from "../db";
import { log, errorInfo } from "../log";
import type { TickerMarketRow, WarehouseSource } from "./types";

/**
 * Read the most-recent daily row for a ticker.
 * Returns null if we've never captured it — caller should decide whether
 * to trigger warmTickerMarket or fall back to live Yahoo.
 */
export async function getTickerMarket(
  ticker: string
): Promise<TickerMarketRow | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM "ticker_market_daily"
       WHERE ticker = $1
       ORDER BY captured_at DESC
       LIMIT 1`,
      [ticker.toUpperCase()]
    );
    if (rows.length === 0) return null;
    return mapRow(rows[0] as Record<string, unknown>);
  } catch (err) {
    log.warn("warehouse.market", "getTickerMarket failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

/**
 * Batch read — used by portfolio review + dashboard.
 * Returns a Map keyed by ticker (uppercase). Tickers with no row are absent.
 */
export async function getTickerMarketBatch(
  tickers: string[]
): Promise<Map<string, TickerMarketRow>> {
  const out = new Map<string, TickerMarketRow>();
  if (tickers.length === 0) return out;
  const upper = tickers.map((t) => t.toUpperCase());
  try {
    // For each ticker, grab only its latest row using DISTINCT ON.
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (ticker) *
       FROM "ticker_market_daily"
       WHERE ticker = ANY($1)
       ORDER BY ticker, captured_at DESC`,
      [upper]
    );
    for (const r of rows) {
      const row = mapRow(r as Record<string, unknown>);
      out.set(row.ticker, row);
    }
  } catch (err) {
    log.warn("warehouse.market", "getTickerMarketBatch failed", {
      count: tickers.length,
      ...errorInfo(err),
    });
  }
  return out;
}

/**
 * Convert a raw row into the typed shape. Snake_case → camelCase.
 * Numeric columns come back as strings from pg when NUMERIC — coerce.
 */
function mapRow(r: Record<string, unknown>): TickerMarketRow {
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : null;
  const iso = (v: unknown): string =>
    v instanceof Date ? v.toISOString() : String(v);

  return {
    ticker: String(r.ticker),
    capturedAt:
      r.captured_at instanceof Date
        ? r.captured_at.toISOString().slice(0, 10)
        : String(r.captured_at).slice(0, 10),
    asOf: iso(r.as_of),
    source: (String(r.source) as WarehouseSource) ?? "yahoo",
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    close: num(r.close),
    volume: r.volume === null ? null : Number(r.volume),
    changePct: num(r.change_pct),
    ma50: num(r.ma_50),
    ma200: num(r.ma_200),
    bollingerUpper: num(r.bollinger_upper),
    bollingerLower: num(r.bollinger_lower),
    vwap20d: num(r.vwap_20d),
    high52w: num(r.high_52w),
    low52w: num(r.low_52w),
    beta: num(r.beta),
    marketCap: r.market_cap === null ? null : Number(r.market_cap),
    peTrailing: num(r.pe_trailing),
    peForward: num(r.pe_forward),
    priceToBook: num(r.price_to_book),
    priceToSales: num(r.price_to_sales),
    evToEbitda: num(r.ev_to_ebitda),
    dividendYield: num(r.dividend_yield),
    epsTtm: num(r.eps_ttm),
    rsi14: num(r.rsi_14),
    macd: num(r.macd),
    macdSignal: num(r.macd_signal),
    relStrengthSpy30d: num(r.rel_strength_spy_30d),
    analystTargetMean: num(r.analyst_target_mean),
    analystCount: r.analyst_count === null ? null : Number(r.analyst_count),
    analystRating: str(r.analyst_rating),
    shortInterestPct: num(r.short_interest_pct),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/warehouse/market.ts
git commit -m "Warehouse: getTickerMarket + getTickerMarketBatch readers

Typed readers for ticker_market_daily. Single-ticker fetch uses
ORDER BY captured_at DESC LIMIT 1; batch uses DISTINCT ON (ticker) for
a single round-trip. Both return typed TickerMarketRow with
snake_case → camelCase normalization and numeric coercion.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.5: Fundamentals + events + sentiment + aggregate readers

**Files:**
- Create: `src/lib/warehouse/fundamentals.ts`
- Create: `src/lib/warehouse/events.ts`
- Create: `src/lib/warehouse/sentiment.ts`
- Create: `src/lib/warehouse/aggregate.ts`

- [ ] **Step 1: Write `src/lib/warehouse/fundamentals.ts`**

```typescript
import { pool } from "../db";
import { log, errorInfo } from "../log";
import type {
  TickerFundamentalsRow,
  PeriodType,
  WarehouseSource,
} from "./types";

export async function getTickerFundamentals(
  ticker: string,
  opts?: { periodType?: PeriodType }
): Promise<TickerFundamentalsRow | null> {
  const pt = opts?.periodType ?? "quarterly";
  try {
    const { rows } = await pool.query(
      `SELECT * FROM "ticker_fundamentals"
       WHERE ticker = $1 AND period_type = $2
       ORDER BY period_ending DESC
       LIMIT 1`,
      [ticker.toUpperCase(), pt]
    );
    if (rows.length === 0) return null;
    return mapRow(rows[0] as Record<string, unknown>);
  } catch (err) {
    log.warn("warehouse.fundamentals", "getTickerFundamentals failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

function mapRow(r: Record<string, unknown>): TickerFundamentalsRow {
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  const big = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : null;
  const iso = (v: unknown): string =>
    v instanceof Date ? v.toISOString() : String(v);
  const dateOnly = (v: unknown): string =>
    v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

  return {
    ticker: String(r.ticker),
    periodEnding: dateOnly(r.period_ending),
    periodType: String(r.period_type) as PeriodType,
    filingAccession: str(r.filing_accession),
    reportedAt:
      r.reported_at === null || r.reported_at === undefined
        ? null
        : dateOnly(r.reported_at),
    asOf: iso(r.as_of),
    source: (String(r.source) as WarehouseSource) ?? "yahoo",
    revenue: big(r.revenue),
    grossProfit: big(r.gross_profit),
    operatingIncome: big(r.operating_income),
    netIncome: big(r.net_income),
    ebitda: big(r.ebitda),
    epsBasic: num(r.eps_basic),
    epsDiluted: num(r.eps_diluted),
    totalAssets: big(r.total_assets),
    totalLiabilities: big(r.total_liabilities),
    totalEquity: big(r.total_equity),
    totalDebt: big(r.total_debt),
    totalCash: big(r.total_cash),
    sharesOutstanding: big(r.shares_outstanding),
    operatingCashFlow: big(r.operating_cash_flow),
    freeCashFlow: big(r.free_cash_flow),
    capex: big(r.capex),
    grossMargin: num(r.gross_margin),
    operatingMargin: num(r.operating_margin),
    netMargin: num(r.net_margin),
    roe: num(r.roe),
    roa: num(r.roa),
    currentRatio: num(r.current_ratio),
    debtToEquity: num(r.debt_to_equity),
  };
}
```

- [ ] **Step 2: Write `src/lib/warehouse/events.ts`**

```typescript
import { pool } from "../db";
import { log, errorInfo } from "../log";
import type {
  TickerEventRow,
  TickerEventType,
  WarehouseSource,
} from "./types";

export async function getUpcomingEvents(
  ticker: string,
  opts?: { windowDays?: number; types?: TickerEventType[] }
): Promise<TickerEventRow[]> {
  const window = opts?.windowDays ?? 90;
  return queryEvents(ticker, {
    fromDate: new Date(),
    throughDate: new Date(Date.now() + window * 86400000),
    types: opts?.types,
    sortAsc: true,
  });
}

export async function getRecentEvents(
  ticker: string,
  opts?: { windowDays?: number; types?: TickerEventType[] }
): Promise<TickerEventRow[]> {
  const window = opts?.windowDays ?? 180;
  return queryEvents(ticker, {
    fromDate: new Date(Date.now() - window * 86400000),
    throughDate: new Date(),
    types: opts?.types,
    sortAsc: false,
  });
}

async function queryEvents(
  ticker: string,
  opts: {
    fromDate: Date;
    throughDate: Date;
    types?: TickerEventType[];
    sortAsc: boolean;
  }
): Promise<TickerEventRow[]> {
  try {
    const typeFilter = opts.types && opts.types.length > 0 ? opts.types : null;
    const { rows } = await pool.query(
      `SELECT * FROM "ticker_events"
       WHERE ticker = $1
         AND event_date >= $2::date
         AND event_date <= $3::date
         AND ($4::text[] IS NULL OR event_type = ANY($4))
       ORDER BY event_date ${opts.sortAsc ? "ASC" : "DESC"}
       LIMIT 50`,
      [
        ticker.toUpperCase(),
        opts.fromDate.toISOString().slice(0, 10),
        opts.throughDate.toISOString().slice(0, 10),
        typeFilter,
      ]
    );
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  } catch (err) {
    log.warn("warehouse.events", "queryEvents failed", {
      ticker,
      ...errorInfo(err),
    });
    return [];
  }
}

function mapRow(r: Record<string, unknown>): TickerEventRow {
  const iso = (v: unknown): string =>
    v instanceof Date ? v.toISOString() : String(v);
  const dateOnly = (v: unknown): string =>
    v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
  const details = (v: unknown): Record<string, unknown> => {
    if (v && typeof v === "object") return v as Record<string, unknown>;
    return {};
  };
  return {
    id: String(r.id),
    ticker: String(r.ticker),
    eventType: String(r.event_type) as TickerEventType,
    eventDate: dateOnly(r.event_date),
    eventTime:
      r.event_time === null || r.event_time === undefined
        ? null
        : iso(r.event_time),
    details: details(r.details),
    source: (String(r.source) as WarehouseSource) ?? "yahoo",
    asOf: iso(r.as_of),
  };
}
```

- [ ] **Step 3: Write `src/lib/warehouse/sentiment.ts`**

```typescript
import { pool } from "../db";
import { log, errorInfo } from "../log";
import type { TickerSentimentRow, WarehouseSource } from "./types";

export async function getTickerSentiment(
  ticker: string
): Promise<TickerSentimentRow | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM "ticker_sentiment_daily"
       WHERE ticker = $1
       ORDER BY captured_at DESC
       LIMIT 1`,
      [ticker.toUpperCase()]
    );
    if (rows.length === 0) return null;
    return mapRow(rows[0] as Record<string, unknown>);
  } catch (err) {
    log.warn("warehouse.sentiment", "getTickerSentiment failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

function mapRow(r: Record<string, unknown>): TickerSentimentRow {
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  const iso = (v: unknown): string =>
    v instanceof Date ? v.toISOString() : String(v);
  const dateOnly = (v: unknown): string =>
    v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

  let headlines: TickerSentimentRow["topHeadlines"] = null;
  if (Array.isArray(r.top_headlines)) {
    headlines = (r.top_headlines as unknown[])
      .filter((h): h is Record<string, unknown> => h !== null && typeof h === "object")
      .map((h) => ({
        title: String(h.title ?? ""),
        url: h.url ? String(h.url) : null,
        source: h.source ? String(h.source) : null,
        publishedAt: h.publishedAt ? String(h.publishedAt) : null,
      }));
  }

  return {
    ticker: String(r.ticker),
    capturedAt: dateOnly(r.captured_at),
    asOf: iso(r.as_of),
    source: (String(r.source) as WarehouseSource) ?? "finnhub",
    newsCount: Number(r.news_count ?? 0),
    bullishPct: num(r.bullish_pct),
    bearishPct: num(r.bearish_pct),
    neutralPct: num(r.neutral_pct),
    buzzRatio: num(r.buzz_ratio),
    companyNewsScore: num(r.company_news_score),
    sectorAvgScore: num(r.sector_avg_score),
    topHeadlines: headlines,
  };
}
```

- [ ] **Step 4: Write `src/lib/warehouse/aggregate.ts`**

```typescript
import { pool } from "../db";
import { log, errorInfo } from "../log";
import type { SystemAggregateRow } from "./types";

/**
 * Upsert a single system-aggregate metric for today.
 * Idempotent — same (date, metric_name, dimension) overwrites.
 */
export async function upsertSystemMetric(input: {
  metricName: string;
  dimension?: string | null;
  valueNumeric?: number | null;
  valueJson?: unknown;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO "system_aggregate_daily"
         (captured_at, metric_name, dimension, value_numeric, value_json)
       VALUES (CURRENT_DATE, $1, $2, $3, $4::jsonb)
       ON CONFLICT (captured_at, metric_name, COALESCE(dimension, ''))
       DO UPDATE SET
         value_numeric = EXCLUDED.value_numeric,
         value_json = EXCLUDED.value_json,
         as_of = NOW()`,
      [
        input.metricName,
        input.dimension ?? null,
        input.valueNumeric ?? null,
        input.valueJson !== undefined ? JSON.stringify(input.valueJson) : null,
      ]
    );
  } catch (err) {
    log.warn("warehouse.aggregate", "upsertSystemMetric failed", {
      metric: input.metricName,
      ...errorInfo(err),
    });
  }
}

/**
 * Read recent rows for a metric. Used by the admin metrics endpoint.
 */
export async function getMetricHistory(
  metricName: string,
  opts?: { days?: number; dimension?: string | null }
): Promise<SystemAggregateRow[]> {
  const days = opts?.days ?? 30;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM "system_aggregate_daily"
       WHERE metric_name = $1
         AND captured_at > CURRENT_DATE - ($2 || ' days')::interval
         AND ($3::text IS NULL OR dimension = $3)
       ORDER BY captured_at ASC, dimension ASC NULLS FIRST`,
      [metricName, String(days), opts?.dimension ?? null]
    );
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  } catch (err) {
    log.warn("warehouse.aggregate", "getMetricHistory failed", {
      metric: metricName,
      ...errorInfo(err),
    });
    return [];
  }
}

function mapRow(r: Record<string, unknown>): SystemAggregateRow {
  const iso = (v: unknown): string =>
    v instanceof Date ? v.toISOString() : String(v);
  const dateOnly = (v: unknown): string =>
    v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
  return {
    capturedAt: dateOnly(r.captured_at),
    metricName: String(r.metric_name),
    dimension: r.dimension === null ? null : String(r.dimension),
    valueNumeric:
      r.value_numeric === null || r.value_numeric === undefined
        ? null
        : Number(r.value_numeric),
    valueJson: r.value_json,
    asOf: iso(r.as_of),
  };
}
```

- [ ] **Step 5: Create the re-export barrel `src/lib/warehouse/index.ts`**

```typescript
export * from "./types";
export { getTickerMarket, getTickerMarketBatch } from "./market";
export { getTickerFundamentals } from "./fundamentals";
export { getUpcomingEvents, getRecentEvents } from "./events";
export { getTickerSentiment } from "./sentiment";
export { upsertSystemMetric, getMetricHistory } from "./aggregate";
```

- [ ] **Step 6: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/warehouse/
git commit -m "Warehouse: readers for fundamentals/events/sentiment/aggregate + index barrel

Typed readers for the remaining 4 tables (ticker_fundamentals, ticker_events,
ticker_sentiment_daily, system_aggregate_daily) plus src/lib/warehouse/index.ts
barrel so callers import from '@/lib/warehouse' and never touch individual
files directly.

upsertSystemMetric is the one write helper exposed; all other reader
functions are SELECT-only.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase 1 Acceptance

- [ ] **Acceptance: typecheck + build pass, no behavior change on prod**

Run:
```bash
./node_modules/.bin/tsc --noEmit
npm run build
```
Both must succeed with no new errors.

Then deploy:
```bash
vercel --prod --scope mentisvision --yes
```

Smoke test:
```bash
curl -s https://clearpath-invest.vercel.app/ -o /dev/null -w "%{http_code}\n"
# Expected: 200
```

Neon verification (run via MCP):
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'ticker_%' OR table_name = 'system_aggregate_daily'
ORDER BY table_name;
```
Expected: 5 warehouse tables listed plus `ticker_metadata` (existing reference).

---

## Phase 2 — Cron populates warehouse (write-only validation)

Goal: Cron writes to all 5 warehouse tables. No readers wired yet. Data quality validated in Neon.

Acceptance test: Manual cron run reports `warehouse: { market: N, fundamentals: N, events: N, sentiment: N, aggregates: N }` counts > 0 for held tickers.

---

### Task 2.1: Install technical-indicators dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Check current tsc works (baseline)**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Install `technicalindicators` npm package**

```bash
npm install technicalindicators
```
Expected: package appears in `package.json` dependencies. No peer dep warnings.

- [ ] **Step 3: Verify import works**

Create temp `test-ti.ts` at repo root:
```typescript
import { RSI, MACD, BollingerBands } from "technicalindicators";
console.log("RSI:", typeof RSI);
console.log("MACD:", typeof MACD);
console.log("BollingerBands:", typeof BollingerBands);
```

Run: `./node_modules/.bin/tsc --noEmit test-ti.ts`
Expected: no errors.

Delete temp: `rm test-ti.ts`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add technicalindicators (RSI / MACD / Bollinger)

Used by src/lib/warehouse/indicators.ts to compute technical signals
on the nightly cron from Yahoo OHLC history. Client-side compute
avoids paying for another data source just for indicators.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.2: Indicator compute module

**Files:**
- Create: `src/lib/warehouse/indicators.ts`

- [ ] **Step 1: Write `src/lib/warehouse/indicators.ts`**

```typescript
import { RSI, MACD, BollingerBands } from "technicalindicators";

/**
 * Pure computation of technical indicators from OHLC close series.
 * All inputs: array of numbers, oldest first, newest last.
 * All outputs: the latest single value (null if insufficient history).
 *
 * Used by the nightly warehouse refresh to compute signals without an
 * external data call.
 */

/** 14-day RSI — null if closes.length < 15. */
export function computeRsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const series = RSI.calculate({ values: closes, period: 14 });
  const last = series[series.length - 1];
  return typeof last === "number" && Number.isFinite(last) ? last : null;
}

/** MACD and signal line (12/26/9). Null if closes.length < 35. */
export function computeMacd(closes: number[]): {
  macd: number | null;
  signal: number | null;
} {
  if (closes.length < 35) return { macd: null, signal: null };
  const series = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const last = series[series.length - 1];
  if (!last) return { macd: null, signal: null };
  return {
    macd: typeof last.MACD === "number" && Number.isFinite(last.MACD) ? last.MACD : null,
    signal:
      typeof last.signal === "number" && Number.isFinite(last.signal)
        ? last.signal
        : null,
  };
}

/** Bollinger Bands (20 SMA, 2 stdev). Null if closes.length < 20. */
export function computeBollinger(closes: number[]): {
  upper: number | null;
  lower: number | null;
} {
  if (closes.length < 20) return { upper: null, lower: null };
  const series = BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2,
  });
  const last = series[series.length - 1];
  if (!last) return { upper: null, lower: null };
  return {
    upper:
      typeof last.upper === "number" && Number.isFinite(last.upper)
        ? last.upper
        : null,
    lower:
      typeof last.lower === "number" && Number.isFinite(last.lower)
        ? last.lower
        : null,
  };
}

/** Simple moving average of the last N values. */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * 20-day VWAP — requires close + volume arrays of equal length.
 * Returns null if insufficient data.
 */
export function vwap20d(closes: number[], volumes: number[]): number | null {
  if (closes.length !== volumes.length) return null;
  if (closes.length < 20) return null;
  const closeSlice = closes.slice(-20);
  const volSlice = volumes.slice(-20);
  let num = 0;
  let denom = 0;
  for (let i = 0; i < 20; i++) {
    num += closeSlice[i] * volSlice[i];
    denom += volSlice[i];
  }
  return denom > 0 ? num / denom : null;
}

/**
 * Relative strength over N days: (ticker_return - spy_return) in percentage points.
 * Inputs: aligned arrays of closes (oldest → newest). Null if either too short.
 */
export function relStrength(
  tickerCloses: number[],
  spyCloses: number[],
  days: number
): number | null {
  const tRet = periodReturn(tickerCloses, days);
  const sRet = periodReturn(spyCloses, days);
  if (tRet === null || sRet === null) return null;
  return (tRet - sRet) * 100;
}

function periodReturn(closes: number[], days: number): number | null {
  if (closes.length <= days) return null;
  const last = closes[closes.length - 1];
  const prior = closes[closes.length - 1 - days];
  if (!prior || prior <= 0) return null;
  return last / prior - 1;
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/warehouse/indicators.ts
git commit -m "Warehouse: indicator compute module (RSI, MACD, Bollinger, VWAP, rel-strength)

Pure functions taking close/volume arrays → latest indicator values.
All return null when history is insufficient. Used by the nightly
market refresh to populate technicals columns without calling an
external indicator service.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.3: Market refresh (yahoo → ticker_market_daily)

**Files:**
- Create: `src/lib/warehouse/refresh/market.ts`

- [ ] **Step 1: Write `src/lib/warehouse/refresh/market.ts`**

```typescript
import { default as YahooFinanceCtor } from "yahoo-finance2";
import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  computeRsi14,
  computeMacd,
  computeBollinger,
  sma,
  vwap20d,
  relStrength,
} from "../indicators";

/**
 * Refresh ticker_market_daily for a list of tickers.
 * Per ticker: one quote() + one chart() call (250d history for indicators).
 * Writes one row per ticker per call, keyed (ticker, captured_at).
 *
 * SPY is fetched once up-front to compute relative-strength vs SPY.
 */

const yahoo = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

export type MarketRefreshResult = {
  attempted: number;
  written: number;
  skipped: number;
  failed: Array<{ ticker: string; error: string }>;
};

export async function refreshMarket(
  tickers: string[]
): Promise<MarketRefreshResult> {
  const attempted = tickers.length;
  let written = 0;
  let skipped = 0;
  const failed: MarketRefreshResult["failed"] = [];

  // Get SPY history once for relative-strength computation.
  const spyCloses = await fetchCloseHistory("SPY", 60).catch(() => null);

  // Concurrency cap so we don't slam Yahoo.
  let cursor = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const ticker = tickers[idx].toUpperCase();
      try {
        const row = await buildMarketRow(ticker, spyCloses);
        if (!row) {
          skipped++;
          continue;
        }
        await writeRow(row);
        written++;
      } catch (err) {
        failed.push({
          ticker,
          error: err instanceof Error ? err.message : "unknown",
        });
        log.warn("warehouse.refresh.market", "ticker failed", {
          ticker,
          ...errorInfo(err),
        });
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(4, tickers.length) },
    () => worker()
  );
  await Promise.all(workers);

  return { attempted, written, skipped, failed };
}

type MarketWriteRow = {
  ticker: string;
  source: "yahoo";
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  change_pct: number | null;
  ma_50: number | null;
  ma_200: number | null;
  bollinger_upper: number | null;
  bollinger_lower: number | null;
  vwap_20d: number | null;
  high_52w: number | null;
  low_52w: number | null;
  beta: number | null;
  market_cap: number | null;
  pe_trailing: number | null;
  pe_forward: number | null;
  price_to_book: number | null;
  price_to_sales: number | null;
  ev_to_ebitda: number | null;
  dividend_yield: number | null;
  eps_ttm: number | null;
  rsi_14: number | null;
  macd: number | null;
  macd_signal: number | null;
  rel_strength_spy_30d: number | null;
  analyst_target_mean: number | null;
  analyst_count: number | null;
  analyst_rating: string | null;
};

async function buildMarketRow(
  ticker: string,
  spyCloses: number[] | null
): Promise<MarketWriteRow | null> {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : null;

  // Live quote for headline fields
  const q = (await yahoo.quote(ticker)) as Record<string, unknown>;
  const close = num(q.regularMarketPrice);
  if (close === null || close <= 0) return null; // Yahoo didn't recognize it

  // Summary for valuation / analyst
  let summary: Record<string, unknown> | null = null;
  try {
    const s = await yahoo.quoteSummary(ticker, {
      modules: ["summaryDetail", "financialData", "defaultKeyStatistics"],
    });
    summary = s as unknown as Record<string, unknown>;
  } catch {
    summary = null;
  }

  const summaryDetail = summary?.summaryDetail as Record<string, unknown> | undefined;
  const financialData = summary?.financialData as
    | Record<string, unknown>
    | undefined;
  const keyStats = summary?.defaultKeyStatistics as
    | Record<string, unknown>
    | undefined;

  // 250d close/volume history for technicals
  const closes: number[] = [];
  const volumes: number[] = [];
  try {
    const hist = (await yahoo.chart(ticker, {
      period1: new Date(Date.now() - 250 * 86400000),
      interval: "1d",
    })) as unknown as {
      quotes?: Array<{ close?: number | null; volume?: number | null }>;
    };
    for (const b of hist.quotes ?? []) {
      if (typeof b.close === "number" && Number.isFinite(b.close)) {
        closes.push(b.close);
        volumes.push(typeof b.volume === "number" ? b.volume : 0);
      }
    }
  } catch {
    /* indicators will stay null — not a fatal error */
  }

  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const rsi = computeRsi14(closes);
  const macdVals = computeMacd(closes);
  const bb = computeBollinger(closes);
  const vwap = vwap20d(closes, volumes);
  const relStrength30d =
    spyCloses && closes.length > 0
      ? relStrength(closes, spyCloses, 30)
      : null;

  return {
    ticker,
    source: "yahoo",
    open: num(q.regularMarketOpen),
    high: num(q.regularMarketDayHigh),
    low: num(q.regularMarketDayLow),
    close,
    volume: num(q.regularMarketVolume),
    change_pct: num(q.regularMarketChangePercent),
    ma_50: ma50,
    ma_200: ma200,
    bollinger_upper: bb.upper,
    bollinger_lower: bb.lower,
    vwap_20d: vwap,
    high_52w: num(q.fiftyTwoWeekHigh),
    low_52w: num(q.fiftyTwoWeekLow),
    beta: num(summaryDetail?.beta),
    market_cap: num(q.marketCap),
    pe_trailing: num(q.trailingPE),
    pe_forward: num(q.forwardPE),
    price_to_book: num(keyStats?.priceToBook),
    price_to_sales: num(summaryDetail?.priceToSalesTrailing12Months),
    ev_to_ebitda: num(keyStats?.enterpriseToEbitda),
    dividend_yield: num(q.trailingAnnualDividendYield),
    eps_ttm: num(q.epsTrailingTwelveMonths),
    rsi_14: rsi,
    macd: macdVals.macd,
    macd_signal: macdVals.signal,
    rel_strength_spy_30d: relStrength30d,
    analyst_target_mean: num(financialData?.targetMeanPrice),
    analyst_count: num(financialData?.numberOfAnalystOpinions),
    analyst_rating: str(financialData?.recommendationKey),
  };
}

async function fetchCloseHistory(
  ticker: string,
  days: number
): Promise<number[]> {
  const hist = (await yahoo.chart(ticker, {
    period1: new Date(Date.now() - days * 86400000),
    interval: "1d",
  })) as unknown as {
    quotes?: Array<{ close?: number | null }>;
  };
  return (hist.quotes ?? [])
    .map((b) => b.close)
    .filter(
      (c): c is number => typeof c === "number" && Number.isFinite(c)
    );
}

async function writeRow(r: MarketWriteRow): Promise<void> {
  await pool.query(
    `INSERT INTO "ticker_market_daily"
      (ticker, captured_at, source,
       open, high, low, close, volume, change_pct,
       ma_50, ma_200, bollinger_upper, bollinger_lower, vwap_20d,
       high_52w, low_52w, beta, market_cap,
       pe_trailing, pe_forward, price_to_book, price_to_sales,
       ev_to_ebitda, dividend_yield, eps_ttm,
       rsi_14, macd, macd_signal, rel_strength_spy_30d,
       analyst_target_mean, analyst_count, analyst_rating)
     VALUES (
       $1, CURRENT_DATE, $2,
       $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13,
       $14, $15, $16, $17,
       $18, $19, $20, $21,
       $22, $23, $24,
       $25, $26, $27, $28,
       $29, $30, $31
     )
     ON CONFLICT (ticker, captured_at) DO UPDATE SET
       open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
       close = EXCLUDED.close, volume = EXCLUDED.volume,
       change_pct = EXCLUDED.change_pct,
       ma_50 = EXCLUDED.ma_50, ma_200 = EXCLUDED.ma_200,
       bollinger_upper = EXCLUDED.bollinger_upper,
       bollinger_lower = EXCLUDED.bollinger_lower,
       vwap_20d = EXCLUDED.vwap_20d,
       high_52w = EXCLUDED.high_52w, low_52w = EXCLUDED.low_52w,
       beta = EXCLUDED.beta, market_cap = EXCLUDED.market_cap,
       pe_trailing = EXCLUDED.pe_trailing, pe_forward = EXCLUDED.pe_forward,
       price_to_book = EXCLUDED.price_to_book,
       price_to_sales = EXCLUDED.price_to_sales,
       ev_to_ebitda = EXCLUDED.ev_to_ebitda,
       dividend_yield = EXCLUDED.dividend_yield, eps_ttm = EXCLUDED.eps_ttm,
       rsi_14 = EXCLUDED.rsi_14, macd = EXCLUDED.macd,
       macd_signal = EXCLUDED.macd_signal,
       rel_strength_spy_30d = EXCLUDED.rel_strength_spy_30d,
       analyst_target_mean = EXCLUDED.analyst_target_mean,
       analyst_count = EXCLUDED.analyst_count,
       analyst_rating = EXCLUDED.analyst_rating,
       as_of = NOW()`,
    [
      r.ticker,
      r.source,
      r.open, r.high, r.low, r.close, r.volume, r.change_pct,
      r.ma_50, r.ma_200, r.bollinger_upper, r.bollinger_lower, r.vwap_20d,
      r.high_52w, r.low_52w, r.beta, r.market_cap,
      r.pe_trailing, r.pe_forward, r.price_to_book, r.price_to_sales,
      r.ev_to_ebitda, r.dividend_yield, r.eps_ttm,
      r.rsi_14, r.macd, r.macd_signal, r.rel_strength_spy_30d,
      r.analyst_target_mean, r.analyst_count, r.analyst_rating,
    ]
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/warehouse/refresh/market.ts
git commit -m "Warehouse: refreshMarket(tickers) — populates ticker_market_daily

Per ticker: one quote() + one quoteSummary() + one chart(250d) call.
Technicals (RSI/MACD/Bollinger/VWAP) computed locally from OHLC history.
SPY history fetched once upfront for relative-strength vs SPY.
Concurrency capped at 4 to be polite to Yahoo.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.4: Fundamentals refresh

**Files:**
- Create: `src/lib/warehouse/refresh/fundamentals.ts`

- [ ] **Step 1: Write `src/lib/warehouse/refresh/fundamentals.ts`**

```typescript
import { default as YahooFinanceCtor } from "yahoo-finance2";
import { pool } from "../../db";
import { log, errorInfo } from "../../log";

const yahoo = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

export type FundamentalsRefreshResult = {
  attempted: number;
  written: number;
  skipped: number;
  failed: Array<{ ticker: string; error: string }>;
};

/**
 * For each ticker, fetch Yahoo quoteSummary's incomeStatementHistory +
 * balanceSheetHistory + cashflowStatementHistory and write the most
 * recent quarterly AND most recent annual period. Idempotent:
 * PRIMARY KEY (ticker, period_ending, period_type).
 */
export async function refreshFundamentals(
  tickers: string[]
): Promise<FundamentalsRefreshResult> {
  const attempted = tickers.length;
  let written = 0;
  let skipped = 0;
  const failed: FundamentalsRefreshResult["failed"] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const ticker = tickers[idx].toUpperCase();
      try {
        const added = await refreshOne(ticker);
        written += added;
        if (added === 0) skipped++;
      } catch (err) {
        failed.push({
          ticker,
          error: err instanceof Error ? err.message : "unknown",
        });
        log.warn("warehouse.refresh.fundamentals", "ticker failed", {
          ticker,
          ...errorInfo(err),
        });
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(3, tickers.length) },
    () => worker()
  );
  await Promise.all(workers);

  return { attempted, written, skipped, failed };
}

async function refreshOne(ticker: string): Promise<number> {
  const s = (await yahoo.quoteSummary(ticker, {
    modules: [
      "incomeStatementHistoryQuarterly",
      "incomeStatementHistory",
      "balanceSheetHistoryQuarterly",
      "balanceSheetHistory",
      "cashflowStatementHistoryQuarterly",
      "cashflowStatementHistory",
      "financialData",
      "defaultKeyStatistics",
    ],
  })) as unknown as Record<string, unknown>;

  let written = 0;
  const quarterly = pickLatest(s, "quarterly");
  const annual = pickLatest(s, "annual");
  if (quarterly) {
    await writeFundamentalsRow(ticker, "quarterly", quarterly);
    written++;
  }
  if (annual) {
    await writeFundamentalsRow(ticker, "annual", annual);
    written++;
  }
  return written;
}

type FundamentalsSnapshot = {
  periodEnding: string;
  income: Record<string, unknown>;
  balance: Record<string, unknown>;
  cash: Record<string, unknown>;
  financialData: Record<string, unknown>;
  keyStats: Record<string, unknown>;
};

function pickLatest(
  s: Record<string, unknown>,
  period: "quarterly" | "annual"
): FundamentalsSnapshot | null {
  const incomeKey =
    period === "quarterly"
      ? "incomeStatementHistoryQuarterly"
      : "incomeStatementHistory";
  const balanceKey =
    period === "quarterly"
      ? "balanceSheetHistoryQuarterly"
      : "balanceSheetHistory";
  const cashKey =
    period === "quarterly"
      ? "cashflowStatementHistoryQuarterly"
      : "cashflowStatementHistory";

  const incomeList =
    ((s[incomeKey] as Record<string, unknown>)?.incomeStatementHistory as
      | Array<Record<string, unknown>>
      | undefined) ?? [];
  const balanceList =
    ((s[balanceKey] as Record<string, unknown>)
      ?.balanceSheetStatements as Array<Record<string, unknown>> | undefined) ??
    [];
  const cashList =
    ((s[cashKey] as Record<string, unknown>)?.cashflowStatements as
      | Array<Record<string, unknown>>
      | undefined) ?? [];

  if (!incomeList.length) return null;
  const income = incomeList[0];
  const balance = balanceList[0] ?? {};
  const cash = cashList[0] ?? {};

  const endDate = endDateOf(income);
  if (!endDate) return null;

  return {
    periodEnding: endDate,
    income,
    balance,
    cash,
    financialData: (s.financialData as Record<string, unknown>) ?? {},
    keyStats: (s.defaultKeyStatistics as Record<string, unknown>) ?? {},
  };
}

function endDateOf(obj: Record<string, unknown>): string | null {
  const v = obj.endDate;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.slice(0, 10);
  return null;
}

async function writeFundamentalsRow(
  ticker: string,
  periodType: "quarterly" | "annual",
  snap: FundamentalsSnapshot
): Promise<void> {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const big = num;

  const revenue = big(snap.income.totalRevenue);
  const grossProfit = big(snap.income.grossProfit);
  const operatingIncome = big(snap.income.operatingIncome);
  const netIncome = big(snap.income.netIncome);
  const ebitda = big(snap.financialData.ebitda);

  const totalAssets = big(snap.balance.totalAssets);
  const totalLiabilities = big(snap.balance.totalLiab);
  const totalEquity = big(snap.balance.totalStockholderEquity);
  const totalDebt = big(snap.financialData.totalDebt);
  const totalCash = big(snap.financialData.totalCash);
  const sharesOutstanding = big(snap.keyStats.sharesOutstanding);

  const operatingCashFlow =
    big(snap.financialData.operatingCashflow) ??
    big(snap.cash.totalCashFromOperatingActivities);
  const freeCashFlow = big(snap.financialData.freeCashflow);
  const capex = big(snap.cash.capitalExpenditures);

  // Derived ratios
  const ratio = (n: number | null, d: number | null): number | null =>
    n != null && d != null && d !== 0 ? n / d : null;
  const grossMargin = ratio(grossProfit, revenue);
  const operatingMargin = ratio(operatingIncome, revenue);
  const netMargin = ratio(netIncome, revenue);
  const roe = ratio(netIncome, totalEquity);
  const roa = ratio(netIncome, totalAssets);
  const currentRatio = num(snap.financialData.currentRatio);
  const debtToEquity = num(snap.financialData.debtToEquity);

  await pool.query(
    `INSERT INTO "ticker_fundamentals"
      (ticker, period_ending, period_type, source,
       revenue, gross_profit, operating_income, net_income, ebitda,
       eps_basic, eps_diluted,
       total_assets, total_liabilities, total_equity, total_debt, total_cash,
       shares_outstanding,
       operating_cash_flow, free_cash_flow, capex,
       gross_margin, operating_margin, net_margin, roe, roa,
       current_ratio, debt_to_equity)
     VALUES (
       $1, $2::date, $3, 'yahoo',
       $4, $5, $6, $7, $8,
       $9, $10,
       $11, $12, $13, $14, $15,
       $16,
       $17, $18, $19,
       $20, $21, $22, $23, $24,
       $25, $26
     )
     ON CONFLICT (ticker, period_ending, period_type) DO UPDATE SET
       revenue = EXCLUDED.revenue, gross_profit = EXCLUDED.gross_profit,
       operating_income = EXCLUDED.operating_income,
       net_income = EXCLUDED.net_income, ebitda = EXCLUDED.ebitda,
       eps_basic = EXCLUDED.eps_basic, eps_diluted = EXCLUDED.eps_diluted,
       total_assets = EXCLUDED.total_assets,
       total_liabilities = EXCLUDED.total_liabilities,
       total_equity = EXCLUDED.total_equity,
       total_debt = EXCLUDED.total_debt, total_cash = EXCLUDED.total_cash,
       shares_outstanding = EXCLUDED.shares_outstanding,
       operating_cash_flow = EXCLUDED.operating_cash_flow,
       free_cash_flow = EXCLUDED.free_cash_flow, capex = EXCLUDED.capex,
       gross_margin = EXCLUDED.gross_margin,
       operating_margin = EXCLUDED.operating_margin,
       net_margin = EXCLUDED.net_margin,
       roe = EXCLUDED.roe, roa = EXCLUDED.roa,
       current_ratio = EXCLUDED.current_ratio,
       debt_to_equity = EXCLUDED.debt_to_equity,
       as_of = NOW()`,
    [
      ticker, snap.periodEnding, periodType,
      revenue, grossProfit, operatingIncome, netIncome, ebitda,
      num(snap.income.basicEPS), num(snap.income.dilutedEPS),
      totalAssets, totalLiabilities, totalEquity, totalDebt, totalCash,
      sharesOutstanding,
      operatingCashFlow, freeCashFlow, capex,
      grossMargin, operatingMargin, netMargin, roe, roa,
      currentRatio, debtToEquity,
    ]
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/warehouse/refresh/fundamentals.ts
git commit -m "Warehouse: refreshFundamentals — quarterly + annual per ticker

Yahoo quoteSummary returns historical income/balance/cash-flow lists;
we write the latest quarterly and annual rows. Ratios (margins, ROE,
ROA) computed on insert to avoid re-deriving at query time. Idempotent
via ON CONFLICT (ticker, period_ending, period_type).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.5: Events refresh (earnings calendar + recent filings)

**Files:**
- Create: `src/lib/warehouse/refresh/events.ts`

- [ ] **Step 1: Write `src/lib/warehouse/refresh/events.ts`**

```typescript
import { default as YahooFinanceCtor } from "yahoo-finance2";
import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import { getRecentFilings } from "../../data/sec";

const yahoo = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type EventsRefreshResult = {
  attempted: number;
  inserted: number;
  failed: Array<{ ticker: string; error: string }>;
};

export async function refreshEvents(
  tickers: string[]
): Promise<EventsRefreshResult> {
  const attempted = tickers.length;
  let inserted = 0;
  const failed: EventsRefreshResult["failed"] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const ticker = tickers[idx].toUpperCase();
      try {
        inserted += await refreshTicker(ticker);
      } catch (err) {
        failed.push({
          ticker,
          error: err instanceof Error ? err.message : "unknown",
        });
        log.warn("warehouse.refresh.events", "ticker failed", {
          ticker,
          ...errorInfo(err),
        });
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(3, tickers.length) },
    () => worker()
  );
  await Promise.all(workers);
  return { attempted, inserted, failed };
}

async function refreshTicker(ticker: string): Promise<number> {
  let inserted = 0;

  // Earnings calendar — Yahoo quoteSummary.calendarEvents
  try {
    const s = (await yahoo.quoteSummary(ticker, {
      modules: ["calendarEvents"],
    })) as unknown as {
      calendarEvents?: {
        earnings?: {
          earningsDate?: Date[];
          earningsAverage?: number;
          earningsHigh?: number;
          earningsLow?: number;
          revenueAverage?: number;
        };
        dividendDate?: Date | null;
        exDividendDate?: Date | null;
      };
    };
    const ce = s.calendarEvents;
    if (ce?.earnings?.earningsDate?.length) {
      const first = ce.earnings.earningsDate[0];
      if (first instanceof Date) {
        const eventDate = first.toISOString().slice(0, 10);
        inserted += await upsertEvent({
          ticker,
          eventType: "earnings",
          eventDate,
          eventTime: first.toISOString(),
          details: {
            dedupKey: `earnings:${eventDate}`,
            epsEstimate: ce.earnings.earningsAverage ?? null,
            revenueEstimate: ce.earnings.revenueAverage ?? null,
            epsHigh: ce.earnings.earningsHigh ?? null,
            epsLow: ce.earnings.earningsLow ?? null,
          },
          source: "yahoo",
        });
      }
    }
    if (ce?.exDividendDate instanceof Date) {
      const d = ce.exDividendDate.toISOString().slice(0, 10);
      inserted += await upsertEvent({
        ticker,
        eventType: "dividend_ex",
        eventDate: d,
        eventTime: null,
        details: {
          dedupKey: `dividend_ex:${d}`,
          payableDate:
            ce.dividendDate instanceof Date
              ? ce.dividendDate.toISOString().slice(0, 10)
              : null,
        },
        source: "yahoo",
      });
    }
  } catch (err) {
    log.warn("warehouse.events", "yahoo calendar failed", {
      ticker,
      ...errorInfo(err),
    });
  }

  // Recent SEC filings (8-K / 10-Q / 10-K)
  try {
    const filings = await getRecentFilings(ticker, 10);
    for (const f of filings) {
      const typeMap: Record<string, "filing_8k" | "filing_10q" | "filing_10k"> = {
        "8-K": "filing_8k",
        "10-Q": "filing_10q",
        "10-K": "filing_10k",
      };
      const eventType = typeMap[f.form];
      if (!eventType) continue;
      inserted += await upsertEvent({
        ticker,
        eventType,
        eventDate: f.filedOn.slice(0, 10),
        eventTime: null,
        details: {
          dedupKey: `filing:${f.accession}`,
          accession: f.accession,
          primaryDocument: f.primaryDocument,
          url: f.url,
        },
        source: "sec",
      });
    }
  } catch (err) {
    log.warn("warehouse.events", "sec filings failed", {
      ticker,
      ...errorInfo(err),
    });
  }

  return inserted;
}

async function upsertEvent(input: {
  ticker: string;
  eventType: string;
  eventDate: string;
  eventTime: string | null;
  details: Record<string, unknown>;
  source: string;
}): Promise<number> {
  try {
    const res = await pool.query(
      `INSERT INTO "ticker_events"
         (id, ticker, event_type, event_date, event_time, details, source)
       VALUES ($1, $2, $3, $4::date, $5, $6::jsonb, $7)
       ON CONFLICT (ticker, event_type, event_date, (details->>'dedupKey'))
       WHERE details->>'dedupKey' IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        genId(),
        input.ticker,
        input.eventType,
        input.eventDate,
        input.eventTime,
        JSON.stringify(input.details),
        input.source,
      ]
    );
    return res.rowCount ?? 0;
  } catch (err) {
    log.warn("warehouse.events", "upsert failed", {
      ticker: input.ticker,
      eventType: input.eventType,
      ...errorInfo(err),
    });
    return 0;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/warehouse/refresh/events.ts
git commit -m "Warehouse: refreshEvents — earnings calendar + SEC filings

For each ticker: pull Yahoo calendarEvents (earnings date + ex-dividend)
and SEC EDGAR recent filings (8-K/10-Q/10-K). Writes one row per event
with stable dedup keys so re-running the cron doesn't duplicate.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.6: Sentiment refresh (Finnhub-aware)

**Files:**
- Create: `src/lib/warehouse/refresh/sentiment.ts`

- [ ] **Step 1: Write `src/lib/warehouse/refresh/sentiment.ts`**

```typescript
import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  finnhubConfigured,
  getTickerNews,
  getTickerSentiment,
} from "../../data/finnhub";

export type SentimentRefreshResult = {
  attempted: number;
  written: number;
  skipped: number;
  reason?: string;
};

/**
 * Write one sentiment row per ticker per day. When FINNHUB_API_KEY is
 * unset, we write rows anyway with news_count=0 and null scores so
 * downstream readers get a consistent shape.
 */
export async function refreshSentiment(
  tickers: string[]
): Promise<SentimentRefreshResult> {
  const attempted = tickers.length;
  let written = 0;
  let skipped = 0;

  if (!finnhubConfigured()) {
    // Still write empty rows for continuity.
    for (const ticker of tickers) {
      try {
        await writeRow({
          ticker: ticker.toUpperCase(),
          source: "finnhub",
          newsCount: 0,
          bullishPct: null,
          bearishPct: null,
          neutralPct: null,
          buzzRatio: null,
          companyNewsScore: null,
          sectorAvgScore: null,
          topHeadlines: null,
        });
        written++;
      } catch {
        skipped++;
      }
    }
    return {
      attempted,
      written,
      skipped,
      reason: "finnhub_not_configured",
    };
  }

  let cursor = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const ticker = tickers[idx].toUpperCase();
      try {
        const [news, sentiment] = await Promise.all([
          getTickerNews(ticker, 7, 5),
          getTickerSentiment(ticker),
        ]);
        await writeRow({
          ticker,
          source: "finnhub",
          newsCount: news.items.length,
          bullishPct: sentiment.sentiment?.bullishPercent ?? null,
          bearishPct: sentiment.sentiment?.bearishPercent ?? null,
          neutralPct: null, // Finnhub doesn't split neutral
          buzzRatio: sentiment.buzz?.buzz ?? null,
          companyNewsScore: sentiment.companyNewsScore ?? null,
          sectorAvgScore: sentiment.sectorAverageNewsScore ?? null,
          topHeadlines: news.items.slice(0, 5).map((n) => ({
            title: n.headline,
            url: n.link,
            source: n.source,
            publishedAt: n.datetime,
          })),
        });
        written++;
      } catch (err) {
        skipped++;
        log.warn("warehouse.refresh.sentiment", "ticker failed", {
          ticker,
          ...errorInfo(err),
        });
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(3, tickers.length) },
    () => worker()
  );
  await Promise.all(workers);

  return { attempted, written, skipped };
}

type WriteInput = {
  ticker: string;
  source: string;
  newsCount: number;
  bullishPct: number | null;
  bearishPct: number | null;
  neutralPct: number | null;
  buzzRatio: number | null;
  companyNewsScore: number | null;
  sectorAvgScore: number | null;
  topHeadlines:
    | Array<{
        title: string;
        url: string | null;
        source: string | null;
        publishedAt: string | null;
      }>
    | null;
};

async function writeRow(w: WriteInput): Promise<void> {
  await pool.query(
    `INSERT INTO "ticker_sentiment_daily"
       (ticker, captured_at, source,
        news_count, bullish_pct, bearish_pct, neutral_pct,
        buzz_ratio, company_news_score, sector_avg_score, top_headlines)
     VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (ticker, captured_at) DO UPDATE SET
       news_count = EXCLUDED.news_count,
       bullish_pct = EXCLUDED.bullish_pct,
       bearish_pct = EXCLUDED.bearish_pct,
       neutral_pct = EXCLUDED.neutral_pct,
       buzz_ratio = EXCLUDED.buzz_ratio,
       company_news_score = EXCLUDED.company_news_score,
       sector_avg_score = EXCLUDED.sector_avg_score,
       top_headlines = EXCLUDED.top_headlines,
       as_of = NOW()`,
    [
      w.ticker,
      w.source,
      w.newsCount,
      w.bullishPct,
      w.bearishPct,
      w.neutralPct,
      w.buzzRatio,
      w.companyNewsScore,
      w.sectorAvgScore,
      w.topHeadlines ? JSON.stringify(w.topHeadlines) : null,
    ]
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/warehouse/refresh/sentiment.ts
git commit -m "Warehouse: refreshSentiment — Finnhub-aware with graceful degradation

When FINNHUB_API_KEY is set, fetches /company-news and /news-sentiment
and persists to ticker_sentiment_daily. When unset, still writes rows
with news_count=0 so downstream readers get a consistent shape
regardless of configuration.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.7: System aggregate rollup

**Files:**
- Create: `src/lib/warehouse/refresh/aggregate.ts`

- [ ] **Step 1: Write `src/lib/warehouse/refresh/aggregate.ts`**

```typescript
import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import { upsertSystemMetric } from "../aggregate";

/**
 * Populate system_aggregate_daily rows for today. Reads counts + averages
 * from existing user-scoped tables but writes ONLY aggregate values
 * (no userId, email, IP, etc.) to system_aggregate_daily.
 *
 * Metrics seeded (matches spec §4.5):
 *   recs.total, recs.by_rec, recs.by_sector
 *   analyst.total_calls, analyst.success_rate, analyst.avg_tokens
 *   supervisor.fast_path_share
 *   alerts.created, alerts.active
 *   waitlist.new_signups_daily, waitlist.total_size
 */
export async function refreshAggregates(): Promise<{ metrics: number }> {
  let metrics = 0;
  const safeUpsert = async (input: Parameters<typeof upsertSystemMetric>[0]) => {
    await upsertSystemMetric(input);
    metrics++;
  };

  try {
    // recs.total today
    const r1 = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "recommendation"
       WHERE "createdAt"::date = CURRENT_DATE`
    );
    await safeUpsert({
      metricName: "recs.total",
      valueNumeric: Number(r1.rows[0]?.n ?? 0),
    });

    // recs.by_rec
    const r2 = await pool.query(
      `SELECT recommendation, COUNT(*)::int AS n FROM "recommendation"
       WHERE "createdAt"::date = CURRENT_DATE
       GROUP BY recommendation`
    );
    for (const row of r2.rows as Array<{ recommendation: string; n: number }>) {
      await safeUpsert({
        metricName: "recs.by_rec",
        dimension: row.recommendation,
        valueNumeric: Number(row.n ?? 0),
      });
    }

    // analyst totals per model (from analysisJson)
    const r3 = await pool.query(
      `WITH analyst_rows AS (
         SELECT jsonb_array_elements("analysisJson"->'analyses') AS a
         FROM "recommendation"
         WHERE "createdAt"::date = CURRENT_DATE
       )
       SELECT
         a->>'model' AS model,
         COUNT(*)::int AS total,
         SUM(CASE WHEN a->>'status' = 'ok' THEN 1 ELSE 0 END)::int AS ok,
         AVG((a->>'tokensUsed')::int) FILTER (WHERE a->>'status' = 'ok') AS avg_tokens
       FROM analyst_rows
       WHERE a->>'model' IS NOT NULL
       GROUP BY a->>'model'`
    );
    for (const row of r3.rows as Array<{
      model: string;
      total: number;
      ok: number;
      avg_tokens: string | number | null;
    }>) {
      await safeUpsert({
        metricName: "analyst.total_calls",
        dimension: row.model,
        valueNumeric: Number(row.total ?? 0),
      });
      const successRate =
        row.total > 0 ? Number(row.ok ?? 0) / Number(row.total) : 0;
      await safeUpsert({
        metricName: "analyst.success_rate",
        dimension: row.model,
        valueNumeric: successRate,
      });
      await safeUpsert({
        metricName: "analyst.avg_tokens",
        dimension: row.model,
        valueNumeric:
          row.avg_tokens === null || row.avg_tokens === undefined
            ? null
            : Number(row.avg_tokens),
      });
    }

    // supervisor fast-path share
    const r4 = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         SUM(CASE WHEN "analysisJson"->>'supervisorModel' = 'panel-consensus'
                  THEN 1 ELSE 0 END)::int AS fast
       FROM "recommendation"
       WHERE "createdAt"::date = CURRENT_DATE`
    );
    const total = Number(r4.rows[0]?.total ?? 0);
    const fast = Number(r4.rows[0]?.fast ?? 0);
    await safeUpsert({
      metricName: "supervisor.fast_path_share",
      valueNumeric: total > 0 ? fast / total : 0,
    });

    // alerts.created today, by kind
    const r5 = await pool.query(
      `SELECT kind, COUNT(*)::int AS n FROM "alert_event"
       WHERE "createdAt"::date = CURRENT_DATE
       GROUP BY kind`
    );
    for (const row of r5.rows as Array<{ kind: string; n: number }>) {
      await safeUpsert({
        metricName: "alerts.created",
        dimension: row.kind,
        valueNumeric: Number(row.n ?? 0),
      });
    }

    // alerts.active, by kind
    const r6 = await pool.query(
      `SELECT kind, COUNT(*)::int AS n FROM "alert_event"
       WHERE "dismissedAt" IS NULL
       GROUP BY kind`
    );
    for (const row of r6.rows as Array<{ kind: string; n: number }>) {
      await safeUpsert({
        metricName: "alerts.active",
        dimension: row.kind,
        valueNumeric: Number(row.n ?? 0),
      });
    }

    // waitlist
    const r7 = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE "createdAt"::date = CURRENT_DATE)::int AS today,
         COUNT(*)::int AS total
       FROM "waitlist"`
    );
    await safeUpsert({
      metricName: "waitlist.new_signups_daily",
      valueNumeric: Number(r7.rows[0]?.today ?? 0),
    });
    await safeUpsert({
      metricName: "waitlist.total_size",
      valueNumeric: Number(r7.rows[0]?.total ?? 0),
    });
  } catch (err) {
    log.warn("warehouse.refresh.aggregate", "rollup failed", errorInfo(err));
  }

  return { metrics };
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/warehouse/refresh/aggregate.ts
git commit -m "Warehouse: refreshAggregates — anonymized operational metrics

Reads counts/averages from recommendation + alert_event + waitlist but
writes ONLY aggregate values to system_aggregate_daily. No userId, no
email, no IP columns are ever referenced. Each metric is idempotent
(ON CONFLICT on (captured_at, metric_name, dimension) updates the value).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.8: Orchestrator + cron wiring

**Files:**
- Create: `src/lib/warehouse/refresh.ts`
- Modify: `src/app/api/cron/evaluate-outcomes/route.ts`

- [ ] **Step 1: Write the orchestrator `src/lib/warehouse/refresh.ts`**

```typescript
import { getTickerUniverse } from "./universe";
import { refreshMarket } from "./refresh/market";
import { refreshFundamentals } from "./refresh/fundamentals";
import { refreshEvents } from "./refresh/events";
import { refreshSentiment } from "./refresh/sentiment";
import { refreshAggregates } from "./refresh/aggregate";

export type WarehouseRefreshResult = {
  universeSize: number;
  market: Awaited<ReturnType<typeof refreshMarket>>;
  fundamentals: Awaited<ReturnType<typeof refreshFundamentals>>;
  events: Awaited<ReturnType<typeof refreshEvents>>;
  sentiment: Awaited<ReturnType<typeof refreshSentiment>>;
  aggregates: Awaited<ReturnType<typeof refreshAggregates>>;
};

/**
 * Top-level warehouse refresh. The only caller is the nightly cron.
 *
 * Steps run sequentially (not parallel) so we don't slam Yahoo with
 * 4 cron steps × 4 workers = 16 concurrent requests. Each step has
 * its own internal concurrency cap.
 */
export async function refreshWarehouse(): Promise<WarehouseRefreshResult> {
  const universe = await getTickerUniverse();

  const market = await refreshMarket(universe);
  const fundamentals = await refreshFundamentals(universe);
  const events = await refreshEvents(universe);
  const sentiment = await refreshSentiment(universe);
  const aggregates = await refreshAggregates();

  return {
    universeSize: universe.length,
    market,
    fundamentals,
    events,
    sentiment,
    aggregates,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Modify `src/app/api/cron/evaluate-outcomes/route.ts` — add step 8**

Open the file and add a new import at the top alongside existing imports:

```typescript
import { refreshWarehouse } from "@/lib/warehouse/refresh";
```

Find the block starting `// 7. Pre-warm public-data caches for the top 25 most-researched tickers` and add AFTER its try/catch block (before `result.durationMs = Date.now() - started;`):

```typescript
  // 8. Warehouse refresh — populates 5 ticker-keyed tables from free sources.
  //    $0 AI. Universe is the set of tickers currently held by any user;
  //    getTickerUniverse() returns only string[], no userId ever leaves it.
  try {
    result.warehouse = await refreshWarehouse();
  } catch (err) {
    log.error("cron", "warehouse refresh failed", errorInfo(err));
    result.warehouse = { error: "failed" };
  }
```

- [ ] **Step 4: Typecheck + build**

```bash
./node_modules/.bin/tsc --noEmit
npm run build
```
Both should succeed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/warehouse/refresh.ts src/app/api/cron/evaluate-outcomes/route.ts
git commit -m "Warehouse: refreshWarehouse orchestrator + cron step 8

Sequential execution of market → fundamentals → events → sentiment →
aggregates. Universe fetched once via getTickerUniverse() and passed to
each refresh step. Cron reports per-step counts.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase 2 Acceptance

- [ ] **Acceptance: deploy + manual cron trigger + Neon row-count validation**

Deploy:
```bash
vercel --prod --scope mentisvision --yes
```

Extract CRON_SECRET (reuses prior-session pattern):
```bash
vercel env pull /tmp/prodenv --environment=production --scope mentisvision --yes
export CRON_SECRET=$(grep "^CRON_SECRET=" /tmp/prodenv | sed 's/CRON_SECRET="//' | sed 's/"$//')
```

Trigger cron:
```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://clearpath-invest.vercel.app/api/cron/evaluate-outcomes \
  --max-time 300 | python3 -m json.tool | grep -A 20 '"warehouse"'
```

Expected (approximate shape, counts depend on how many tickers users hold):
```json
"warehouse": {
  "universeSize": 4,
  "market": { "attempted": 4, "written": N, "skipped": M, "failed": [...] },
  "fundamentals": { "attempted": 4, "written": N, ... },
  "events": { "attempted": 4, "inserted": N, ... },
  "sentiment": { "attempted": 4, "written": N, ... },
  "aggregates": { "metrics": N }
}
```

Verify in Neon (run via MCP):
```sql
SELECT 'market' AS t, COUNT(*) FROM ticker_market_daily WHERE captured_at = CURRENT_DATE
UNION ALL SELECT 'fundamentals', COUNT(*) FROM ticker_fundamentals WHERE as_of::date = CURRENT_DATE
UNION ALL SELECT 'events', COUNT(*) FROM ticker_events WHERE as_of::date = CURRENT_DATE
UNION ALL SELECT 'sentiment', COUNT(*) FROM ticker_sentiment_daily WHERE captured_at = CURRENT_DATE
UNION ALL SELECT 'aggregates', COUNT(*) FROM system_aggregate_daily WHERE captured_at = CURRENT_DATE;
```
Expected: each row has count > 0 (exact numbers depend on universe size, Yahoo availability for crypto, Finnhub config).

Verify privacy — no userId in any warehouse table:
```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_name IN ('ticker_market_daily','ticker_fundamentals','ticker_events','ticker_sentiment_daily','system_aggregate_daily')
  AND column_name ILIKE ANY(ARRAY['%user%','%email%','%ip%','%session%','%account%']);
```
Expected: empty.

---

## Phase 3 — Migrate low-risk readers (warehouse-first)

Goal: Outcome evaluator, alert scanner, and dashboard widgets read from warehouse with Yahoo fallback. No user-visible regression.

Acceptance test: `scanPriceMoves` runs cleanly on the cron using warehouse data; dashboard loads with warehouse-backed values visible.

---

### Task 3.1: Outcome evaluator reads warehouse first

**Files:**
- Modify: `src/lib/outcomes.ts`

- [ ] **Step 1: Open `src/lib/outcomes.ts` and locate `getOrFetchPrice`**

- [ ] **Step 2: Add warehouse-first path**

Replace the existing `getOrFetchPrice` implementation with:

```typescript
import { getTickerMarket } from "./warehouse";

// ...existing imports stay...

/**
 * Returns today's price for `ticker`:
 * 1. Warehouse `ticker_market_daily.close` (populated nightly) — fastest
 * 2. `price_snapshot` cache (captured_at = today)
 * 3. Yahoo live quote — last resort, always fresh
 *
 * Writes back to price_snapshot on miss so repeated outcome evaluations
 * on the same day don't re-hit external sources.
 */
export async function getOrFetchPrice(ticker: string): Promise<number | null> {
  // 1. Warehouse
  const warehouse = await getTickerMarket(ticker);
  if (warehouse?.close != null && warehouse.close > 0) {
    return warehouse.close;
  }

  // 2. Existing price_snapshot cache (unchanged logic below this line)
  try {
    const { rows } = await pool.query(
      `SELECT price FROM "price_snapshot"
       WHERE ticker = $1 AND "capturedAt" = CURRENT_DATE
       LIMIT 1`,
      [ticker]
    );
    if (rows.length > 0) return Number(rows[0].price);

    const q = (await yahooFinance.quote(ticker)) as Record<string, unknown>;
    const price = typeof q.regularMarketPrice === "number" ? q.regularMarketPrice : null;
    if (price == null) return null;

    try {
      await pool.query(
        `INSERT INTO "price_snapshot" (ticker, "capturedAt", price, source)
         VALUES ($1, CURRENT_DATE, $2, 'yahoo')
         ON CONFLICT (ticker, "capturedAt") DO NOTHING`,
        [ticker, price]
      );
    } catch {
      /* ignore cache write failures */
    }

    return price;
  } catch (err) {
    log.warn("outcomes", "getOrFetchPrice failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}
```

- [ ] **Step 3: Typecheck + build**

```bash
./node_modules/.bin/tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/outcomes.ts
git commit -m "Warehouse: outcomes.getOrFetchPrice reads warehouse first

Outcome eval now checks ticker_market_daily.close before hitting
price_snapshot or Yahoo. Reduces Yahoo calls during outcome evaluation
since warehouse is populated the same night.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.2: scanPriceMoves reads warehouse

**Files:**
- Modify: `src/lib/alerts.ts`

- [ ] **Step 1: Open `src/lib/alerts.ts` and replace the Yahoo quote loop in `scanPriceMoves`**

Find the block starting `const uniqueTickers = [...new Set(holdings.map((h) => h.ticker))];` and replace through the end of the `for (const ticker of uniqueTickers)` loop with:

```typescript
  const uniqueTickers = [...new Set(holdings.map((h) => h.ticker))];

  // Warehouse-first: pull latest close from ticker_market_daily.
  // Fall back to Yahoo for tickers warehouse doesn't cover yet.
  const { getTickerMarketBatch } = await import("./warehouse");
  const warehouseMap = await getTickerMarketBatch(uniqueTickers);

  const prices = new Map<string, number>();
  const missingTickers: string[] = [];
  for (const ticker of uniqueTickers) {
    const row = warehouseMap.get(ticker.toUpperCase());
    if (row?.close != null && row.close > 0) {
      prices.set(ticker, row.close);
    } else {
      missingTickers.push(ticker);
    }
  }

  // Fallback: Yahoo live for warehouse misses only.
  for (const ticker of missingTickers) {
    try {
      const q = (await yahoo.quote(ticker)) as Record<string, unknown>;
      const p =
        typeof q.regularMarketPrice === "number" ? q.regularMarketPrice : null;
      if (p != null && p > 0) prices.set(ticker, p);
    } catch {
      /* skip — alert won't fire for this ticker today */
    }
  }
```

- [ ] **Step 2: Typecheck + build**

```bash
./node_modules/.bin/tsc --noEmit
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/alerts.ts
git commit -m "Warehouse: scanPriceMoves reads warehouse first, Yahoo fallback

Alert scanner now pulls latest close from ticker_market_daily for the
common path and only falls back to yahoo.quote() for tickers not yet
in the warehouse. Same sanity guard (>40pct move skipped).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.3: Dashboard ticker read API

**Files:**
- Create: `src/app/api/warehouse/ticker/[ticker]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getTickerMarket,
  getTickerFundamentals,
  getUpcomingEvents,
  getRecentEvents,
  getTickerSentiment,
} from "@/lib/warehouse";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/warehouse/ticker/[ticker]
 * Returns warehouse data for a ticker in one payload — market, fundamentals,
 * upcoming/recent events, sentiment. Auth-gated + rate-limited.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const rl = await checkRateLimit(
    { ...RULES.researchUser, name: "warehouse:ticker", limit: 120 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const [market, fundamentals, upcoming, recent, sentiment] = await Promise.all([
      getTickerMarket(ticker),
      getTickerFundamentals(ticker),
      getUpcomingEvents(ticker, { windowDays: 60 }),
      getRecentEvents(ticker, { windowDays: 90 }),
      getTickerSentiment(ticker),
    ]);
    return NextResponse.json({
      ticker,
      market,
      fundamentals,
      upcomingEvents: upcoming,
      recentEvents: recent,
      sentiment,
    });
  } catch (err) {
    log.error("warehouse.ticker.route", "failed", {
      ticker,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not load warehouse data." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/warehouse/ticker/
git commit -m "Warehouse: /api/warehouse/ticker/[ticker] endpoint

One-call read of all 4 ticker-keyed tables for dashboard cards. Auth-
gated, rate-limited at 120/hr per user.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase 3 Acceptance

- [ ] **Acceptance: deploy + verify readers + dashboard**

Deploy:
```bash
vercel --prod --scope mentisvision --yes
```

Test the new ticker endpoint (after a cron has seeded data for one of demo user's held tickers):
```bash
curl -s -c /tmp/cookie.txt -X POST https://clearpath-invest.vercel.app/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@clearpath.com","password":"DemoPass2026!"}' -o /dev/null

curl -s -b /tmp/cookie.txt \
  https://clearpath-invest.vercel.app/api/warehouse/ticker/LINK --max-time 15 \
  | python3 -m json.tool | head -40
```
Expected: JSON with `market`, `fundamentals`, `upcomingEvents`, `recentEvents`, `sentiment` keys. `market` has a populated row if warehouse ran for LINK; may be null for crypto (Yahoo coverage varies).

Re-trigger the daily cron manually to verify alerts scanner still works with warehouse:
```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://clearpath-invest.vercel.app/api/cron/evaluate-outcomes \
  --max-time 300 | python3 -c "import sys, json; d = json.load(sys.stdin); print('priceMoves:', d.get('alerts', {}).get('priceMoves'))"
```
Expected: `{'created': 0, 'skippedSuspicious': 0}` (consistent with Phase B steady state — crypto still skipped).

---

## Phase 4 — Research pipeline migration

Goal: Analyst prompts cite warehouse-sourced fields for valuation/technicals/consensus; current price + day change still fetched live.

Acceptance: Research a ticker; verdict output references warehouse-backed fields; one-week monitoring via `system_aggregate_daily` shows no verdict-quality regression.

---

### Task 4.1: Data block split (warehouse + live)

**Files:**
- Modify: `src/lib/data/yahoo.ts` — add a new helper that composes warehouse + live
- Modify: `src/app/api/research/route.ts` — use the new helper

- [ ] **Step 1: Add `formatWarehouseEnhancedDataBlock` in `src/lib/data/yahoo.ts`**

At the bottom of `src/lib/data/yahoo.ts`, append:

```typescript
import {
  getTickerMarket,
  getTickerFundamentals,
} from "../warehouse";

/**
 * Compose a DATA block that uses warehouse-backed fields for slowly-changing
 * signals (valuation, technicals, fundamentals, analyst consensus) plus
 * Yahoo-live for intraday sensitive fields (current price, day change).
 *
 * This is the function research handlers should call instead of
 * formatSnapshotForAI when the warehouse is populated.
 */
export async function formatWarehouseEnhancedDataBlock(
  snapshot: StockSnapshot
): Promise<string> {
  const ticker = snapshot.symbol.toUpperCase();
  const [market, fundamentals] = await Promise.all([
    getTickerMarket(ticker),
    getTickerFundamentals(ticker),
  ]);

  const fmt = (n: number | null | undefined, opts?: Intl.NumberFormatOptions) =>
    n == null ? "N/A" : new Intl.NumberFormat("en-US", opts).format(n);
  const cur = (n: number | null | undefined) =>
    n == null
      ? "N/A"
      : `$${fmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (n: number | null | undefined) =>
    n == null ? "N/A" : `${(n * 100).toFixed(2)}%`;
  const pctRaw = (n: number | null | undefined) =>
    n == null ? "N/A" : `${n.toFixed(2)}%`;
  const big = (n: number | null | undefined) => {
    if (n == null) return "N/A";
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    return cur(n);
  };

  const lines: string[] = [];
  lines.push(`TICKER: ${snapshot.symbol} (${snapshot.name})`);
  lines.push(`SECTOR: ${snapshot.sector ?? "N/A"} / ${snapshot.industry ?? "N/A"}`);
  lines.push(`AS OF: ${snapshot.asOf}`);
  lines.push("");
  lines.push("[LIVE] PRICE (Yahoo, request time):");
  lines.push(`- Current Price: ${cur(snapshot.price)}`);
  lines.push(`- Day Change: ${cur(snapshot.change)} (${pctRaw(snapshot.changePct)})`);
  lines.push("");

  lines.push(
    market
      ? `[WAREHOUSE] VALUATION (ticker_market_daily as of ${market.capturedAt}):`
      : "[LIVE] VALUATION (Yahoo, warehouse miss):"
  );
  lines.push(
    `- P/E (Trailing): ${fmt(market?.peTrailing ?? snapshot.peRatio, { maximumFractionDigits: 2 })}`
  );
  lines.push(
    `- P/E (Forward): ${fmt(market?.peForward ?? snapshot.forwardPE, { maximumFractionDigits: 2 })}`
  );
  lines.push(
    `- P/B: ${fmt(market?.priceToBook, { maximumFractionDigits: 2 })}`
  );
  lines.push(
    `- P/S: ${fmt(market?.priceToSales, { maximumFractionDigits: 2 })}`
  );
  lines.push(
    `- EV/EBITDA: ${fmt(market?.evToEbitda, { maximumFractionDigits: 2 })}`
  );
  lines.push(`- Market Cap: ${big(market?.marketCap ?? snapshot.marketCap)}`);
  lines.push(
    `- Dividend Yield: ${pct(market?.dividendYield ?? snapshot.dividendYield)}`
  );
  lines.push(
    `- EPS (TTM): ${cur(market?.epsTtm ?? snapshot.eps)}`
  );
  lines.push(`- Beta: ${fmt(market?.beta ?? snapshot.beta, { maximumFractionDigits: 2 })}`);
  lines.push("");

  lines.push(
    market
      ? `[WAREHOUSE] RANGE & TECHNICALS:`
      : `[LIVE] RANGE (Yahoo):`
  );
  lines.push(
    `- 52-Week Range: ${cur(market?.low52w ?? snapshot.fiftyTwoWeekLow)} – ${cur(market?.high52w ?? snapshot.fiftyTwoWeekHigh)}`
  );
  lines.push(`- 50-Day MA: ${cur(market?.ma50 ?? snapshot.fiftyDayAvg)}`);
  lines.push(`- 200-Day MA: ${cur(market?.ma200 ?? snapshot.twoHundredDayAvg)}`);
  if (market) {
    lines.push(`- RSI (14d): ${fmt(market.rsi14, { maximumFractionDigits: 2 })}`);
    lines.push(`- MACD: ${fmt(market.macd, { maximumFractionDigits: 4 })}`);
    lines.push(
      `- MACD Signal: ${fmt(market.macdSignal, { maximumFractionDigits: 4 })}`
    );
    lines.push(
      `- Bollinger Bands: ${cur(market.bollingerLower)} – ${cur(market.bollingerUpper)}`
    );
    lines.push(
      `- VWAP (20d): ${cur(market.vwap20d)}`
    );
    lines.push(
      `- Relative Strength vs SPY (30d): ${pctRaw(market.relStrengthSpy30d)}`
    );
  }
  lines.push("");

  lines.push(
    market
      ? `[WAREHOUSE] ANALYST CONSENSUS:`
      : `[LIVE] ANALYST CONSENSUS (Yahoo):`
  );
  lines.push(
    `- Target Price: ${cur(market?.analystTargetMean ?? snapshot.analystTarget)}`
  );
  lines.push(
    `- # Covering Analysts: ${fmt(market?.analystCount)}`
  );
  lines.push(
    `- Recommendation: ${market?.analystRating ?? snapshot.recommendationKey ?? "N/A"}`
  );
  lines.push("");

  if (fundamentals) {
    lines.push(
      `[WAREHOUSE] FUNDAMENTALS (${fundamentals.periodType} ending ${fundamentals.periodEnding}):`
    );
    lines.push(`- Revenue: ${big(fundamentals.revenue)}`);
    lines.push(`- Gross Profit: ${big(fundamentals.grossProfit)}`);
    lines.push(`- Operating Income: ${big(fundamentals.operatingIncome)}`);
    lines.push(`- Net Income: ${big(fundamentals.netIncome)}`);
    lines.push(`- EBITDA: ${big(fundamentals.ebitda)}`);
    lines.push(
      `- Gross Margin: ${pct(fundamentals.grossMargin)}`
    );
    lines.push(
      `- Operating Margin: ${pct(fundamentals.operatingMargin)}`
    );
    lines.push(`- Net Margin: ${pct(fundamentals.netMargin)}`);
    lines.push(`- ROE: ${pct(fundamentals.roe)}`);
    lines.push(`- Debt / Equity: ${fmt(fundamentals.debtToEquity, { maximumFractionDigits: 2 })}`);
    lines.push(`- Free Cash Flow: ${big(fundamentals.freeCashFlow)}`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Modify `src/app/api/research/route.ts` to use the new helper**

Find the line:
```typescript
    const dataBlock = [
      formatSnapshotForAI(snap),
      "",
      formatFilingsForAI(filings),
      "",
      formatMacroForAI(macro),
    ].join("\n");
```
Replace with:
```typescript
    const dataBlock = [
      await formatWarehouseEnhancedDataBlock(snap),
      "",
      formatFilingsForAI(filings),
      "",
      formatMacroForAI(macro),
    ].join("\n");
```

Ensure `formatWarehouseEnhancedDataBlock` is imported at the top:
```typescript
import {
  getStockSnapshot,
  formatSnapshotForAI,
  formatWarehouseEnhancedDataBlock,
} from "@/lib/data/yahoo";
```
Note: `formatSnapshotForAI` import stays — referenced nowhere else but kept importable for backwards compat.

- [ ] **Step 3: Typecheck + build**

```bash
./node_modules/.bin/tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/data/yahoo.ts src/app/api/research/route.ts
git commit -m "Warehouse: research DATA block uses warehouse for non-realtime fields

Current price + day change still fetched live (users expect freshness);
valuation / technicals / fundamentals / analyst consensus now sourced
from warehouse when available, with explicit [WAREHOUSE] or [LIVE]
tags so analyst prompts see exactly which source each datum came from.

The zero-hallucination prompt rule already requires 'datum must appear
verbatim in DATA block' — the tag prefix makes the provenance auditable.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.2: Portfolio review uses warehouse batch read

**Files:**
- Modify: `src/app/api/portfolio-review/route.ts`

- [ ] **Step 1: Locate the dataBlock construction in portfolio-review**

- [ ] **Step 2: Prepend batch warehouse fetch**

Near the top of the main try/catch, after `const holdings = rows as HoldingRow[];`, add:

```typescript
    const { getTickerMarketBatch } = await import("@/lib/warehouse");
    const marketMap = await getTickerMarketBatch(
      holdings.map((h) => h.ticker)
    );
```

- [ ] **Step 3: Extend per-position description**

In the `...holdings.map((h) => {` block, augment the per-position line to include warehouse-backed current-ish fields:

Replace the existing return line with:

```typescript
        const m = marketMap.get(h.ticker.toUpperCase());
        const mmPe = m?.peTrailing != null ? ` P/E ${m.peTrailing.toFixed(1)}` : "";
        const mmBeta = m?.beta != null ? ` β ${m.beta.toFixed(2)}` : "";
        return `- ${h.ticker}: ${shares} shares @ $${current.toFixed(2)}${costLabel} ≈ $${value.toFixed(2)} (${pct.toFixed(1)}% of portfolio)${sectorLabel}${mmPe}${mmBeta}${h.accountName ? ` {${h.accountName}}` : ""}`;
```

- [ ] **Step 4: Typecheck + build**

```bash
./node_modules/.bin/tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/portfolio-review/route.ts
git commit -m "Warehouse: portfolio-review annotates positions with P/E and beta

Single batched warehouse read covers all holdings. Each position line
in the data block now includes P/E (trailing) and beta when available,
sourced from ticker_market_daily (consistent across the panel).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase 4 Acceptance

- [ ] **Acceptance: full research run with warehouse-backed DATA block**

Deploy:
```bash
vercel --prod --scope mentisvision --yes
```

Test: run research on a warehouse-populated ticker (the demo user's holdings have been run through the cron by now):
```bash
curl -s -b /tmp/cookie.txt -X POST \
  https://clearpath-invest.vercel.app/api/research \
  -H "Content-Type: application/json" \
  -d '{"ticker":"LINK"}' --max-time 150 \
  | python3 -c "import sys, json; d = json.load(sys.stdin); print('verdict:', d.get('supervisor', {}).get('finalRecommendation'), d.get('supervisor', {}).get('consensus'))"
```
Expected: verdict returns (likely `HOLD UNANIMOUS` given current crypto price chop). No pipeline failures.

Verify warehouse was consulted:
```sql
-- Confirm the ticker has a recent market row
SELECT ticker, captured_at, close, pe_trailing, rsi_14
FROM ticker_market_daily
WHERE ticker = 'LINK'
ORDER BY captured_at DESC LIMIT 1;
```

If warehouse row exists, the research DATA block used `[WAREHOUSE]` tags. Confirm by re-reading the stored analysisJson:
```sql
SELECT "analysisJson"->'analyses'->0->'output'->'keySignals'->0->>'datum' AS first_datum
FROM "recommendation"
WHERE ticker = 'LINK' AND "createdAt" > NOW() - INTERVAL '5 minutes'
ORDER BY "createdAt" DESC LIMIT 1;
```
Expected: datum string starts with `[WAREHOUSE]` or `[LIVE]` prefix.

---

## Phase 5 — UX tiering

Goal: Dashboard ticker cards render at three density tiers. Settings page lets user flip global default.

Acceptance: New user lands on Basic; clicking "More" on a card expands to Intermediate; changing Settings → Density → Advanced shows all fields.

---

### Task 5.1: user_profile density preference

**Files:**
- Modify: `src/lib/user-profile.ts`

- [ ] **Step 1: Add density type + sanitize in user-profile.ts**

In `src/lib/user-profile.ts`, update the `UserProfile` type's `preferences` field to include `density`:

```typescript
export type DashboardDensity = "basic" | "standard" | "advanced";

export type UserProfile = {
  userId: string;
  riskTolerance: RiskTolerance | null;
  investmentGoals: InvestmentGoal[];
  horizon: Horizon | null;
  preferences: {
    excludedSectors?: string[];
    esgPreference?: boolean;
    notes?: string;
    density?: DashboardDensity;
  };
  disclaimerAcceptedAt: string | null;
  updatedAt: string | null;
};
```

Then update `sanitizeUpdate` — inside the `preferences` sanitizer, add:

```typescript
      density:
        p.density === "basic" || p.density === "standard" || p.density === "advanced"
          ? p.density
          : undefined,
```

- [ ] **Step 2: Typecheck**

```bash
./node_modules/.bin/tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/user-profile.ts
git commit -m "User profile: add dashboard density preference (basic/standard/advanced)

Persists via existing user_profile.preferences JSONB bag. No schema
migration needed. Defaults to 'basic' in UI code when unset.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.2: Settings page density selector

**Files:**
- Modify: `src/app/app/settings/settings-client.tsx`

- [ ] **Step 1: Add a density section to the settings form**

Locate the Preferences card in `settings-client.tsx` (it has the `excludedSectors` input) and add a new section above it within the same CardContent:

```tsx
          <div>
            <label className="mb-1.5 block text-xs font-medium">
              Dashboard density
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                {
                  value: "basic",
                  label: "Basic",
                  desc: "Price, P/E, yield, top headlines — calm and digestible.",
                },
                {
                  value: "standard",
                  label: "Standard",
                  desc: "Adds forward P/E, P/B, 50d/200d MA, beta, sentiment %.",
                },
                {
                  value: "advanced",
                  label: "Advanced",
                  desc: "Everything — RSI/MACD/Bollinger, full fundamentals, Form 4 trail.",
                },
              ] as const).map((opt) => {
                const active =
                  (profile.preferences.density ?? "basic") === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setProfile((p) => ({
                        ...p,
                        preferences: {
                          ...p.preferences,
                          density: opt.value,
                        },
                      }))
                    }
                    className={`flex flex-col items-start rounded-md border p-3 text-left text-sm transition-colors ${
                      active
                        ? "border-[var(--buy)]/40 bg-[var(--buy)]/5"
                        : "border-border hover:bg-accent/40"
                    }`}
                  >
                    <span className="font-medium">{opt.label}</span>
                    <span className="mt-1 text-xs text-muted-foreground">
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
```

- [ ] **Step 2: Typecheck + build**

```bash
./node_modules/.bin/tsc --noEmit
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/app/settings/settings-client.tsx
git commit -m "Settings: dashboard density selector (Basic / Standard / Advanced)

Three-way selector persisting to user_profile.preferences.density.
Defaults to Basic on profile creation. Only the UI changes — analyst
prompts still use the full warehouse data regardless.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.3: Tiered ticker card component

**Files:**
- Create: `src/components/dashboard/ticker-card.tsx`

- [ ] **Step 1: Write the component**

```typescript
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * Ticker card with three display tiers:
 *   - Basic: price, 52w range, P/E, div yield, analyst target, headline
 *   - Intermediate: +forward P/E, P/B, P/S, EV/EBITDA, 50d/200d MA, beta, sentiment
 *   - Advanced: +RSI, MACD, Bollinger, VWAP, rel-strength, full fundamentals
 *
 * Density prop controls the default tier; user can always expand via More.
 */

type Market = {
  close: number | null;
  changePct: number | null;
  peTrailing: number | null;
  peForward: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;
  dividendYield: number | null;
  epsTtm: number | null;
  high52w: number | null;
  low52w: number | null;
  ma50: number | null;
  ma200: number | null;
  beta: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  vwap20d: number | null;
  relStrengthSpy30d: number | null;
  analystTargetMean: number | null;
  analystCount: number | null;
  analystRating: string | null;
} | null;

type Sentiment = {
  bullishPct: number | null;
  bearishPct: number | null;
  buzzRatio: number | null;
} | null;

type Fundamentals = {
  revenue: number | null;
  netIncome: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  roe: number | null;
  debtToEquity: number | null;
  freeCashFlow: number | null;
} | null;

export type TickerCardDensity = "basic" | "standard" | "advanced";

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(2)}`;
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function pctRaw(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  return n.toFixed(digits);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

export default function TickerCard({
  ticker,
  market,
  sentiment,
  fundamentals,
  density = "basic",
}: {
  ticker: string;
  market: Market;
  sentiment: Sentiment;
  fundamentals: Fundamentals;
  density?: TickerCardDensity;
}) {
  // Start expanded based on density; user can still toggle further.
  const initialTier: TickerCardDensity = density;
  const [tier, setTier] = useState<TickerCardDensity>(initialTier);

  const showIntermediate = tier === "standard" || tier === "advanced";
  const showAdvanced = tier === "advanced";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between">
          <CardTitle className="font-mono text-base">{ticker}</CardTitle>
          {market?.changePct != null && (
            <span
              className={`font-mono text-xs ${
                market.changePct >= 0
                  ? "text-[var(--buy)]"
                  : "text-[var(--sell)]"
              }`}
            >
              {market.changePct >= 0 ? "+" : ""}
              {pctRaw(market.changePct)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {/* Basic tier */}
        <Row label="Price" value={money(market?.close)} />
        <Row
          label="52-wk range"
          value={
            market?.low52w != null && market.high52w != null
              ? `${money(market.low52w)} – ${money(market.high52w)}`
              : "—"
          }
        />
        <Row label="P/E (TTM)" value={fmt(market?.peTrailing)} />
        <Row label="Div yield" value={pct(market?.dividendYield)} />
        <Row label="Analyst target" value={money(market?.analystTargetMean)} />

        {/* Intermediate tier */}
        {showIntermediate && (
          <>
            <div className="my-2 h-px bg-border/60" />
            <Row label="P/E (Fwd)" value={fmt(market?.peForward)} />
            <Row label="P/B" value={fmt(market?.priceToBook)} />
            <Row label="P/S" value={fmt(market?.priceToSales)} />
            <Row label="EV/EBITDA" value={fmt(market?.evToEbitda)} />
            <Row label="50d MA" value={money(market?.ma50)} />
            <Row label="200d MA" value={money(market?.ma200)} />
            <Row label="Beta" value={fmt(market?.beta)} />
            <Row label="Bullish %" value={pct(sentiment?.bullishPct)} />
            <Row label="Bearish %" value={pct(sentiment?.bearishPct)} />
          </>
        )}

        {/* Advanced tier */}
        {showAdvanced && (
          <>
            <div className="my-2 h-px bg-border/60" />
            <Row label="RSI (14d)" value={fmt(market?.rsi14)} />
            <Row label="MACD" value={fmt(market?.macd, 4)} />
            <Row label="MACD signal" value={fmt(market?.macdSignal, 4)} />
            <Row
              label="Bollinger"
              value={
                market?.bollingerLower != null && market.bollingerUpper != null
                  ? `${money(market.bollingerLower)} – ${money(market.bollingerUpper)}`
                  : "—"
              }
            />
            <Row label="VWAP (20d)" value={money(market?.vwap20d)} />
            <Row
              label="RS vs SPY (30d)"
              value={pctRaw(market?.relStrengthSpy30d)}
            />
            <Row label="Revenue" value={money(fundamentals?.revenue)} />
            <Row
              label="Gross margin"
              value={pct(fundamentals?.grossMargin)}
            />
            <Row label="Net margin" value={pct(fundamentals?.netIncome != null && fundamentals?.revenue ? fundamentals.netIncome / fundamentals.revenue : null)} />
            <Row label="ROE" value={pct(fundamentals?.roe)} />
            <Row label="Debt/Equity" value={fmt(fundamentals?.debtToEquity)} />
            <Row label="Free cash flow" value={money(fundamentals?.freeCashFlow)} />
          </>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="mt-2 h-7 w-full text-[11px]"
          onClick={() =>
            setTier((t) =>
              t === "basic" ? "standard" : t === "standard" ? "advanced" : "basic"
            )
          }
        >
          {tier === "advanced" ? (
            <>
              <ChevronUp className="mr-1 h-3 w-3" />
              Collapse
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-3 w-3" />
              Show more
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
./node_modules/.bin/tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/ticker-card.tsx
git commit -m "Dashboard: TickerCard with Basic/Standard/Advanced tiers

Presentational component. Density prop sets initial tier; local state
lets user expand further. Basic shows 5 rows, Standard adds 9, Advanced
adds 11 more. No network / side-effects.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase 5 Acceptance

- [ ] **Acceptance: deploy + manual UI verification**

Deploy:
```bash
vercel --prod --scope mentisvision --yes
```

Sign in as demo user and visit:
```
https://clearpath-invest.vercel.app/app
```
Verify: new portfolio cards exist and default to Basic tier. Clicking "Show more" expands to Standard then Advanced, with content visible at each tier.

Visit Settings:
```
https://clearpath-invest.vercel.app/app/settings
```
Verify: Dashboard density section has three buttons. Clicking Advanced → Save → return to dashboard — cards now render Advanced by default.

SQL verification:
```sql
SELECT preferences FROM "user_profile"
WHERE "userId" = (SELECT id FROM "user" WHERE email = 'demo@clearpath.com');
```
Expected: preferences JSONB contains `density` key with chosen value.

---

## Phase 6 — Retention cron

Goal: Weekly job prunes expired rows and rolls up old granular data.

Acceptance: Manual trigger reports counts; Neon shows fewer rows where expected.

---

### Task 6.1: Retention cron route

**Files:**
- Create: `src/app/api/cron/warehouse-retention/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * Weekly retention sweep for warehouse tables.
 * Schedule: 0 3 * * 0 (Sunday 03:00 UTC).
 * Authorization: same Bearer $CRON_SECRET as the daily cron.
 *
 * Steps (all idempotent, pure SQL):
 *   1. Hard-delete sentiment rows older than 180 days.
 *   2. Delete past events older than 2 years.
 *   3. [Roll-ups deferred to later — see spec §9 Phase 6]
 *   4. Delete system_aggregate_daily daily rows older than 2 years.
 *      (Monthly rollup implementation deferred — note in output.)
 */
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron.retention", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const result: Record<string, unknown> = {};

  try {
    const r = await pool.query(
      `DELETE FROM "ticker_sentiment_daily"
       WHERE captured_at < CURRENT_DATE - INTERVAL '180 days'`
    );
    result.sentimentDeleted = r.rowCount ?? 0;
  } catch (err) {
    log.error("cron.retention", "sentiment prune failed", errorInfo(err));
    result.sentimentDeleted = { error: "failed" };
  }

  try {
    const r = await pool.query(
      `DELETE FROM "ticker_events"
       WHERE event_date < CURRENT_DATE - INTERVAL '730 days'`
    );
    result.eventsDeleted = r.rowCount ?? 0;
  } catch (err) {
    log.error("cron.retention", "events prune failed", errorInfo(err));
    result.eventsDeleted = { error: "failed" };
  }

  try {
    const r = await pool.query(
      `DELETE FROM "system_aggregate_daily"
       WHERE captured_at < CURRENT_DATE - INTERVAL '730 days'`
    );
    result.aggregatesDeleted = r.rowCount ?? 0;
  } catch (err) {
    log.error("cron.retention", "aggregates prune failed", errorInfo(err));
    result.aggregatesDeleted = { error: "failed" };
  }

  // Note: weekly/monthly roll-ups for ticker_market_daily are NOT yet
  // implemented. At current scale (days of data, not years), the daily
  // granular table is fine. Add the roll-up step here when the table
  // crosses ~1M rows or 2 years old, whichever first.
  result.marketRollupStatus = "deferred_until_scale";

  result.durationMs = Date.now() - started;
  log.info("cron.retention", "run complete", result);
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Typecheck**

```bash
./node_modules/.bin/tsc --noEmit
```

- [ ] **Step 3: Register in vercel.json**

Open `vercel.json` and extend the `crons` array. The existing file should look like:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/evaluate-outcomes",
      "schedule": "0 14 * * *"
    }
  ]
}
```

Add the new cron as a second entry:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/evaluate-outcomes",
      "schedule": "0 14 * * *"
    },
    {
      "path": "/api/cron/warehouse-retention",
      "schedule": "0 3 * * 0"
    }
  ]
}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/warehouse-retention/ vercel.json
git commit -m "Warehouse: weekly retention cron

New /api/cron/warehouse-retention route. Runs Sunday 03:00 UTC.
Hard-deletes sentiment rows >180d, events >2y, system aggregates >2y.
Market-daily roll-up is deferred until scale justifies it (table is
still small; daily granularity is fine for now).

Authorization: same Bearer \$CRON_SECRET as the daily cron.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase 6 Acceptance

- [ ] **Acceptance: deploy + manual trigger**

Deploy:
```bash
vercel --prod --scope mentisvision --yes
```

Manually trigger (use the CRON_SECRET captured earlier):
```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://clearpath-invest.vercel.app/api/cron/warehouse-retention \
  --max-time 60 | python3 -m json.tool
```

Expected (first run after deploy, zero-ish deletes because data is fresh):
```json
{
  "sentimentDeleted": 0,
  "eventsDeleted": 0,
  "aggregatesDeleted": 0,
  "marketRollupStatus": "deferred_until_scale",
  "durationMs": N
}
```

Verify cron is registered for Sunday nights:
```bash
cat vercel.json
```
Expected: two entries in `crons` array, including `/api/cron/warehouse-retention`.

---

## Final Task — Documentation updates

**Files:**
- Modify: `AGENTS.md`
- Modify: `handoff/DEFERRED.md`

- [ ] **Step 1: Append warehouse rules to AGENTS.md**

Add a new section after the existing rule list in `AGENTS.md`:

```markdown
## Warehouse rules (ticker-keyed data layer)

8. **Never add a `userId` column to any warehouse table** (`ticker_market_daily`, `ticker_fundamentals`, `ticker_events`, `ticker_sentiment_daily`, `system_aggregate_daily`). Schema enforces privacy; any PR that adds one fails review.

9. **`getTickerUniverse()` is the ONLY code path that reads `holding.ticker` for warehouse purposes.** It's in `src/lib/warehouse/universe.ts` and returns `string[]` — never an object, never a userId. Callable only from the cron.

10. **App request handlers never write to warehouse tables.** Warehouse writes happen in the nightly cron only. App request handlers use typed readers from `src/lib/warehouse/*`.

11. **Research DATA block must tag provenance.** Warehouse-sourced fields are prefixed `[WAREHOUSE]`, live Yahoo fields `[LIVE]`. The zero-hallucination prompt rule already requires datum citation — the tag makes the source auditable.

12. **Warehouse is additive, not replacement.** Yahoo live calls still happen for current price + day change (freshness). Warehouse covers everything else.
```

- [ ] **Step 2: Update handoff/DEFERRED.md**

Append to the end of `handoff/DEFERRED.md`:

```markdown
---

## Warehouse follow-ups (after 2026-04-16 migration)

- **CoinGecko integration** — crypto pricing in `ticker_market_daily` with `source='coingecko'`. Currently crypto is skipped by `scanPriceMoves` because Yahoo coverage is unreliable. CoinGecko free tier: 10-30 req/min, no key required.
- **FINRA short-interest refresh** — bimonthly cron step writing `short_interest_pct`. The column exists but is never populated as of this migration.
- **Market-daily roll-ups** — weekly/monthly aggregation for rows >2y / >5y. Deferred until the table crosses ~1M rows or 2 years old, whichever comes first.
- **4-hour sentiment refresh during market hours** — currently nightly only. Add when we see demand for faster news-reaction alerts.
- **13F institutional ownership** — quarterly SEC filings. Interesting signal for whale positioning, low volume.
- **Monthly rollup for system_aggregate_daily** — delete-after-2y is in place; monthly rollups for older data would preserve trend views at lower volume.
- **Column-level ACL on `holding.ticker`** — spec §11 acceptance criterion 8. Separate Postgres role for cron writes with `SELECT (ticker)` privilege on `holding` and no other read access. Operational Neon setup rather than code; implement when engineering team grows beyond current trusted-operator model.
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md handoff/DEFERRED.md
git commit -m "Docs: warehouse rules in AGENTS.md + follow-ups in DEFERRED.md

5 new hard rules codifying the privacy boundary:
  - No userId in warehouse tables
  - getTickerUniverse is the single privacy boundary
  - App handlers never write to warehouse
  - Research DATA block tags provenance ([WAREHOUSE] / [LIVE])
  - Warehouse is additive, not replacement

Deferred follow-ups: CoinGecko, FINRA short interest, market rollups,
4-hour sentiment refresh, 13F filings, monthly aggregate rollups.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

Running checks against the spec with fresh eyes.

**1. Spec coverage:**
- §4.1 ticker_market_daily → Task 1.1 (schema), 2.3 (refresh), 1.4 (reader) ✓
- §4.2 ticker_fundamentals → Task 1.1, 2.4, 1.5 ✓
- §4.3 ticker_events → Task 1.1, 2.5, 1.5 ✓
- §4.4 ticker_sentiment_daily → Task 1.1, 2.6, 1.5 ✓
- §4.5 system_aggregate_daily → Task 1.1, 2.7, 1.5 ✓
- §5 cron structure → Task 2.8 (orchestrator + step 8), 6.1 (retention) ✓
- §6 read API → Tasks 1.4, 1.5 ✓
- §7 UX tiers → Tasks 5.1, 5.2, 5.3 ✓
- §8 privacy enforcement → Task 1.3 (universe), Task 1.1 Step 4 (schema assertion), Final Task (AGENTS.md rules) ✓
- §9 migration phases 1-6 → Phases 1-6 of the plan ✓
- §10 non-goals → explicitly deferred in DEFERRED.md update ✓
- §11 success criteria — 10 items enumerated in spec:
  - (1) 5 tables exist, no userId — Phase 1 acceptance ✓
  - (2) getTickerUniverse is sole reader — Task 1.3 + AGENTS.md rule ✓
  - (3) Dashboard widgets read warehouse — Task 3.3 + Phase 5 ✓
  - (4) scanPriceMoves reads warehouse — Task 3.2 ✓
  - (5) Analyst prompts cite warehouse — Task 4.1 ✓
  - (6) system_aggregate_daily seeded — Task 2.7 + Phase 2 acceptance ✓
  - (7) Density preference round-trips — Task 5.1, 5.2, 5.3 ✓
  - (8) Postgres role audit — **GAP** — plan doesn't implement column-level role ACLs. This is flagged as "preferred" in spec §8 (#4). Recommendation: leave as DEFERRED.md entry because column-level ACL setup on Neon is a separate ops task.
  - (9) Retention cron runs weekly — Task 6.1 ✓
  - (10) Grep confirms no warehouse + user JOIN — achievable by convention + Task 1.3 boundary ✓

One acceptance criterion (column-level ACL) is deferred to DEFERRED.md. Adding a note to the Final Task update so it's not silently skipped.

**2. Placeholder scan:** No TBDs, TODOs, or "implement later" without corresponding deferred entries. All tasks have executable code/commands.

**3. Type consistency:**
- `TickerMarketRow` referenced in Task 1.2, 1.4 ✓ (same shape)
- `getTickerMarket` signature consistent across Task 1.4 (definition), Task 3.1 (caller), Task 4.1 (caller) ✓
- `getTickerMarketBatch` defined Task 1.4, used Task 3.2 (dynamic import), Task 4.2 (dynamic import) ✓
- `refreshWarehouse()` return type defined in Task 2.8, consumed in Phase 2 acceptance ✓
- `DashboardDensity` defined Task 5.1, used Task 5.2 (via type inference), used Task 5.3 as `TickerCardDensity` (consistent value space: "basic" | "standard" | "advanced") ✓

**4. Scope check:** The plan is ambitious but decomposed. Each phase ends at a natural shipping point. Phase 1-2 add new infrastructure without changing behavior. Phase 3 migrates low-risk readers. Phase 4 touches the money-making path (research) with explicit rollback semantics (warehouse miss → Yahoo fallback). Phase 5 is pure UX. Phase 6 is ops housekeeping. Good separation.

**Fixing inline: §11 criterion 8 (column-level ACL) deferred, added to DEFERRED.md patch.**

Updating the Final Task Step 2 DEFERRED.md append above — already present under the warehouse follow-ups heading (I'll add one more line):

Insert this line in the DEFERRED.md append:

```
- **Column-level ACL on holding.ticker** — spec §11 acceptance criterion 8. Separate Postgres role for cron writes with `SELECT (ticker)` privilege on `holding` and no other read access. Operational setup rather than code; tracked separately.
```

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-16-ticker-data-warehouse-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
