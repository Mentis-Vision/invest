# Ticker Data Warehouse — Design

**Status:** Draft, pending review
**Date:** 2026-04-16
**Scope:** Anonymized, ticker-keyed data layer powering dashboard, alerts, research, and future analytics. Zero per-user data retained in the warehouse.

---

## 1. Summary

Build a domain-split, ticker-keyed data warehouse that centralizes public market data so every feature (dashboard widgets, overnight alerts, research prompts, backtesting) reads from one source of truth instead of hitting Yahoo/SEC/FRED/Finnhub per request.

Key properties:

- **Zero userId, zero email, zero PII in any warehouse table.** Schema enforces this by simply not having the columns.
- **Overnight cron populates the warehouse without storing user-specific data.** The cron reads `holding.ticker` (column-level access only) to derive the universe of tickers to refresh — the ticker set is transient, never persisted alongside user identity.
- **App handlers read warehouse first, fall back to live sources on miss or when freshness matters.** Write-back on miss grows the warehouse organically.
- **Storage retention is per-table** and matches each domain's natural cadence.

---

## 2. Threat model

We are designing against three exposure scenarios, in order of likelihood:

1. **Database compromise** — attacker obtains a read-only copy of Postgres. If they breach only warehouse tables, they learn only public market data (prices, SEC filings, public news). The sensitive `holding` / `recommendation` / `user` / `snaptrade_user` tables remain separately scoped.
2. **Legal compulsion** — subpoena asks "what does user X hold?" The warehouse cannot answer; it has no user dimension. Only the already-sensitive `holding` table can answer, which is the intended audit surface.
3. **Insider threat** — an engineer with broad DB access. Column-level ACLs on `holding.ticker` + absence of userId in warehouse tables make accidental PII leakage into the overnight layer infeasible.

The ticker universe itself is slightly sensitive in aggregate (an obscure ticker appearing in the universe reveals *someone* holds or has researched it). Mitigation: the universe is never exported or persisted outside the cron's in-memory scope; the warehouse tables store market data keyed by ticker, not "which tickers our users care about."

---

## 3. Architecture

```
                    ┌─────────────────────────────────────────┐
                    │ Free external sources                   │
                    │   Yahoo Finance · SEC EDGAR · FRED ·    │
                    │   Finnhub (optional) · CoinGecko (later)│
                    └───────────────────┬─────────────────────┘
                                        │
                                        ▼
         ┌──────────────────────────────────────────────────────┐
         │ Nightly cron (extends /api/cron/evaluate-outcomes)   │
         │                                                      │
         │   getTickerUniverse(): string[]                      │
         │     ↳ SELECT ticker FROM holding                     │
         │       (column-level ACL; no userId read)             │
         │                                                      │
         │   Per-domain refresh steps, each writes one table    │
         └────┬──────┬──────┬──────────┬────────────────┬───────┘
              │      │      │          │                │
              ▼      ▼      ▼          ▼                ▼
      ┌────────────┐ ┌──────────┐ ┌─────────┐ ┌────────────────┐ ┌──────────────────┐
      │ticker_     │ │ticker_   │ │ticker_  │ │ticker_         │ │system_aggregate  │
      │market_     │ │fundamen- │ │events   │ │sentiment_daily │ │_daily            │
      │daily       │ │tals      │ │         │ │                │ │(anonymized)      │
      │(OHLC+val+  │ │(income/  │ │(earn/   │ │(news counts,   │ │(counts by model, │
      │ technicals)│ │balance/  │ │ splits/ │ │ bull/bear %,   │ │ sector, kind —   │
      │            │ │ cashflow)│ │ filings)│ │ buzz, score)   │ │ no userId)       │
      └─────┬──────┘ └────┬─────┘ └────┬────┘ └───────┬────────┘ └─────────┬────────┘
            │             │            │              │                    │
            └─────────────┴────────────┴──────────────┴────────────────────┘
                                        │
                                        ▼
                          ┌─────────────────────────────┐
                          │ src/lib/warehouse.ts        │
                          │   typed readers only        │
                          │   (no raw SQL in callers)   │
                          └─────────────┬───────────────┘
                                        │
                                        ▼
                ┌────────────────────────────────────────────┐
                │ App request handlers (auth-gated, user-    │
                │ scoped). Join warehouse ∪ holding at       │
                │ request time, in memory, never persisted.  │
                │                                            │
                │   /api/research, /api/alerts, dashboard,   │
                │   /api/portfolio-review, etc.              │
                └────────────────────────────────────────────┘
```

