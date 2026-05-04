# Phase 10 — Broker Transaction History Backfill — Design Spec

**Date:** 2026-05-04
**Author:** Sang Lippert (with Claude Opus 4.7)
**Status:** Approved for implementation planning
**Research basis:** `docs/superpowers/research/2026-05-04-phase-10-broker-history-backfill.md` (commit `3779bac`)

---

## 1. Problem

Phase 9 shipped a performance chart with range buttons (30D/YTD/1Y/2Y/3Y/5Y/MAX) that honors the trust tenet (AGENTS.md hard rule #13) by enabling buttons only when `portfolio_snapshot` data depth supports them. Today, that depth equals "how long the user has been with us" — typically 30-60 days for early users. Users see most range buttons disabled.

Brokers expose 18-24 months (Schwab up to 4 years) of transaction history through SnapTrade and Plaid. By ingesting that history and reconstructing daily portfolio values, we can extend the chart's effective range without violating the trust tenet — provided the reconstructed values are clearly distinguished from observed ones.

This phase ingests transaction history, reconstructs historical portfolio values, and extends the existing chart infrastructure to render them with explicit provenance.

---

## 2. Goals

1. **Ingest transaction history** from SnapTrade and Plaid, normalize to a canonical schema, store encrypted at the right granularity.
2. **Reconstruct daily portfolio values** for dates before our first live observation, using broker-reported transactions to walk current holdings backward.
3. **Extend Phase 9's performance chart** to render reconstructed history alongside observed history — clearly distinguished, never silently merged.
4. **Honor the trust tenet** — reconstructed dates are visibly marked as reconstructed; we never pretend they were observed live.
5. **Comply with GLBA + CCPA** — privacy policy updated concurrent with launch, user has self-service export and per-connection purge, breach notification commitment documented.

### Non-goals

- No new chart UI — reuse Phase 9 components verbatim, just feed them more data.
- No new analytical surfaces (no "year-over-year drawdown" tile or anything new — that's Phase 11+).
- No row-level security at the Postgres role layer — defer to a follow-up phase as defense-in-depth.
- No matview-based aggregation layer — defer until scale demands it.
- No EEA / GDPR support — explicitly out of scope (privacy policy still says "service not targeted to EEA").
- No transaction reconciliation against tax forms (1099-B) — that's adviser-tier territory; not v1.

---

## 3. Locked decisions (from brainstorm)

| Decision | Choice |
|---|---|
| User consent model | **Auto-backfill** — existing OAuth scope already authorizes transaction reads. Privacy policy disclosure substitutes for explicit opt-in. |
| Phase scope | **One unified phase** — schema, encryption, cron, chart integration, user control surface, and privacy policy all merge together. |
| Privacy policy timing | **Concurrent with launch** — same merge that introduces data collection updates the policy. |
| Chart integration approach | **B · Reuse `portfolio_snapshot` with `source` discriminator column** — no chart code changes; reconstructed rows flow through Phase 9's existing `/api/track-record` route. |
| Initial backfill scope | **B · One-time sweep** — migration enqueues backfill for all existing user-connections (~50 users at current scale). |

---

## 4. Architecture

```
┌─ Trigger sources ────────────────────────────────────────────┐
│                                                              │
│  1. SnapTrade webhook (CONNECTION_ADDED)                     │
│     → POST /api/snaptrade/webhook (existing)                 │
│  2. Plaid webhook (HISTORICAL_UPDATE)                        │
│     → POST /api/plaid/webhook (existing)                     │
│  3. One-time migration sweep (all existing connections)      │
│     → SQL INSERT into broker_history_queue                   │
│  4. 6-hourly delta cron (catches new + corrected txns)       │
│     → /api/cron/broker-history-sync                          │
│  5. Quarterly reconciliation cron                            │
│     → /api/cron/broker-history-reconcile                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Worker: backfillConnection(userId, accountId, source) ──────┐
│  1. Pull full available transaction history via SnapTrade    │
│     listActivities() OR Plaid investmentsTransactionsGet()   │
│  2. Normalize broker types → canonical action                │
│  3. Encrypt raw_json (broker memos may contain free-text)    │
│     using existing SNAPTRADE_ENCRYPTION_KEY envelope         │
│  4. UPSERT into broker_transactions (UNIQUE source+ext_id)   │
│  5. Compute earliest_txn_date, log to admin telemetry        │
│  6. Trigger reconstructHistoricalSnapshots(userId, accId)    │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Reconstruction worker ──────────────────────────────────────┐
│  1. Read current holdings + cash for the account             │
│  2. Walk transactions backward by date:                      │
│     - For each buy: subtract shares (or remove if size 0)    │
│     - For each sell: add shares back                          │
│     - Splits: reverse the multiplier                          │
│     - Dividends: add cash back to running balance             │
│     - Etc. (canonical action coverage)                        │
│  3. At each historical date, compute total value:             │
│     SUM(shares * close_price from ticker_market_daily)        │
│     + cash_balance                                            │
│  4. INSERT INTO portfolio_snapshot                            │
│       (userId, capturedAt, totalValue, source='reconstructed')│
│     ON CONFLICT (userId, capturedAt) DO NOTHING               │
│     (NEVER overwrites source='observed' rows)                 │
│  5. Stop at the day BEFORE the earliest observed snapshot.    │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ Phase 9's existing chart pipeline ──────────────────────────┐
│  /api/track-record reads portfolio_snapshot unchanged.       │
│  supportedRanges grows automatically as reconstructed rows   │
│  push oldestSnapshotDate further back in time.               │
│  UI: chart renders reconstructed range with subtle visual    │
│  treatment (dashed line OR 70% opacity) so users can see     │
│  what was observed vs reconstructed.                         │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Data layer

### 5.1 New table: `broker_transactions`

```sql
CREATE TABLE broker_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"        TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('snaptrade','plaid')),
  account_id      TEXT NOT NULL,             -- aggregator's opaque ID, NEVER broker account number
  external_txn_id TEXT NOT NULL,              -- aggregator-provided idempotency key
  txn_date        DATE NOT NULL,
  settle_date     DATE,
  action          TEXT NOT NULL CHECK (action IN (
                    'buy','sell','dividend','interest','split',
                    'transfer','fee','contribution','withdrawal','other'
                  )),
  ticker          TEXT,                       -- nullable (e.g., interest, fees with no ticker)
  quantity        NUMERIC(20,8),
  price           NUMERIC(20,8),
  amount          NUMERIC(20,8) NOT NULL,    -- signed; cash impact on account
  fees            NUMERIC(20,8),
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  raw_encrypted   TEXT,                       -- AES-256-GCM ciphertext, format v2:iv:tag:ct
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bt_source_external_unique UNIQUE (source, external_txn_id)
);
CREATE INDEX idx_bt_user_date     ON broker_transactions("userId", txn_date DESC);
CREATE INDEX idx_bt_user_account  ON broker_transactions("userId", account_id);
CREATE INDEX idx_bt_user_ticker   ON broker_transactions("userId", ticker) WHERE ticker IS NOT NULL;
```

**What we deliberately do NOT store:**
- Broker account numbers (we use SnapTrade/Plaid opaque `account_id`)
- Broker login credentials (already encrypted via `SNAPTRADE_ENCRYPTION_KEY` per AGENTS.md rule #6)
- SSN, tax IDs, or any direct PII beyond what's already in `user`
- Cost basis from the broker — we recompute from transactions to avoid stale data

### 5.2 Modified table: `portfolio_snapshot`

```sql
ALTER TABLE portfolio_snapshot
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'observed'
  CHECK (source IN ('observed', 'reconstructed'));

CREATE INDEX IF NOT EXISTS idx_ps_user_source
  ON portfolio_snapshot("userId", source, "capturedAt" DESC);
```

The discriminator preserves clean separation: `'observed'` rows come from the existing daily snapshot cron; `'reconstructed'` rows come from the new reconstruction worker. **The reconstruction worker never overwrites a row with `source='observed'`.**

### 5.3 New table: `broker_history_queue`

A small work queue table for backfill jobs. Decouples webhook reception (must be fast) from backfill execution (slow).

```sql
CREATE TABLE broker_history_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"        TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('snaptrade','plaid')),
  account_id      TEXT NOT NULL,
  job_type        TEXT NOT NULL CHECK (job_type IN ('full_backfill','delta_sync','reconcile')),
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','done','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  earliest_txn_date DATE,                   -- populated on completion
  txn_count_inserted INTEGER,               -- populated on completion
  "queuedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "startedAt"     TIMESTAMPTZ,
  "completedAt"   TIMESTAMPTZ,
  CONSTRAINT bhq_user_account_unique UNIQUE ("userId", account_id, job_type, status)
                  DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_bhq_status_queued ON broker_history_queue(status, "queuedAt") WHERE status = 'queued';
```

The DEFERRABLE unique constraint allows a new `'queued'` job to coexist with a previous `'done'` for the same account (multiple delta syncs over time).

### 5.4 Encryption strategy

- **`raw_encrypted` column** uses AES-256-GCM via `src/lib/snaptrade.ts` `encrypt()` / `decrypt()` (existing `v2:iv:tag:ct` format).
- **All other columns** rely on Neon's at-rest encryption (AWS KMS).
- **Key versioning** uses the existing `v1:` / `v2:` prefix pattern — future rotation introduces `v3:` without breaking historical reads.
- Per research memo §2: pgcrypto is **not** used because it sends keys to the server during decryption.

### 5.5 Access control

**v1:** keep current single Postgres pool. App handlers scope by `WHERE "userId" = $1`. Cron writes go through the cron-auth Bearer pattern (existing).

**Deferred to follow-up phase:** Postgres role split (`clearpath_writer` vs `clearpath_reader`) and row-level security policies. Research memo §2 flagged these as defense-in-depth. Documented as deferred in Phase 10 risks (§9).

---

## 6. Compute layer (cron + workers)

### 6.1 Webhook handlers (existing routes, extended)

**`POST /api/snaptrade/webhook`** — when payload contains `eventType: "ACCOUNT_HOLDINGS_UPDATED"` or `"CONNECTION_ADDED"`:
- Insert a `broker_history_queue` row with `job_type='full_backfill'` and `status='queued'`
- Return 200 immediately (do NOT block on backfill)

**`POST /api/plaid/webhook`** — when payload contains `webhook_code: "HISTORICAL_UPDATE"`:
- Same pattern

The actual backfill happens in the cron worker (next section), not the webhook handler.

### 6.2 New cron: `/api/cron/broker-history-worker`

**Schedule:** every 5 minutes (Vercel `*/5 * * * *`).
**Bearer auth:** existing `CRON_SECRET` pattern.
**Behavior per invocation:**
1. Pop up to 5 jobs with `status='queued'` from `broker_history_queue` (oldest first).
2. For each job:
   - Mark `status='running'`, `startedAt=NOW()`.
   - Call `backfillConnection(userId, accountId, source)` (new function in `src/lib/broker-history/backfill.ts`).
   - On success: mark `status='done'`, populate `earliest_txn_date` and `txn_count_inserted`. Trigger `reconstructHistoricalSnapshots`.
   - On failure: increment `attempts`, set `last_error`. If `attempts >= 5`, mark `status='failed'`. Otherwise leave `status='running'` for retry on next cron tick.
3. Sequential per-tick (no parallelism within the function) to respect broker rate limits.

### 6.3 New cron: `/api/cron/broker-history-delta`

**Schedule:** every 6 hours (`0 */6 * * *`).
**Behavior:**
- Enumerate all active broker connections per user.
- For each, enqueue a `delta_sync` job that pulls `txnDate >= MAX(stored_txn_date) - 7 days` (the 7-day window catches corrections).
- Idempotent: re-enqueueing if a `done` exists is safe (UPSERT on (userId, account_id, job_type, status)).

### 6.4 New cron: `/api/cron/broker-history-reconcile`

**Schedule:** quarterly (`0 6 1 3,6,9,12 *` — Mar/Jun/Sep/Dec 1st at 6am UTC).
**Behavior:**
- Enqueue a `reconcile` job per active connection.
- Worker performs full re-pull, diffs against stored `broker_transactions`, logs drift to admin telemetry. Does **not** mutate stored rows on its own — drift just surfaces in `/admin/health`.

### 6.5 Backfill worker (`src/lib/broker-history/backfill.ts`)

```ts
export async function backfillConnection(
  userId: string,
  accountId: string,
  source: "snaptrade" | "plaid",
): Promise<{ inserted: number; earliest: string | null }>;
```

- For SnapTrade: paginated calls to `getActivities()` (1000/page, 10000 max). Loops until `pagination.nextOffset` is null.
- For Plaid: `investmentsTransactionsGet({ start_date, end_date })` with `start_date = '1900-01-01'` (Plaid caps at 24mo regardless).
- Normalizes broker txn types via `src/lib/broker-history/normalize.ts` (canonical action map):
  - `BUY|MARKET_BUY|LIMIT_BUY|...` → `'buy'`
  - `SELL|MARKET_SELL|...` → `'sell'`
  - `DIVIDEND|DIV|REINVESTMENT_DIV` → `'dividend'`
  - `INTEREST|INT_INCOME` → `'interest'`
  - `STOCK_SPLIT|SPLIT` → `'split'`
  - `TRANSFER_IN|TRANSFER_OUT|JNL` → `'transfer'`
  - `COMMISSION|REGFEE|FEE` → `'fee'`
  - `CONTRIBUTION|DEPOSIT` → `'contribution'`
  - `WITHDRAWAL` → `'withdrawal'`
  - **Unknown** → `'other'` (with `raw_encrypted` preserving the original; admin telemetry logs unknown types for future mapper expansion)
- Encrypts `raw_json` as `raw_encrypted` using existing `encrypt()` from `src/lib/snaptrade.ts`.
- Bulk INSERT with `ON CONFLICT (source, external_txn_id) DO UPDATE SET amount=..., updatedAt=NOW()` so corrected transactions overwrite stale.

### 6.6 Reconstruction worker (`src/lib/broker-history/reconstruct.ts`)

```ts
export async function reconstructHistoricalSnapshots(
  userId: string,
  accountId?: string,  // if provided, only this account; else all the user's accounts
): Promise<{ snapshotsInserted: number }>;
```

Algorithm:
1. Determine the date range to reconstruct: `[earliest_txn_date, MIN(observed_capturedAt) - 1 day]`.
2. Read current holdings + cash for the user (existing helpers in `src/lib/snaptrade.ts` / `src/lib/plaid.ts`).
3. Walk transactions backward by date, mutating an in-memory `{ ticker → shares, cash }` running balance.
4. At each historical date `D` (only days where the user actually had positions):
   - For each ticker in the running balance, look up `close` price from `ticker_market_daily` for date `D`.
   - Compute `totalValue = sum(shares * close) + cash`.
   - INSERT INTO `portfolio_snapshot` with `source='reconstructed'`. ON CONFLICT (userId, capturedAt) DO NOTHING — never overwrites observed rows.
5. Skip dates where `ticker_market_daily.close` is NULL for any held ticker (we don't have prices, can't compute, won't fake).
6. Log skipped-date count to admin telemetry. If >5% of dates skipped, log at WARN level.

### 6.7 Initial sweep migration

A one-shot SQL block in the migration that, after creating the new tables, enqueues a `full_backfill` job for every existing `(userId, accountId, source)` tuple from the existing `holding` table:

```sql
INSERT INTO broker_history_queue ("userId", source, account_id, job_type, status)
SELECT DISTINCT
  h."userId",
  -- Heuristic: SnapTrade if user has snaptrade_connection row; Plaid otherwise
  CASE WHEN EXISTS (SELECT 1 FROM snaptrade_connection sc WHERE sc."userId" = h."userId")
       THEN 'snaptrade' ELSE 'plaid' END AS source,
  h.account_id,
  'full_backfill',
  'queued'
FROM holding h
ON CONFLICT DO NOTHING;
```

Worker drains this queue at 1 connection / 5 minutes (rate limit safety). At ~50 users × ~2 connections = ~100 jobs × 5 min = ~8 hours total — runs unattended overnight.

---

## 7. Chart integration

**No chart code changes.** Phase 9's `/api/track-record/route.ts` reads `portfolio_snapshot` and computes `oldestSnapshotDate` + `supportedRanges`. As reconstructed rows land in `portfolio_snapshot`, those values automatically reflect the extended depth.

**Visual treatment (small change in chart component):**

In `src/components/dashboard/blocks.tsx` `BlockChart`, accept an optional `source` field per data point and render reconstructed dates differently:
- **Reconstructed dates** (left portion): dashed stroke OR 60% opacity
- **Observed dates** (right portion): solid stroke at full opacity
- A tiny legend below: "● Observed │ ┄ Reconstructed from broker txns"

The boundary point (where reconstructed meets observed) is rendered as a single labeled point on the chart: "first daily snapshot YYYY-MM-DD".

The existing `/api/track-record` route extends its response shape:

```ts
{
  ok: true,
  range: string,
  oldestSnapshotDate: string | null,
  oldestObservedDate: string | null,    // NEW
  supportedRanges: string[],
  portfolioSeries: Array<{ date: string; totalValue: number; source: 'observed' | 'reconstructed' }>,
  // ... other existing fields preserved
}
```

The `source` field on each point lets the chart render visual distinction without a separate query.

---

## 8. User control surface

### 8.1 New page: `/app/settings/data`

Server-rendered, BetterAuth-gated. Renders three sections:

```
┌─ Connection summary ─────────────────────────────────────────┐
│  Schwab (SnapTrade) · earliest 2024-05-04 · 1,247 stored     │
│  Synced 6h ago · last full sweep 2026-04-15                  │
│                                                              │
│  Fidelity (Plaid) · earliest 2024-08-12 · 412 stored         │
│  Synced 6h ago · first sync 2026-04-21                       │
└──────────────────────────────────────────────────────────────┘

┌─ Export ─────────────────────────────────────────────────────┐
│  Download all stored transactions as CSV                     │
│  [Download CSV]                                              │
│  Includes: date, source, account_id, action, ticker, qty,    │
│  price, amount, fees. Excludes encrypted broker memos.       │
└──────────────────────────────────────────────────────────────┘

┌─ Purge per connection ───────────────────────────────────────┐
│  Schwab:    [Delete history]                                 │
│  Fidelity:  [Delete history]                                 │
│                                                              │
│  Removes all stored transactions and reconstructed history   │
│  from the selected connection. Your current holdings remain  │
│  unchanged. This cannot be undone.                           │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 New API routes

- **`GET /api/user/transactions/export`** — streams a CSV file. BetterAuth-gated. Queries `broker_transactions WHERE "userId" = $1 ORDER BY txn_date DESC`. Excludes `raw_encrypted`. Returns `Content-Type: text/csv` and `Content-Disposition: attachment; filename="clearpath-transactions-{userId-prefix}-{YYYY-MM-DD}.csv"`.

- **`DELETE /api/user/transactions/{accountId}`** — BetterAuth-gated. Deletes:
  1. All `broker_transactions WHERE "userId" = $1 AND account_id = $2`
  2. All `portfolio_snapshot WHERE "userId" = $1 AND source = 'reconstructed'` for dates that no longer have any underlying transactions backing them (effectively: re-run reconstruction with the remaining accounts; if reconstruction yields no rows for a date, the previously-reconstructed row for that date is deleted)

  Wraps both deletes + the reconstruction recompute in a single Postgres transaction. Returns `{ ok: true, transactionsDeleted: N, snapshotsDeleted: M }`.

---

## 9. Privacy policy update

**File:** `src/app/privacy/page.tsx`

Add 8 bullets under "Information we collect" / "How we use it" / "Your rights":

```
- We retrieve and store your broker transaction history (buys, sells,
  dividends, fees, splits, transfers) for up to the depth your broker
  permits, currently as far back as 24 months for most institutions
  and approximately 4 years for Charles Schwab.

- We never store your broker account numbers or login credentials.
  Account references use opaque aggregator IDs from SnapTrade or Plaid.

- Transaction data is encrypted at rest (database-level via AWS KMS) and
  in transit (TLS 1.3). Free-text broker memos are additionally encrypted
  at the application layer with AES-256-GCM.

- We retain transaction history while your ClearPath account is active.
  Account deletion purges from primary systems immediately and from
  database backups within 30 days.

- You can export all stored transaction data as CSV at any time from
  Settings → Data & Privacy.

- You can purge transaction history from any individual broker connection
  at any time, while keeping your current holdings.

- We use this data only to power your performance chart and analysis
  surfaces. We do not share it with third parties, do not sell it,
  and do not use it for advertising.

- Past transaction outcomes are informational only. Not investment advice.
  Not a guarantee of future performance.
```

Add new "Data Vendors" subsection naming SnapTrade, Plaid, Neon, Vercel.

Add 30-day GLBA-compliant breach notification commitment paragraph:

```
In the event of a data breach affecting 500 or more individuals,
we will notify the U.S. Federal Trade Commission and affected users
in writing within 30 days of detection, in compliance with the
Gramm-Leach-Bliley Act Safeguards Rule.
```

The privacy policy commit is in the SAME merge as the code that introduces the new data collection. This is the locked Q3 decision.

---

## 10. Acceptance criteria

1. New tables created via Neon MCP migration: `broker_transactions`, `broker_history_queue`. `portfolio_snapshot` gains `source` column. All indexes + UNIQUE constraints verified.
2. SnapTrade webhook handler enqueues `full_backfill` on `CONNECTION_ADDED` event.
3. Plaid webhook handler enqueues `full_backfill` on `HISTORICAL_UPDATE` event.
4. One-time migration sweep enqueues a `full_backfill` job for every existing user-connection.
5. Backfill worker normalizes broker txn types → 9 canonical actions + `'other'`. Idempotent on `(source, external_txn_id)`.
6. `raw_encrypted` populated via existing `SNAPTRADE_ENCRYPTION_KEY` envelope (`v2:iv:tag:ct`). Round-trip decryption test in vitest.
7. Reconstruction worker walks transactions backward, INSERTs `portfolio_snapshot` rows with `source='reconstructed'`, never overwrites `'observed'` rows.
8. 6-hourly delta sync cron registered in `vercel.json`. Pulls `txnDate >= MAX(stored) - 7d`. Idempotent across reruns.
9. Quarterly reconciliation cron registered. Logs drift to admin telemetry. Does NOT mutate stored rows.
10. Performance chart visually distinguishes reconstructed range (dashed line OR 60% opacity overlay). Legend present.
11. `/app/settings/data` page renders for authenticated users with per-connection summary, CSV export button, and per-connection purge buttons. Each action wired to its API route.
12. CSV export at `GET /api/user/transactions/export` returns RFC 4180 CSV with the correct columns and excludes `raw_encrypted`.
13. Per-connection purge at `DELETE /api/user/transactions/{accountId}` deletes transactions, recomputes reconstruction, returns `{ transactionsDeleted, snapshotsDeleted }`.
14. Privacy policy updated with the 8 bullets, "Data Vendors" subsection, and breach notification paragraph. The privacy policy commit is in the same merge as the data-collection code.
15. Demo user (`demo@clearpathinvest.app`) has reconstructed history visible on the chart after the initial sweep completes.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Broker txn types vary wildly (261 types per SnapTrade); some don't map to our 9 canonical actions | Default unmapped types to `action='other'` with `raw_encrypted` preserving the original. Log unknown types to admin telemetry; expand `normalize.ts` mapper as new types appear. |
| Plaid first-call latency 60-120s | Backfill is async via `broker_history_queue`, not a request handler. Webhook returns 200 immediately. |
| Reconstructed value disagrees with observed value on overlap day | Reconstruction stops at `MIN(observed_capturedAt) - 1 day` per user. Trust tenet: don't write reconstructed rows for dates we already observed. |
| User purges a connection mid-chart-render | Purge wraps deletion + reconstruction recompute in one Postgres transaction. Chart re-fetches on `router.refresh()` post-purge. |
| GLBA Safeguards Rule requires written infosec program | Existing `docs/security/info-sec-policy.md` covers most of it. Add encrypted-at-rest + AES-GCM details + 30-day breach notification commitment to that doc as part of this merge. |
| Reconstruction bug pollutes `portfolio_snapshot` | `source='reconstructed'` discriminator lets us hard-delete and recompute without touching observed rows. Migration included for emergency purge: `DELETE FROM portfolio_snapshot WHERE source='reconstructed'` then re-trigger reconstruction. |
| Initial sweep hits broker rate limits | Sequential worker, 1 connection / 5 minutes. Logs progress. On rate-limit error, `attempts` increments and the worker retries on next tick with exponential backoff (max 60s). |
| Account deletion leaves orphaned transactions | `ON DELETE CASCADE` on `"userId"` FK in `broker_transactions` and `broker_history_queue`. Verified in vitest. |
| Encryption key rotation in future | Existing `v1:` / `v2:` prefix pattern from `src/lib/snaptrade.ts`. New writes use latest version; old ciphertexts decrypt with their stamped version. |
| Cyber liability not yet active | Acceptance criteria include adding $5M cyber + E&O insurance to ops backlog; trigger threshold per research memo §3 = 1K paying users / first enterprise contract / $250K ARR. NOT blocking shipping at current beta scale, but documented. |
| Postgres role split + RLS deferred | Documented as Phase 11+ defense-in-depth. v1 application-layer scoping (`WHERE "userId" = $1`) is enforced by code review and existing SQL patterns. |
| Privacy policy publication timing under CCPA | Concurrent with launch (locked Q3 decision). Same commit, same merge. CCPA "material change" threshold is debatable for our case (we're using more of already-authorized data); concurrent publication is industry standard for our scope. |

---

## 12. Implementation outline

The implementation plan will sequence:

1. **Migration** — `broker_transactions`, `broker_history_queue`, `portfolio_snapshot.source` column. Apply via Neon MCP.
2. **Encryption + types** — types in `src/lib/broker-history/types.ts`, encrypt/decrypt helpers (reuse `src/lib/snaptrade.ts`).
3. **Normalization** — `src/lib/broker-history/normalize.ts` canonical action map + tests.
4. **Backfill worker** — `src/lib/broker-history/backfill.ts` per-source implementations + tests with mocked SnapTrade/Plaid responses.
5. **Reconstruction worker** — `src/lib/broker-history/reconstruct.ts` walks transactions + computes snapshots + tests with synthetic txn fixtures.
6. **Webhook handlers** — extend `/api/snaptrade/webhook` and `/api/plaid/webhook` to enqueue jobs.
7. **Cron routes** — `/api/cron/broker-history-worker`, `/api/cron/broker-history-delta`, `/api/cron/broker-history-reconcile`. Update `vercel.json`.
8. **Initial sweep** — migration block enqueueing existing connections.
9. **Chart integration** — extend `/api/track-record` response shape with per-point `source`; update `BlockChart` visual treatment + legend.
10. **User control surface** — `/app/settings/data` page + `GET /api/user/transactions/export` + `DELETE /api/user/transactions/{accountId}`.
11. **Privacy policy** — update `src/app/privacy/page.tsx` with the 8 bullets + Data Vendors + breach notification paragraph.
12. **Verification** — full vitest suite, tsc, build clean. Manual acceptance pass against §10. Demo user reconstruction visible on chart.

Each step ships through the standard verification gate (`npm test`, `npx tsc --noEmit`, `npm run build`).

---

**End of design.**