Data direction is strictly one-way: external sources → cron → warehouse → app readers. Warehouse tables are never written to from request handlers (except the opportunistic write-back on miss, which still writes only ticker-keyed data).

---

## 4. Tables — full column specs

### 4.1 `ticker_market_daily`

**Purpose:** Daily time-series of all fields that move intraday or daily. Source of truth for price-context-heavy queries.

**Retention:** 2 years daily granular → roll to weekly bars after 2y → monthly after 5y. Weekly/monthly rolls preserve OHLCV + close-based derivatives; daily-only technical indicators (RSI, MACD, Bollinger) are not retained on the weekly/monthly rolls.

```sql
CREATE TABLE "ticker_market_daily" (
  ticker                 TEXT NOT NULL,
  captured_at            DATE NOT NULL,
  as_of                  TIMESTAMP NOT NULL DEFAULT NOW(),
  source                 TEXT NOT NULL DEFAULT 'yahoo',  -- 'yahoo' | 'coingecko'

  -- OHLCV
  open                   NUMERIC(14,4),
  high                   NUMERIC(14,4),
  low                    NUMERIC(14,4),
  close                  NUMERIC(14,4),
  volume                 BIGINT,
  change_pct             NUMERIC(8,4),

  -- Smoothed
  ma_50                  NUMERIC(14,4),
  ma_200                 NUMERIC(14,4),
  bollinger_upper        NUMERIC(14,4),
  bollinger_lower        NUMERIC(14,4),
  vwap_20d               NUMERIC(14,4),

  -- Range & risk
  high_52w               NUMERIC(14,4),
  low_52w                NUMERIC(14,4),
  beta                   NUMERIC(6,3),

  -- Valuation
  market_cap             BIGINT,
  pe_trailing            NUMERIC(10,3),
  pe_forward             NUMERIC(10,3),
  price_to_book          NUMERIC(10,3),
  price_to_sales         NUMERIC(10,3),
  ev_to_ebitda           NUMERIC(10,3),
  dividend_yield         NUMERIC(8,5),  -- decimal, not percent
  eps_ttm                NUMERIC(12,4),

  -- Technicals
  rsi_14                 NUMERIC(6,2),
  macd                   NUMERIC(10,4),
  macd_signal            NUMERIC(10,4),
  rel_strength_spy_30d   NUMERIC(8,4),

  -- Analyst consensus
  analyst_target_mean    NUMERIC(14,4),
  analyst_count          INT,
  analyst_rating         TEXT,

  -- Optional (bimonthly from FINRA)
  short_interest_pct     NUMERIC(6,4),

  PRIMARY KEY (ticker, captured_at)
);
CREATE INDEX "ticker_market_daily_date_idx"
  ON "ticker_market_daily" (captured_at DESC);
```

All numeric fields nullable — absence ≠ error, just means that field was unavailable at capture time.

### 4.2 `ticker_fundamentals`

**Purpose:** Quarterly and annual financial statements, refreshed when a new 10-Q / 10-K filing becomes available.

**Retention:** Unbounded. Low row volume (~4 quarterlies + 1 annual × tickers × years). No reason to age out.

```sql
CREATE TABLE "ticker_fundamentals" (
  ticker                 TEXT NOT NULL,
  period_ending          DATE NOT NULL,
  period_type            TEXT NOT NULL,  -- 'quarterly' | 'annual'
  filing_accession       TEXT,
  reported_at            DATE,
  as_of                  TIMESTAMP NOT NULL DEFAULT NOW(),
  source                 TEXT NOT NULL DEFAULT 'yahoo',

  -- Income statement
  revenue                BIGINT,
  gross_profit           BIGINT,
  operating_income       BIGINT,
  net_income             BIGINT,
  ebitda                 BIGINT,
  eps_basic              NUMERIC(12,4),
  eps_diluted            NUMERIC(12,4),

  -- Balance sheet (end of period)
  total_assets           BIGINT,
  total_liabilities      BIGINT,
  total_equity           BIGINT,
  total_debt             BIGINT,
  total_cash             BIGINT,
  shares_outstanding     BIGINT,

  -- Cash flow
  operating_cash_flow    BIGINT,
  free_cash_flow         BIGINT,
  capex                  BIGINT,

  -- Derived ratios (computed on write)
  gross_margin           NUMERIC(8,5),
  operating_margin       NUMERIC(8,5),
  net_margin             NUMERIC(8,5),
  roe                    NUMERIC(8,5),
  roa                    NUMERIC(8,5),
  current_ratio          NUMERIC(8,3),
  debt_to_equity         NUMERIC(8,3),

  PRIMARY KEY (ticker, period_ending, period_type)
);
CREATE INDEX "ticker_fundamentals_ticker_idx"
  ON "ticker_fundamentals" (ticker, period_ending DESC);
```

Ratios are denormalized (computed once on insert) because they're used in many read paths and the inputs rarely change after filing.

### 4.3 `ticker_events`

**Purpose:** Calendar events — earnings dates, dividend ex-dates, splits, material SEC filings, guidance, conferences.

**Retention:** Past events deleted after 2y (covers the 1-year-out outcome eval window comfortably). Upcoming events retained until they become past and then age out.

```sql
CREATE TABLE "ticker_events" (
  id                     TEXT PRIMARY KEY,
  ticker                 TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  event_date             DATE NOT NULL,
  event_time             TIMESTAMP,  -- nullable; precise timing when known
  details                JSONB NOT NULL DEFAULT '{}',
  source                 TEXT NOT NULL,
  as_of                  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX "ticker_events_ticker_date_idx"
  ON "ticker_events" (ticker, event_date DESC);
CREATE INDEX "ticker_events_date_idx"
  ON "ticker_events" (event_date DESC);
CREATE INDEX "ticker_events_type_date_idx"
  ON "ticker_events" (event_type, event_date DESC);
CREATE UNIQUE INDEX "ticker_events_dedup_uniq"
  ON "ticker_events" (
    ticker, event_type, event_date, (details->>'dedupKey')
  )
  WHERE details->>'dedupKey' IS NOT NULL;
```

`event_type` values (enforced in code, not DB enum — easier to extend):

- `earnings` — scheduled earnings release
- `dividend_ex` — ex-dividend date
- `dividend_pay` — pay date
- `split` — stock split
- `filing_8k` — 8-K material event
- `filing_10q` — 10-Q quarterly report
- `filing_10k` — 10-K annual report
- `guidance` — guidance update
- `conference` — investor day / analyst conference
- `other`

`details` JSONB shapes (documented here, not DB-enforced):

- `earnings`: `{eps_estimate, eps_actual?, revenue_estimate, revenue_actual?, time_of_day?}`
- `dividend_ex`: `{amount, frequency, payable_date}`
- `split`: `{ratio}` — e.g. `"3:1"`
- `filing_*`: `{accession, item_types, summary_short}`

### 4.4 `ticker_sentiment_daily`

**Purpose:** Aggregated news sentiment per ticker. Primary source: Finnhub (when configured). Secondary sources (Reddit, Stocktwits) may blend into the same row over time with `source='multi'`.

**Retention:** 180 days, hard delete afterward. Shorter retention honors upstream licensing caution (free news APIs generally allow short-term caching, not archival) and matches the decay rate of sentiment signal.

```sql
CREATE TABLE "ticker_sentiment_daily" (
  ticker                 TEXT NOT NULL,
  captured_at            DATE NOT NULL,
  as_of                  TIMESTAMP NOT NULL DEFAULT NOW(),
  source                 TEXT NOT NULL DEFAULT 'finnhub',

  news_count             INT NOT NULL DEFAULT 0,
  bullish_pct            NUMERIC(6,4),
  bearish_pct            NUMERIC(6,4),
  neutral_pct            NUMERIC(6,4),
  buzz_ratio             NUMERIC(8,3),           -- news_count / baseline
  company_news_score     NUMERIC(6,4),           -- provider-specific -1..+1
  sector_avg_score       NUMERIC(6,4),

  top_headlines          JSONB,                  -- cap 5 items

  PRIMARY KEY (ticker, captured_at)
);
CREATE INDEX "ticker_sentiment_daily_date_idx"
  ON "ticker_sentiment_daily" (captured_at DESC);
```

`top_headlines` shape: `[{title, url, source, published_at}, ...]`.

### 4.5 `system_aggregate_daily`

**Purpose:** Anonymized operational metrics. **Explicitly contains no userId, email, IP, or any other user-scoped data.** Schema-enforced by the absence of these columns.

**Retention:** 2 years daily → monthly rollups after. Monthly rollups retained indefinitely (small row volume, useful for long-term trend review).

```sql
CREATE TABLE "system_aggregate_daily" (
  captured_at            DATE NOT NULL,
  metric_name            TEXT NOT NULL,
  dimension              TEXT,                   -- nullable: NULL means global
  value_numeric          NUMERIC(18,4),
  value_json             JSONB,
  as_of                  TIMESTAMP NOT NULL DEFAULT NOW(),

  PRIMARY KEY (captured_at, metric_name, COALESCE(dimension, ''))
);
CREATE INDEX "system_aggregate_daily_metric_idx"
  ON "system_aggregate_daily" (metric_name, captured_at DESC);
```

Initial metric_name values seeded by the nightly cron:

| `metric_name` | `dimension` | Meaning |
|---|---|---|
| `recs.total` | NULL | Total recommendations produced that day |
| `recs.by_rec` | `BUY` / `HOLD` / `SELL` / `INSUFFICIENT_DATA` | Distribution |
| `recs.by_sector` | sector name | Distribution by underlying sector |
| `analyst.total_calls` | model name | API calls to each analyst |
| `analyst.success_rate` | model name | Fraction of non-failed calls |
| `analyst.avg_tokens` | model name | Mean tokens per call |
| `supervisor.fast_path_share` | NULL | Fraction of verdicts hitting panel-consensus |
| `alerts.created` | alert kind | New alerts emitted |
| `alerts.active` | alert kind | Not-yet-dismissed count (snapshot) |
| `waitlist.new_signups_daily` | NULL | New waitlist signups |
| `waitlist.total_size` | NULL | Cumulative waitlist |

---

## 5. Cron structure

Extends the existing `/api/cron/evaluate-outcomes` (runs 14:00 UTC, already authorized via `CRON_SECRET`). New steps, each wrapped in its own try/catch so one failure doesn't block others:

```
1. [existing] SnapTrade trade sync
2. [existing] Trade → recommendation linking
3. [existing] Outcome evaluation (7d/30d/90d/1y windows)
4. [existing] Portfolio value snapshot
5. [existing] Macro snapshot (FRED)
6. [existing] Alert generators (price / insider / concentration)
7. [existing] Top-25 trending-ticker prewarm
8. [NEW] Warehouse refresh — market_daily   — full universe
9. [NEW] Warehouse refresh — events         — earnings + filings sweep
10. [NEW] Warehouse refresh — sentiment      — Finnhub if configured
11. [NEW] Warehouse refresh — fundamentals   — tickers with new filings since last run
12. [NEW] System aggregate rollup (derived from other tables — purely SQL)
13. [NEW, weekly] Retention sweep — separate cron entry
```

Fundamentals is incremental (only tickers whose latest filing accession differs from what's in `ticker_fundamentals`). Events and sentiment are daily. Market-daily is daily for the full universe.

Universe construction happens once per cron run at the top of step 8, shared across 9–12. Signature:

```ts
// src/lib/warehouse/universe.ts
export async function getTickerUniverse(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ticker FROM "holding"`  // column-level ACL enforces: ticker only
  );
  return rows.map(r => r.ticker as string);
  // Note: no user dimension ever leaves this function.
}
```

### Retention cron (new, weekly)

Runs once a week (e.g., Sunday 03:00 UTC). Cheap SQL:

```
1. DELETE FROM ticker_sentiment_daily WHERE captured_at < CURRENT_DATE - 180
2. Roll ticker_market_daily rows >2y to weekly, rows >5y to monthly
3. DELETE FROM ticker_events WHERE event_date < CURRENT_DATE - 730
4. Roll system_aggregate_daily rows >2y to monthly
```

Registered in `vercel.json` as `{ path: '/api/cron/warehouse-retention', schedule: '0 3 * * 0' }`.

---

## 6. Read API — `src/lib/warehouse.ts`

Callers never write raw SQL to warehouse tables. Typed readers only:

```ts
// src/lib/warehouse.ts

export type TickerMarket = { /* typed row from ticker_market_daily */ };
export type TickerFundamentals = { /* typed row from ticker_fundamentals */ };
export type TickerEvent = { /* typed row from ticker_events */ };
export type TickerSentiment = { /* typed row from ticker_sentiment_daily */ };

// Most recent row for ticker; null if never captured
export async function getTickerMarket(
  ticker: string
): Promise<TickerMarket | null>;

// Most recent fundamental snapshot for ticker, optionally filtered by period_type
export async function getTickerFundamentals(
  ticker: string,
  opts?: { periodType?: 'quarterly' | 'annual' }
): Promise<TickerFundamentals | null>;

// Upcoming events for ticker, default window = 90 days forward
export async function getUpcomingEvents(
  ticker: string,
  opts?: { windowDays?: number; types?: EventType[] }
): Promise<TickerEvent[]>;

// Past events for ticker, default window = 180 days back
export async function getRecentEvents(
  ticker: string,
  opts?: { windowDays?: number; types?: EventType[] }
): Promise<TickerEvent[]>;

// Most recent sentiment snapshot for ticker
export async function getTickerSentiment(
  ticker: string
): Promise<TickerSentiment | null>;

// Bulk fetcher — used by portfolio review + dashboard summary
export async function getTickerMarketBatch(
  tickers: string[]
): Promise<Map<string, TickerMarket>>;

// Write-back on miss — called from request handlers when warehouse lookup
// returns null for a ticker. Fetches live, writes to warehouse, returns value.
// Non-blocking from the caller's perspective — returns the value immediately,
// writes to warehouse in the background via waitUntil.
export async function warmTickerMarket(ticker: string): Promise<TickerMarket>;
```

### Integration with existing code

Gradual migration (Option II — warehouse-first, Yahoo-fallback):

| Caller | Before | After |
|---|---|---|
| Research DATA block | `getStockSnapshot()` (Yahoo live) | Warehouse for valuation/technicals/analyst-consensus; Yahoo live for current price + day change |
| `scanPriceMoves` (alert cron) | Yahoo `quote()` per ticker | `getTickerMarket(ticker)` — yesterday's close vs. holding `lastPrice` |
| Outcome evaluator | Yahoo `quote()` per ticker at check time | `getTickerMarket(ticker)` — today's close |
| Portfolio review prompt | Yahoo `quoteSummary` per holding | Batched warehouse read |
| Dashboard widgets | Various direct fetches | Warehouse-backed API routes |
| `ticker_metadata` (slow-changing ref) | Unchanged | Unchanged; warehouse complements it |

---

## 7. UX — tiered display

The warehouse stores everything. The UI reveals progressively.

| Tier | Default behavior | Fields visible on ticker cards / research verdict |
|---|---|---|
| **Basic** | Default for all new users | Price, day change, 52-wk range, market cap, P/E (trailing), dividend yield, analyst consensus (target + rating), top 3 headlines, next earnings date, insider activity count, concentration flag |
| **Intermediate** | Click "More" on any card → in-place expand | + Forward P/E, P/B, P/S, EV/EBITDA, 50d/200d MA, beta, bull/bear sentiment %, sector/industry, buzz ratio |
| **Advanced** | Opt-in via `Settings → Dashboard density` | + RSI, MACD, Bollinger, VWAP, relative strength vs SPY, full fundamentals (revenue / margins / debt), QoQ deltas, short interest %, full Form 4 trail |

Density preference stored in `user_profile.preferences.density ∈ { 'basic' | 'standard' | 'advanced' }`. Default `'basic'` on profile creation.

**Research analysis quality is independent of UI tier.** The analyst prompt's DATA block always uses the full warehouse content. Hiding fields from the UI does not hide them from the analysts.

---

## 8. Privacy enforcement mechanics

1. **Schema boundary.** No warehouse table declares a `userId` column. Any PR adding one must justify it in writing during code review or be rejected.

2. **Code boundary.** `src/lib/warehouse.ts` readers return typed shapes; no raw SQL outside this module touches warehouse tables. This makes privacy review grep-able.

3. **Function boundary.** `getTickerUniverse()` returns `string[]` — an array, never an object. The overnight cron literally cannot call `getTickerUniverse().then(users => ...)` because there are no users in the return.

4. **DB role boundary (preferred).** A separate Postgres role for cron writes with:
   - `SELECT (ticker)` on `holding` (column-level — not a full row read)
   - Full read/write on warehouse tables
   - No SELECT on `user`, `session`, `account`, `recommendation.analysisJson`, `snaptrade_user`, etc.

   App-request handlers use the existing pool role, which has SELECT on warehouse tables but cannot modify them.

5. **Audit rule.** Weekly scheduled check (can run as a CI step or part of the retention cron): grep the cron codebase for any import of user-scoped helpers (`getUserProfile`, `getUserHistory`, etc.). Any match is an accidental user-data pull into the overnight path — must be reviewed and justified.

6. **Breach-scenario statement** (for privacy policy / DEFERRED.md):
   > "Our overnight data refresh process has access only to the ticker column of user holdings, and stores no user identity in the resulting data layer. A breach of that data layer would reveal only publicly-available market data."

---

## 9. Migration order

Ship in phases so Tier B (already deployed) keeps working throughout.

### Phase 1 — schema + read helpers (no behavior change)
1. Migrate: create the 5 tables + indexes.
2. Add `src/lib/warehouse.ts` with readers + stub write paths.
3. Add `src/lib/warehouse/universe.ts` with `getTickerUniverse()`.
4. **No callers migrated yet.** System runs identically to today.
5. Ship. Verify tables exist, readers compile.

### Phase 2 — cron populates warehouse (write-only for validation)
1. Add cron steps 8–12 to `/api/cron/evaluate-outcomes`.
2. Let them run for 1–2 nights.
3. Verify data quality in Neon (row counts, sample values, no bad data).
4. **No readers wired yet.** App still hits Yahoo directly.
5. Ship.

### Phase 3 — migrate read paths, lowest-risk first
1. **Outcome evaluator** → warehouse (tolerates stale, offline-safe).
2. **Alert `scanPriceMoves`** → warehouse.
3. **Dashboard widgets** → warehouse-backed endpoints.
4. Ship after each, verify no regressions, move to next.

### Phase 4 — research pipeline migration (highest care)
1. Analyst prompt DATA block splits into "live" (current price, day change) + "warehouse" (valuation, technicals, consensus).
2. Portfolio review batch-reads warehouse.
3. Verdict quality monitored via `system_aggregate_daily` metrics for one week before calling done.

### Phase 5 — UX tiering + density preference
1. Add `user_profile.preferences.density` handling.
2. Ticker cards render by tier.
3. Settings page exposes density selector.
4. Ship.

### Phase 6 — retention cron
1. Add `/api/cron/warehouse-retention`, register in `vercel.json`.
2. Run once manually to verify behavior.
3. Let it run weekly.

---

## 10. Non-goals / explicitly deferred

- **Real-time market data (intraday price streams).** Warehouse is daily. Research still hits Yahoo live for current price.
- **Options chains, unusual options activity.** Premium data only.
- **Per-user portfolio optimization or backtesting.** Would require user-ticker mapping in the overnight path — violates threat model.
- **Pre-generating AI research overnight.** Cost-prohibitive and violates the "AI only on user click" principle.
- **Institutional ownership / 13F.** Potentially interesting but low-frequency (quarterly) — add later if demand emerges.
- **CoinGecko integration for crypto.** Deferred; `source='coingecko'` slot reserved in `ticker_market_daily` for when it lands.
- **Bimonthly FINRA short-interest refresh.** Acknowledged but out of Phase 1 — the `short_interest_pct` column is reserved and populated later.
- **Email digests / push notifications.** Would require queueing user-ticker pairs — violates threat model. Surfaced via on-device dashboard only.
- **Cross-user aggregations beyond the `system_aggregate_daily` set.** Anything not in the seeded metric list must go through a design review.

---

## 11. Success criteria / acceptance tests

The design is successfully implemented when:

1. The five warehouse tables exist, populated by the nightly cron, with no `userId` columns.
2. `getTickerUniverse()` is the only code path that reads `holding.ticker`, is callable only from the cron, and returns `string[]`.
3. Dashboard widgets read from warehouse-backed endpoints; first paint does not call Yahoo at all.
4. `scanPriceMoves` reads from warehouse instead of hitting Yahoo per ticker.
5. Analyst prompts cite warehouse-sourced fields for all non-realtime claims (valuation, technicals, fundamentals, consensus).
6. `system_aggregate_daily` has rows seeded for each of the initial metric names and renders on the admin metrics endpoint.
7. Density preference round-trips through settings and affects UI without affecting research quality.
8. A Postgres role audit confirms the cron role has column-level access on `holding.ticker` only.
9. Retention cron runs weekly and produces expected row deletions / rollups.
10. A code-grep confirms no warehouse table is referenced with `JOIN user` or `WHERE userId = ...` anywhere.

---

## Appendix A — diff against existing tables

| Table | Keeps existing | Interacts with warehouse |
|---|---|---|
| `user`, `session`, `account` (BetterAuth) | ✓ | No |
| `holding` | ✓ | Cron reads `ticker` column only |
| `recommendation`, `recommendation_outcome` | ✓ | Outcome evaluator migrates to warehouse reads |
| `ticker_metadata` (sector/industry/assetClass) | ✓ | Kept as slow-changing reference; complements warehouse |
| `macro_daily_snapshot` | ✓ | Already ticker-free; stays outside warehouse formally but same spirit |
| `alert_event` | ✓ (userId OK here — alerts are user-owned) | Alerts generator reads warehouse instead of Yahoo |
| `auth_event`, `snaptrade_user`, `snaptrade_connection` | ✓ | No touch |
| `waitlist` | ✓ | `waitlist.total_size` / `.new_signups_daily` surfaced via system_aggregate_daily |
| `rate_limit`, `price_snapshot`, `user_profile`, `trade`, `plaid_item` (if still referenced) | ✓ | No touch |

The warehouse adds five new tables; no existing tables change shape except for the preference JSONB gaining a `density` key.

---

## Appendix B — open questions for implementation

These are questions the implementation plan needs to answer but the design doesn't need to commit to yet:

- Batch size for `getTickerMarketBatch` — single query with `WHERE ticker = ANY($1)` or chunked? Start single, revisit at scale.
- Write-back on miss — synchronous (blocks the request on a Yahoo call) or async via `after()`? Async is preferable but needs testing on Vercel.
- Technical indicators (RSI, MACD, Bollinger) — compute in SQL, in Node, or pull from a third-party? Start Node (existing `yahoo-finance2` has `chart()` for historical OHLC; compute indicators locally with a tiny library or hand-rolled). Migrate to SQL later if a bottleneck.
- Fundamentals source — Yahoo covers most common tickers but gaps exist. Fall back to SEC XBRL parsing? Defer — get baseline working first.
- Sentiment refresh cadence — nightly is fine but news moves faster. Consider 4-hour refresh during market hours as a Phase 5 optimization.
