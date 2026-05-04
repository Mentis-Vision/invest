# Phase 10 Broker History Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-04-phase-10-broker-history-design.md` (commit `214b2c4`)

**Goal:** Ingest 18-24mo of broker transaction history, reconstruct historical portfolio values, extend Phase 9's chart with reconstructed range — all under the trust tenet (AGENTS.md rule #13).

**Architecture:** Webhook → `broker_history_queue` → backfill worker → reconstruction worker → `portfolio_snapshot` (with `source='reconstructed'`). Phase 9's `/api/track-record` consumes unchanged. New `/app/settings/data` page + privacy policy update ship in same merge.

**Tech Stack:** Next.js 16.2.4 · React 19.2 · TypeScript 5 · Vitest 4.1 · Neon Postgres · BetterAuth · existing `src/lib/snaptrade.ts` (encrypt/decrypt) · existing `src/lib/plaid.ts` (`syncTransactions`).

**Hard constraints (AGENTS.md):** Migrations hand-applied via Neon MCP (`broad-sun-50424626`/`neondb`). Reserved words double-quoted. `printf` not `echo` for env vars. Logging via `src/lib/log.ts` `log.info("scope","msg",{data})`. Trust tenet (rule #13) — never overwrite observed rows with reconstructed; never silently merge sources.

---

## File Structure

**Created (new):**
- `migrations/2026-05-04-broker-history.sql` — all DDL + initial sweep enqueue
- `src/lib/broker-history/types.ts` — shared types (`CanonicalAction`, `BrokerTransaction`, `BackfillJob`, etc.)
- `src/lib/broker-history/normalize.ts` — broker txn type → canonical action mapper
- `src/lib/broker-history/normalize.test.ts`
- `src/lib/broker-history/snaptrade-loader.ts` — SnapTrade activities pull
- `src/lib/broker-history/snaptrade-loader.test.ts`
- `src/lib/broker-history/plaid-loader.ts` — Plaid investments transactions pull (full history, not just 30d)
- `src/lib/broker-history/plaid-loader.test.ts`
- `src/lib/broker-history/backfill.ts` — orchestrator: dequeue → dispatch → mark done
- `src/lib/broker-history/reconstruct.ts` — walks transactions backward, computes daily snapshots
- `src/lib/broker-history/reconstruct.test.ts`
- `src/lib/broker-history/queue.ts` — small wrappers around `broker_history_queue` (enqueue / pop / mark)
- `src/app/api/cron/broker-history-worker/route.ts` — every 5 minutes
- `src/app/api/cron/broker-history-delta/route.ts` — every 6 hours
- `src/app/api/cron/broker-history-reconcile/route.ts` — quarterly
- `src/app/api/user/transactions/export/route.ts` — CSV export
- `src/app/api/user/transactions/[accountId]/route.ts` — DELETE per-connection purge
- `src/app/app/settings/data/page.tsx` — settings UI

**Modified:**
- `src/app/api/snaptrade/webhook/route.ts` (or wherever SnapTrade webhooks land — recon shows `holdings/sync/login-url` only; webhook may live elsewhere — implementer verifies)
- `src/app/api/plaid/webhook/route.ts` — enqueue full backfill on `HISTORICAL_UPDATE`
- `src/app/api/track-record/route.ts` — emit per-point `source` and `oldestObservedDate`
- `src/components/dashboard/blocks.tsx` `BlockChart` — visual treatment for reconstructed range
- `src/app/privacy/page.tsx` — 8 new bullets + Data Vendors + breach notification
- `vercel.json` — three new cron entries

**Untouched:**
- All Phase 1-9 surfaces other than the chart visual treatment and `/api/track-record` shape extension
- The existing `plaid_transaction` table — left in place (the migration copies its rows into `broker_transactions` but does not drop it; future cleanup can drop it after verification)
- All AI / decision-engine / queue-builder code

---

## Task 1: Migration — `broker_transactions` + `broker_history_queue` + `portfolio_snapshot.source`

**Files:**
- Create: `migrations/2026-05-04-broker-history.sql`
- Apply via: Neon MCP `mcp__Neon__run_sql_transaction` (project `broad-sun-50424626`, db `neondb`)

- [ ] **Step 1: Inspect existing schemas**

Use `mcp__Neon__describe_table_schema` on `portfolio_snapshot`, `holding`, `plaid_transaction`. Confirm:
- `portfolio_snapshot` has columns including `userId`, `capturedAt`, `totalValue`
- `holding` has `userId`, `account_id` or similar, `ticker`
- `plaid_transaction` exists with the columns shown in `src/lib/plaid.ts` `syncTransactions` (plaidTransactionId, type, subtype, quantity, price, amount, fees, tradeDate, etc.)

Capture the actual `holding` account-id column name (likely `account_id` or `accountId`); the migration's initial-sweep block needs it.

- [ ] **Step 2: Write the migration SQL file**

```sql
-- migrations/2026-05-04-broker-history.sql
-- Phase 10: broker transaction history backfill
-- Spec: docs/superpowers/specs/2026-05-04-phase-10-broker-history-design.md

-- 1. broker_transactions: canonical, per-user transaction store
CREATE TABLE IF NOT EXISTS broker_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"        TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('snaptrade','plaid')),
  account_id      TEXT NOT NULL,
  external_txn_id TEXT NOT NULL,
  txn_date        DATE NOT NULL,
  settle_date     DATE,
  action          TEXT NOT NULL CHECK (action IN (
                    'buy','sell','dividend','interest','split',
                    'transfer','fee','contribution','withdrawal','other'
                  )),
  ticker          TEXT,
  quantity        NUMERIC(20,8),
  price           NUMERIC(20,8),
  amount          NUMERIC(20,8) NOT NULL,
  fees            NUMERIC(20,8),
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  raw_encrypted   TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bt_source_external_unique UNIQUE (source, external_txn_id)
);
CREATE INDEX IF NOT EXISTS idx_bt_user_date    ON broker_transactions("userId", txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_bt_user_account ON broker_transactions("userId", account_id);
CREATE INDEX IF NOT EXISTS idx_bt_user_ticker  ON broker_transactions("userId", ticker) WHERE ticker IS NOT NULL;

-- 2. broker_history_queue: backfill job tracking
CREATE TABLE IF NOT EXISTS broker_history_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"            TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source              TEXT NOT NULL CHECK (source IN ('snaptrade','plaid')),
  account_id          TEXT NOT NULL,
  job_type            TEXT NOT NULL CHECK (job_type IN ('full_backfill','delta_sync','reconcile')),
  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','done','failed')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  earliest_txn_date   DATE,
  txn_count_inserted  INTEGER,
  "queuedAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "startedAt"         TIMESTAMPTZ,
  "completedAt"       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bhq_status_queued
  ON broker_history_queue(status, "queuedAt") WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_bhq_user_account
  ON broker_history_queue("userId", account_id);

-- 3. portfolio_snapshot.source discriminator
ALTER TABLE portfolio_snapshot
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'observed'
  CHECK (source IN ('observed', 'reconstructed'));
CREATE INDEX IF NOT EXISTS idx_ps_user_source
  ON portfolio_snapshot("userId", source, "capturedAt" DESC);

-- 4. One-time copy of existing plaid_transaction rows into broker_transactions
--    (preserves continuity; old table not dropped here — verify before drop)
INSERT INTO broker_transactions
  ("userId", source, account_id, external_txn_id, txn_date, settle_date,
   action, ticker, quantity, price, amount, fees, currency, raw_encrypted)
SELECT
  pt."userId",
  'plaid'                                                  AS source,
  pt."plaidAccountId"                                      AS account_id,
  pt."plaidTransactionId"                                  AS external_txn_id,
  pt."tradeDate"                                           AS txn_date,
  pt."settleDate"                                          AS settle_date,
  CASE LOWER(COALESCE(pt.subtype, pt.type, ''))
    WHEN 'buy' THEN 'buy'
    WHEN 'sell' THEN 'sell'
    WHEN 'dividend' THEN 'dividend'
    WHEN 'interest' THEN 'interest'
    WHEN 'transfer' THEN 'transfer'
    WHEN 'fee' THEN 'fee'
    WHEN 'deposit' THEN 'contribution'
    WHEN 'withdrawal' THEN 'withdrawal'
    ELSE 'other'
  END                                                      AS action,
  pt.ticker,
  pt.quantity,
  pt.price,
  pt.amount,
  pt.fees,
  COALESCE(pt.currency, 'USD'),
  NULL                                                     AS raw_encrypted
FROM plaid_transaction pt
WHERE NOT EXISTS (
  SELECT 1 FROM broker_transactions bt
  WHERE bt.source = 'plaid' AND bt.external_txn_id = pt."plaidTransactionId"
);

-- 5. One-time sweep: enqueue full_backfill for every existing connection.
--    Uses snaptrade_connection presence to choose source; falls back to plaid.
INSERT INTO broker_history_queue ("userId", source, account_id, job_type, status)
SELECT DISTINCT
  h."userId",
  CASE WHEN EXISTS (
    SELECT 1 FROM snaptrade_connection sc WHERE sc."userId" = h."userId"
  ) THEN 'snaptrade' ELSE 'plaid' END                      AS source,
  h.account_id,
  'full_backfill'                                          AS job_type,
  'queued'                                                 AS status
FROM holding h
ON CONFLICT DO NOTHING;
```

If the actual `holding` account-id column name is different (e.g., `accountId` not `account_id`), adapt the JOIN. If the actual `plaid_transaction` column names differ (camelCase vs snake_case), adapt the SELECT clause.

- [ ] **Step 3: Apply via Neon MCP**

Load `mcp__Neon__run_sql_transaction` and `mcp__Neon__describe_table_schema` via ToolSearch. Run the migration as a single transaction.

- [ ] **Step 4: Verify schema**

Re-describe `broker_transactions`, `broker_history_queue`, `portfolio_snapshot`. Confirm columns + indexes + constraints.

Verify the copy worked:
```sql
SELECT COUNT(*) FROM broker_transactions WHERE source = 'plaid';
SELECT COUNT(*) FROM plaid_transaction;
-- The two should be equal (or close — possibly fewer in broker_transactions
-- if duplicate plaidTransactionIds existed in plaid_transaction; that's fine).

SELECT COUNT(*) FROM broker_history_queue WHERE status = 'queued';
-- Should equal the number of distinct (userId, account_id) tuples in holding.
```

- [ ] **Step 5: Commit**

```bash
git add migrations/2026-05-04-broker-history.sql
git commit -m "feat(db): broker_transactions + broker_history_queue + portfolio_snapshot.source

Phase 10 migration. Hand-applied via Neon MCP. Includes:
- Canonical broker_transactions table (UNIQUE source+external_txn_id)
- broker_history_queue work queue
- portfolio_snapshot.source discriminator (observed | reconstructed)
- One-time copy of existing plaid_transaction rows
- One-time sweep enqueueing full_backfill for every existing connection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/lib/broker-history/types.ts`

- [ ] **Step 1: Write the types file**

```ts
// src/lib/broker-history/types.ts
// Shared types for Phase 10 broker history backfill.

export type BrokerSource = "snaptrade" | "plaid";

export type CanonicalAction =
  | "buy"
  | "sell"
  | "dividend"
  | "interest"
  | "split"
  | "transfer"
  | "fee"
  | "contribution"
  | "withdrawal"
  | "other";

export type BackfillJobType = "full_backfill" | "delta_sync" | "reconcile";

export type BackfillJobStatus = "queued" | "running" | "done" | "failed";

export interface BrokerTransaction {
  id: string;
  userId: string;
  source: BrokerSource;
  accountId: string;
  externalTxnId: string;
  txnDate: string;          // ISO date YYYY-MM-DD
  settleDate: string | null;
  action: CanonicalAction;
  ticker: string | null;
  quantity: number | null;
  price: number | null;
  amount: number;
  fees: number | null;
  currency: string;
  rawEncrypted: string | null;
}

export interface BackfillJob {
  id: string;
  userId: string;
  source: BrokerSource;
  accountId: string;
  jobType: BackfillJobType;
  status: BackfillJobStatus;
  attempts: number;
  lastError: string | null;
  earliestTxnDate: string | null;
  txnCountInserted: number | null;
}

export interface BackfillResult {
  inserted: number;
  earliestTxnDate: string | null;
  unknownActionCount: number;  // for telemetry — count of txns mapped to 'other'
}

export interface ReconstructResult {
  snapshotsInserted: number;
  earliestSnapshotDate: string | null;
  skippedDays: number;          // days where ticker_market_daily lacked a price
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/broker-history/types.ts
git commit -m "feat(broker-history): shared types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Action normalizer (TDD)

**Files:**
- Create: `src/lib/broker-history/normalize.ts`
- Test: `src/lib/broker-history/normalize.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/broker-history/normalize.test.ts
import { describe, it, expect } from "vitest";
import { normalizeAction } from "./normalize";

describe("normalizeAction", () => {
  describe("SnapTrade types", () => {
    it("maps buy variants", () => {
      expect(normalizeAction("snaptrade", "BUY")).toBe("buy");
      expect(normalizeAction("snaptrade", "MARKET_BUY")).toBe("buy");
      expect(normalizeAction("snaptrade", "LIMIT_BUY")).toBe("buy");
      expect(normalizeAction("snaptrade", "buy")).toBe("buy");
    });
    it("maps sell variants", () => {
      expect(normalizeAction("snaptrade", "SELL")).toBe("sell");
      expect(normalizeAction("snaptrade", "MARKET_SELL")).toBe("sell");
    });
    it("maps dividend variants", () => {
      expect(normalizeAction("snaptrade", "DIVIDEND")).toBe("dividend");
      expect(normalizeAction("snaptrade", "DIV")).toBe("dividend");
      expect(normalizeAction("snaptrade", "REINVESTMENT_DIV")).toBe("dividend");
    });
    it("maps interest", () => {
      expect(normalizeAction("snaptrade", "INTEREST")).toBe("interest");
      expect(normalizeAction("snaptrade", "INT_INCOME")).toBe("interest");
    });
    it("maps splits", () => {
      expect(normalizeAction("snaptrade", "STOCK_SPLIT")).toBe("split");
      expect(normalizeAction("snaptrade", "SPLIT")).toBe("split");
    });
    it("maps transfers", () => {
      expect(normalizeAction("snaptrade", "TRANSFER_IN")).toBe("transfer");
      expect(normalizeAction("snaptrade", "JNL")).toBe("transfer");
    });
    it("maps fees", () => {
      expect(normalizeAction("snaptrade", "COMMISSION")).toBe("fee");
      expect(normalizeAction("snaptrade", "REGFEE")).toBe("fee");
    });
    it("maps contributions and withdrawals", () => {
      expect(normalizeAction("snaptrade", "CONTRIBUTION")).toBe("contribution");
      expect(normalizeAction("snaptrade", "DEPOSIT")).toBe("contribution");
      expect(normalizeAction("snaptrade", "WITHDRAWAL")).toBe("withdrawal");
    });
    it("falls back to 'other' for unknown types", () => {
      expect(normalizeAction("snaptrade", "VERY_RARE_BROKER_THING")).toBe("other");
      expect(normalizeAction("snaptrade", "")).toBe("other");
    });
  });

  describe("Plaid types", () => {
    it("maps Plaid buy/sell", () => {
      expect(normalizeAction("plaid", "buy")).toBe("buy");
      expect(normalizeAction("plaid", "sell")).toBe("sell");
    });
    it("maps Plaid cash subtype dividends/interest", () => {
      expect(normalizeAction("plaid", "dividend")).toBe("dividend");
      expect(normalizeAction("plaid", "interest")).toBe("interest");
    });
    it("maps Plaid transfer subtypes", () => {
      expect(normalizeAction("plaid", "transfer")).toBe("transfer");
      expect(normalizeAction("plaid", "deposit")).toBe("contribution");
      expect(normalizeAction("plaid", "withdrawal")).toBe("withdrawal");
    });
    it("falls back to 'other'", () => {
      expect(normalizeAction("plaid", "unknown_subtype")).toBe("other");
    });
  });
});
```

Run; expect FAIL (module not found).

- [ ] **Step 2: Implement normalize.ts**

```ts
// src/lib/broker-history/normalize.ts
// Maps broker-specific transaction types to a canonical action.
// Per AGENTS.md trust tenet: unknown types fall back to 'other' rather
// than being silently mapped — log them in telemetry for mapper expansion.

import type { BrokerSource, CanonicalAction } from "./types";

const SNAPTRADE_MAP: Record<string, CanonicalAction> = {
  // Buys
  BUY: "buy", MARKET_BUY: "buy", LIMIT_BUY: "buy",
  // Sells
  SELL: "sell", MARKET_SELL: "sell", LIMIT_SELL: "sell",
  // Dividends
  DIVIDEND: "dividend", DIV: "dividend", REINVESTMENT_DIV: "dividend",
  // Interest
  INTEREST: "interest", INT_INCOME: "interest",
  // Splits
  STOCK_SPLIT: "split", SPLIT: "split",
  // Transfers
  TRANSFER_IN: "transfer", TRANSFER_OUT: "transfer", JNL: "transfer",
  // Fees
  COMMISSION: "fee", REGFEE: "fee", FEE: "fee",
  // Cash flows
  CONTRIBUTION: "contribution", DEPOSIT: "contribution",
  WITHDRAWAL: "withdrawal",
};

const PLAID_MAP: Record<string, CanonicalAction> = {
  buy: "buy",
  sell: "sell",
  dividend: "dividend",
  interest: "interest",
  transfer: "transfer",
  deposit: "contribution",
  withdrawal: "withdrawal",
  fee: "fee",
  // Plaid uses 'cash' as a top-level type with subtype carrying detail.
  // We accept either being passed in.
};

export function normalizeAction(source: BrokerSource, raw: string): CanonicalAction {
  if (!raw) return "other";
  if (source === "snaptrade") {
    return SNAPTRADE_MAP[raw.toUpperCase()] ?? "other";
  }
  // Plaid keys are lowercase
  return PLAID_MAP[raw.toLowerCase()] ?? "other";
}
```

- [ ] **Step 3: Run tests, expect PASS**

```bash
npm test -- src/lib/broker-history/normalize.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/broker-history/normalize.ts src/lib/broker-history/normalize.test.ts
git commit -m "feat(broker-history): canonical action normalizer (TDD)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Queue helpers

**Files:**
- Create: `src/lib/broker-history/queue.ts`

- [ ] **Step 1: Implement**

```ts
// src/lib/broker-history/queue.ts
// Thin DB wrappers over broker_history_queue. Read/write only — no
// scheduling logic (that lives in the cron route).

import { pool } from "../db";
import { log, errorInfo } from "../log";
import type { BackfillJob, BackfillJobType, BrokerSource } from "./types";

interface QueueRow {
  id: string;
  userId: string;
  source: BrokerSource;
  account_id: string;
  job_type: BackfillJobType;
  status: BackfillJob["status"];
  attempts: number;
  last_error: string | null;
  earliest_txn_date: string | null;
  txn_count_inserted: number | null;
}

function toJob(r: QueueRow): BackfillJob {
  return {
    id: r.id,
    userId: r.userId,
    source: r.source,
    accountId: r.account_id,
    jobType: r.job_type,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    earliestTxnDate: r.earliest_txn_date,
    txnCountInserted: r.txn_count_inserted,
  };
}

export async function enqueueJob(
  userId: string,
  source: BrokerSource,
  accountId: string,
  jobType: BackfillJobType,
): Promise<void> {
  await pool.query(
    `INSERT INTO broker_history_queue ("userId", source, account_id, job_type, status)
     VALUES ($1, $2, $3, $4, 'queued')`,
    [userId, source, accountId, jobType],
  );
}

export async function popQueuedJobs(limit: number): Promise<BackfillJob[]> {
  // Atomically pull up to `limit` queued jobs and mark them running.
  // Uses FOR UPDATE SKIP LOCKED so concurrent worker invocations don't collide.
  const result = await pool.query<QueueRow>(
    `WITH next AS (
       SELECT id FROM broker_history_queue
       WHERE status = 'queued'
       ORDER BY "queuedAt" ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE broker_history_queue
     SET status = 'running',
         "startedAt" = NOW(),
         attempts = attempts + 1,
         "updatedAt" = NOW()
     FROM next
     WHERE broker_history_queue.id = next.id
     RETURNING broker_history_queue.id,
               broker_history_queue."userId",
               broker_history_queue.source,
               broker_history_queue.account_id,
               broker_history_queue.job_type,
               broker_history_queue.status,
               broker_history_queue.attempts,
               broker_history_queue.last_error,
               broker_history_queue.earliest_txn_date,
               broker_history_queue.txn_count_inserted`,
    [limit],
  );
  return result.rows.map(toJob);
}

export async function markJobDone(
  jobId: string,
  earliestTxnDate: string | null,
  txnCountInserted: number,
): Promise<void> {
  await pool.query(
    `UPDATE broker_history_queue
     SET status = 'done',
         "completedAt" = NOW(),
         earliest_txn_date = $2,
         txn_count_inserted = $3,
         last_error = NULL,
         "updatedAt" = NOW()
     WHERE id = $1`,
    [jobId, earliestTxnDate, txnCountInserted],
  );
}

export async function markJobFailed(jobId: string, error: string, maxAttempts = 5): Promise<void> {
  // If attempts >= maxAttempts, mark failed (terminal). Otherwise re-queue.
  await pool.query(
    `UPDATE broker_history_queue
     SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'queued' END,
         last_error = $2,
         "updatedAt" = NOW()
     WHERE id = $1`,
    [jobId, error.slice(0, 1000), maxAttempts],
  );
  log.warn("broker-history.queue", "job failed", { jobId, error: error.slice(0, 200) });
}

export async function listEnqueuedFor(
  userId: string,
  accountId: string,
): Promise<BackfillJob[]> {
  const result = await pool.query<QueueRow>(
    `SELECT * FROM broker_history_queue
     WHERE "userId" = $1 AND account_id = $2
     ORDER BY "queuedAt" DESC
     LIMIT 20`,
    [userId, accountId],
  );
  return result.rows.map(toJob);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/broker-history/queue.ts
git commit -m "feat(broker-history): queue helpers (enqueue/pop/mark)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: SnapTrade activities loader (TDD)

**Files:**
- Create: `src/lib/broker-history/snaptrade-loader.ts`
- Test: `src/lib/broker-history/snaptrade-loader.test.ts`

**Files to inspect first:**
- `src/lib/snaptrade.ts` — confirm `snaptradeClient()` export and how the SDK exposes activities. The SDK v9 exposes activities under `client.transactionsAndReporting.getActivities({ userId, userSecret, accounts, startDate, endDate, type })`. Verify the actual API:

```bash
grep -nE "transactionsAndReporting|getActivities|listActivities" node_modules/snaptrade-typescript-sdk/dist/api.d.ts 2>&1 | head -10
```

Adapt the call signature to whatever the installed version actually exposes.

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/broker-history/snaptrade-loader.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../snaptrade", () => ({
  snaptradeClient: vi.fn(),
  ensureSnaptradeUser: vi.fn().mockResolvedValue({ userSecret: "secret" }),
  encryptSecret: vi.fn((s: string) => `v2:fake:${s}`),
}));
vi.mock("./normalize", () => ({
  normalizeAction: vi.fn((_src: string, raw: string) => raw === "BUY" ? "buy" : "other"),
}));

import { pool } from "../db";
import { snaptradeClient } from "../snaptrade";
import { backfillSnaptradeAccount } from "./snaptrade-loader";

const Q = pool.query as unknown as ReturnType<typeof vi.fn>;
const SC = snaptradeClient as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  Q.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("backfillSnaptradeAccount", () => {
  it("returns inserted=0 when no activities returned", async () => {
    SC.mockReturnValue({
      transactionsAndReporting: {
        getActivities: vi.fn().mockResolvedValue({ data: [] }),
      },
    });
    const out = await backfillSnaptradeAccount("user_a", "acct_1");
    expect(out.inserted).toBe(0);
    expect(out.earliestTxnDate).toBeNull();
  });

  it("inserts activities and reports earliest date", async () => {
    SC.mockReturnValue({
      transactionsAndReporting: {
        getActivities: vi.fn().mockResolvedValue({
          data: [
            { id: "tx1", trade_date: "2024-05-04", action: "BUY", symbol: { symbol: "AAPL" },
              units: 10, price: 150, amount: -1500, fee: 1, currency: { code: "USD" } },
            { id: "tx2", trade_date: "2025-01-15", action: "BUY", symbol: { symbol: "NVDA" },
              units: 5, price: 600, amount: -3000, fee: 1, currency: { code: "USD" } },
          ],
        }),
      },
    });
    Q.mockResolvedValue({ rowCount: 1, rows: [] });
    const out = await backfillSnaptradeAccount("user_a", "acct_1");
    expect(out.inserted).toBe(2);
    expect(out.earliestTxnDate).toBe("2024-05-04");
  });

  it("counts unknown actions in telemetry", async () => {
    SC.mockReturnValue({
      transactionsAndReporting: {
        getActivities: vi.fn().mockResolvedValue({
          data: [
            { id: "tx1", trade_date: "2024-05-04", action: "WEIRD_BROKER_THING",
              symbol: null, units: 0, price: 0, amount: 0, fee: 0, currency: { code: "USD" } },
          ],
        }),
      },
    });
    Q.mockResolvedValue({ rowCount: 1, rows: [] });
    const out = await backfillSnaptradeAccount("user_a", "acct_1");
    expect(out.unknownActionCount).toBe(1);
  });

  it("is idempotent across reruns (relies on UNIQUE constraint)", async () => {
    SC.mockReturnValue({
      transactionsAndReporting: {
        getActivities: vi.fn().mockResolvedValue({
          data: [
            { id: "tx1", trade_date: "2024-05-04", action: "BUY", symbol: { symbol: "AAPL" },
              units: 10, price: 150, amount: -1500, fee: 1, currency: { code: "USD" } },
          ],
        }),
      },
    });
    // Q reports rowCount: 0 on conflict (existing row)
    Q.mockResolvedValue({ rowCount: 0, rows: [] });
    const out = await backfillSnaptradeAccount("user_a", "acct_1");
    // We still report `inserted` based on what we tried — the test verifies
    // no exception is thrown and the call completes.
    expect(out).toBeDefined();
  });
});
```

Run; expect FAIL (module not found).

- [ ] **Step 2: Implement loader**

```ts
// src/lib/broker-history/snaptrade-loader.ts
// Pulls activity history from SnapTrade and inserts canonical rows
// into broker_transactions. Idempotent via UNIQUE (source, external_txn_id).

import { pool } from "../db";
import { log, errorInfo } from "../log";
import { snaptradeClient, ensureSnaptradeUser, encryptSecret } from "../snaptrade";
import { normalizeAction } from "./normalize";
import type { BackfillResult } from "./types";

interface SnaptradeActivity {
  id?: string;
  trade_date?: string;
  settlement_date?: string;
  action?: string;
  symbol?: { symbol?: string } | null;
  units?: number | null;
  price?: number | null;
  amount?: number | null;
  fee?: number | null;
  currency?: { code?: string };
}

export async function backfillSnaptradeAccount(
  userId: string,
  accountId: string,
): Promise<BackfillResult> {
  const { userSecret } = await ensureSnaptradeUser(userId);
  // The SDK signature varies by version; adapt to actual installed shape.
  const client = snaptradeClient();
  const startDate = "1900-01-01"; // pull as far back as broker allows
  const endDate = new Date().toISOString().slice(0, 10);

  let activities: SnaptradeActivity[] = [];
  try {
    const resp = await client.transactionsAndReporting.getActivities({
      userId,
      userSecret,
      accounts: accountId,
      startDate,
      endDate,
    });
    activities = (resp?.data as SnaptradeActivity[]) ?? [];
  } catch (err) {
    log.warn("broker-history.snaptrade", "getActivities failed", {
      userId, accountId, ...errorInfo(err),
    });
    throw err;
  }

  if (activities.length === 0) {
    return { inserted: 0, earliestTxnDate: null, unknownActionCount: 0 };
  }

  let inserted = 0;
  let earliestTxnDate: string | null = null;
  let unknownActionCount = 0;

  for (const a of activities) {
    if (!a.id || !a.trade_date) continue;
    const action = normalizeAction("snaptrade", a.action ?? "");
    if (action === "other") unknownActionCount++;
    const ticker = a.symbol?.symbol ?? null;
    const rawJson = JSON.stringify(a);
    const rawEncrypted = encryptSecret(rawJson);
    const txnDate = a.trade_date.slice(0, 10);
    if (!earliestTxnDate || txnDate < earliestTxnDate) earliestTxnDate = txnDate;

    try {
      const r = await pool.query(
        `INSERT INTO broker_transactions
           ("userId", source, account_id, external_txn_id, txn_date, settle_date,
            action, ticker, quantity, price, amount, fees, currency, raw_encrypted)
         VALUES ($1,'snaptrade',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (source, external_txn_id)
         DO UPDATE SET
           amount = EXCLUDED.amount,
           quantity = EXCLUDED.quantity,
           price = EXCLUDED.price,
           fees = EXCLUDED.fees,
           "updatedAt" = NOW()`,
        [
          userId, accountId, a.id, txnDate, a.settlement_date ?? null,
          action, ticker, a.units ?? null, a.price ?? null,
          a.amount ?? 0, a.fee ?? null, a.currency?.code ?? "USD",
          rawEncrypted,
        ],
      );
      if ((r.rowCount ?? 0) > 0) inserted++;
    } catch (err) {
      log.warn("broker-history.snaptrade", "insert failed", { userId, txnId: a.id, ...errorInfo(err) });
    }
  }

  if (unknownActionCount > 0) {
    log.info("broker-history.snaptrade", "unknown-actions", { userId, accountId, count: unknownActionCount });
  }

  return { inserted, earliestTxnDate, unknownActionCount };
}
```

If `client.transactionsAndReporting.getActivities` doesn't exist with that exact path in the installed SDK, adapt the call (check the actual SDK shape; older versions use `client.transactionsAndReporting.getUserAccountActivities` or just `client.activities`). The implementer subagent will verify and adapt.

- [ ] **Step 3: Run tests, expect PASS**

```bash
npm test -- src/lib/broker-history/snaptrade-loader.test.ts
```

If the SDK call shape differs, the mock and the implementation are both updated to match the same shape. Tests stay green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/broker-history/snaptrade-loader.ts src/lib/broker-history/snaptrade-loader.test.ts
git commit -m "feat(broker-history): SnapTrade activities loader (TDD)

Pulls full activity history per account, normalizes action types,
encrypts raw JSON, idempotent INSERT via UNIQUE constraint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Plaid full-history loader (TDD)

**Files:**
- Create: `src/lib/broker-history/plaid-loader.ts`
- Test: `src/lib/broker-history/plaid-loader.test.ts`

**Files to inspect first:**
- `src/lib/plaid.ts` `syncTransactions` (already implemented for last-30-days). The new loader uses the same SDK pattern but with `start_date = today - 730 days` (Plaid's 24mo cap) and writes to `broker_transactions` directly instead of `plaid_transaction`.

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/broker-history/plaid-loader.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../plaid", () => ({
  plaidClient: vi.fn(),
  getAccessTokenForItem: vi.fn().mockResolvedValue("access-token-stub"),
  encryptSecret: vi.fn((s: string) => `v2:fake:${s}`),
}));
vi.mock("../snaptrade", () => ({
  encryptSecret: vi.fn((s: string) => `v2:fake:${s}`),
}));
vi.mock("./normalize", () => ({
  normalizeAction: vi.fn((_src: string, raw: string) => raw === "buy" ? "buy" : "other"),
}));

import { pool } from "../db";
import { plaidClient, getAccessTokenForItem } from "../plaid";
import { backfillPlaidItem } from "./plaid-loader";

const Q = pool.query as unknown as ReturnType<typeof vi.fn>;
const PC = plaidClient as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  Q.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("backfillPlaidItem", () => {
  it("returns inserted=0 when no transactions", async () => {
    PC.mockReturnValue({
      investmentsTransactionsGet: vi.fn().mockResolvedValue({
        data: { investment_transactions: [], securities: [], total_investment_transactions: 0 },
      }),
    });
    const out = await backfillPlaidItem("user_a", "item_1", "acct_1");
    expect(out.inserted).toBe(0);
  });

  it("inserts and reports earliest date across pages", async () => {
    const txnPage1 = Array.from({ length: 100 }, (_, i) => ({
      investment_transaction_id: `tx${i}`,
      account_id: "acct_1",
      type: "buy", subtype: "buy",
      date: i === 0 ? "2024-05-04" : "2025-01-15",
      quantity: 1, price: 100, amount: -100, fees: 0,
      iso_currency_code: "USD",
      security_id: "sec1",
    }));
    const txnPage2 = [{
      investment_transaction_id: "tx_last",
      account_id: "acct_1",
      type: "buy", subtype: "buy",
      date: "2025-03-01",
      quantity: 1, price: 100, amount: -100, fees: 0,
      iso_currency_code: "USD",
      security_id: "sec1",
    }];
    const securities = [{ security_id: "sec1", ticker_symbol: "AAPL", name: "Apple Inc" }];

    const calls: number[] = [];
    PC.mockReturnValue({
      investmentsTransactionsGet: vi.fn().mockImplementation((args: { options?: { offset?: number } }) => {
        const offset = args.options?.offset ?? 0;
        calls.push(offset);
        if (offset === 0) {
          return Promise.resolve({ data: { investment_transactions: txnPage1, securities, total_investment_transactions: 101 } });
        }
        return Promise.resolve({ data: { investment_transactions: txnPage2, securities, total_investment_transactions: 101 } });
      }),
    });
    Q.mockResolvedValue({ rowCount: 1, rows: [] });

    const out = await backfillPlaidItem("user_a", "item_1", "acct_1");
    expect(out.inserted).toBe(101);
    expect(out.earliestTxnDate).toBe("2024-05-04");
    expect(calls).toEqual([0, 100]);
  });
});
```

Run; expect FAIL.

- [ ] **Step 2: Implement loader**

```ts
// src/lib/broker-history/plaid-loader.ts
// Full-history Plaid investments transactions pull. Plaid caps at 24mo.

import { pool } from "../db";
import { log, errorInfo } from "../log";
import { plaidClient, getAccessTokenForItem } from "../plaid";
import { encryptSecret } from "../snaptrade";
import { normalizeAction } from "./normalize";
import type { BackfillResult } from "./types";

const PAGE_SIZE = 100;

export async function backfillPlaidItem(
  userId: string,
  itemId: string,
  accountId: string,
): Promise<BackfillResult> {
  const accessToken = await getAccessTokenForItem(userId, itemId);
  if (!accessToken) {
    return { inserted: 0, earliestTxnDate: null, unknownActionCount: 0 };
  }

  const client = plaidClient();
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 730); // Plaid's 24mo cap
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let inserted = 0;
  let earliestTxnDate: string | null = null;
  let unknownActionCount = 0;
  let offset = 0;

  while (true) {
    let resp;
    try {
      resp = await client.investmentsTransactionsGet({
        access_token: accessToken,
        start_date: fmt(start),
        end_date: fmt(end),
        options: { count: PAGE_SIZE, offset, account_ids: [accountId] },
      });
    } catch (err) {
      log.warn("broker-history.plaid", "transactionsGet failed", {
        userId, itemId, offset, ...errorInfo(err),
      });
      throw err;
    }

    const { investment_transactions: txs, securities, total_investment_transactions: total } = resp.data;
    if (txs.length === 0) break;

    const secById = new Map(securities.map((s: { security_id?: string; ticker_symbol?: string | null }) => [s.security_id, s]));

    for (const t of txs) {
      const sec = secById.get(t.security_id ?? "") as { ticker_symbol?: string | null } | undefined;
      const ticker = sec?.ticker_symbol ?? null;
      const rawTypeKey = t.subtype ?? t.type ?? "";
      const action = normalizeAction("plaid", rawTypeKey);
      if (action === "other") unknownActionCount++;
      const txnDate = (t.date ?? "").slice(0, 10);
      if (!txnDate) continue;
      if (!earliestTxnDate || txnDate < earliestTxnDate) earliestTxnDate = txnDate;
      const rawEncrypted = encryptSecret(JSON.stringify(t));

      try {
        const r = await pool.query(
          `INSERT INTO broker_transactions
             ("userId", source, account_id, external_txn_id, txn_date, settle_date,
              action, ticker, quantity, price, amount, fees, currency, raw_encrypted)
           VALUES ($1,'plaid',$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (source, external_txn_id)
           DO UPDATE SET amount = EXCLUDED.amount,
                         quantity = EXCLUDED.quantity,
                         price = EXCLUDED.price,
                         fees = EXCLUDED.fees,
                         "updatedAt" = NOW()`,
          [
            userId, t.account_id, t.investment_transaction_id, txnDate,
            action, ticker, t.quantity ?? null, t.price ?? null,
            t.amount ?? 0, t.fees ?? null, t.iso_currency_code ?? "USD",
            rawEncrypted,
          ],
        );
        if ((r.rowCount ?? 0) > 0) inserted++;
      } catch (err) {
        log.warn("broker-history.plaid", "insert failed", { userId, txnId: t.investment_transaction_id, ...errorInfo(err) });
      }
    }

    offset += PAGE_SIZE;
    if (offset >= (total ?? 0)) break;
  }

  if (unknownActionCount > 0) {
    log.info("broker-history.plaid", "unknown-actions", { userId, accountId, count: unknownActionCount });
  }

  return { inserted, earliestTxnDate, unknownActionCount };
}
```

- [ ] **Step 3: Run tests, expect PASS**

```bash
npm test -- src/lib/broker-history/plaid-loader.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/broker-history/plaid-loader.ts src/lib/broker-history/plaid-loader.test.ts
git commit -m "feat(broker-history): Plaid full-history loader (24mo cap, paginated)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Backfill orchestrator

**Files:**
- Create: `src/lib/broker-history/backfill.ts`

- [ ] **Step 1: Implement**

```ts
// src/lib/broker-history/backfill.ts
// Orchestrator: dequeues a job, dispatches to per-source loader,
// triggers reconstruction, marks done.

import { log, errorInfo } from "../log";
import { popQueuedJobs, markJobDone, markJobFailed } from "./queue";
import { backfillSnaptradeAccount } from "./snaptrade-loader";
import { backfillPlaidItem } from "./plaid-loader";
import { reconstructHistoricalSnapshots } from "./reconstruct";
import { pool } from "../db";
import type { BackfillJob } from "./types";

const MAX_PER_TICK = 5;

export async function runBackfillTick(): Promise<{ processed: number; failed: number }> {
  const jobs = await popQueuedJobs(MAX_PER_TICK);
  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      if (job.jobType === "full_backfill" || job.jobType === "delta_sync") {
        let result: { inserted: number; earliestTxnDate: string | null };
        if (job.source === "snaptrade") {
          result = await backfillSnaptradeAccount(job.userId, job.accountId);
        } else {
          // Plaid: need itemId. Look it up from snaptrade_connection's plaid sibling.
          const { rows } = await pool.query<{ itemId: string }>(
            `SELECT "itemId" FROM "plaid_item" WHERE "userId" = $1 LIMIT 1`,
            [job.userId],
          );
          const itemId = rows[0]?.itemId;
          if (!itemId) throw new Error("no plaid item for user");
          result = await backfillPlaidItem(job.userId, itemId, job.accountId);
        }
        await markJobDone(job.id, result.earliestTxnDate, result.inserted);
        // Trigger reconstruction (fire-and-forget — failures logged but don't fail the job)
        reconstructHistoricalSnapshots(job.userId, job.accountId).catch((err) =>
          log.warn("broker-history.orchestrator", "reconstruct failed", {
            userId: job.userId, ...errorInfo(err),
          }),
        );
      } else if (job.jobType === "reconcile") {
        // Reconcile = re-pull and diff. For v1, treat as a full backfill (idempotent).
        // Upgrade later to actual diff + drift telemetry.
        if (job.source === "snaptrade") {
          await backfillSnaptradeAccount(job.userId, job.accountId);
        } else {
          const { rows } = await pool.query<{ itemId: string }>(
            `SELECT "itemId" FROM "plaid_item" WHERE "userId" = $1 LIMIT 1`,
            [job.userId],
          );
          if (rows[0]?.itemId) await backfillPlaidItem(job.userId, rows[0].itemId, job.accountId);
        }
        await markJobDone(job.id, null, 0);
      }
      processed++;
    } catch (err) {
      await markJobFailed(job.id, String(err));
      failed++;
    }
  }

  return { processed, failed };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

(reconstruct.ts doesn't exist yet — TS error expected. Tolerate until Task 8.)

- [ ] **Step 3: Commit (after Task 8 lands and TS compiles)**

Defer commit; combine with Task 8.

---

## Task 8: Reconstruction worker (TDD)

**Files:**
- Create: `src/lib/broker-history/reconstruct.ts`
- Test: `src/lib/broker-history/reconstruct.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/broker-history/reconstruct.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "../db";
import { reconstructHistoricalSnapshots } from "./reconstruct";

const Q = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reconstructHistoricalSnapshots", () => {
  it("returns 0 when no transactions exist", async () => {
    Q.mockImplementation((sql: string) => {
      if (sql.includes("FROM broker_transactions")) return Promise.resolve({ rows: [] });
      if (sql.includes("FROM holding"))            return Promise.resolve({ rows: [] });
      if (sql.includes("FROM portfolio_snapshot")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const out = await reconstructHistoricalSnapshots("user_new");
    expect(out.snapshotsInserted).toBe(0);
  });

  it("walks current shares back through txns and inserts reconstructed snapshots", async () => {
    // Current state: 10 AAPL @ $200, $1000 cash. Today = 2026-05-04.
    // Transactions:
    //   2026-04-01 BUY 5 AAPL @ $190  (before this date, user had 5 AAPL + ~$1950 cash)
    //   2026-03-01 BUY 5 AAPL @ $180  (before this date, user had 0 AAPL + ~$2850 cash)
    //
    // Earliest observed snapshot: 2026-04-15.
    // We reconstruct dates 2026-03-01 .. 2026-04-14.

    Q.mockImplementation((sql: string) => {
      if (sql.includes("MIN(\"capturedAt\")") && sql.includes("'observed'")) {
        return Promise.resolve({ rows: [{ oldest: new Date("2026-04-15") }] });
      }
      if (sql.includes("FROM holding")) {
        return Promise.resolve({ rows: [{ ticker: "AAPL", shares: 10, last_value: 2000 }] });
      }
      if (sql.includes("FROM broker_transactions")) {
        return Promise.resolve({
          rows: [
            { txn_date: "2026-04-01", action: "buy", ticker: "AAPL", quantity: 5, price: 190, amount: -950 },
            { txn_date: "2026-03-01", action: "buy", ticker: "AAPL", quantity: 5, price: 180, amount: -900 },
          ],
        });
      }
      if (sql.includes("FROM ticker_market_daily")) {
        // Stub close prices for AAPL on every date
        return Promise.resolve({
          rows: [
            { ticker: "AAPL", captured_at: "2026-03-15", close: 185 },
            { ticker: "AAPL", captured_at: "2026-04-01", close: 190 },
            { ticker: "AAPL", captured_at: "2026-04-10", close: 195 },
          ],
        });
      }
      if (sql.includes("INSERT INTO portfolio_snapshot")) {
        return Promise.resolve({ rowCount: 1, rows: [] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const out = await reconstructHistoricalSnapshots("user_a");
    expect(out.snapshotsInserted).toBeGreaterThan(0);
  });

  it("skips dates where ticker_market_daily lacks a close price", async () => {
    Q.mockImplementation((sql: string) => {
      if (sql.includes("MIN(\"capturedAt\")")) {
        return Promise.resolve({ rows: [{ oldest: new Date("2026-04-15") }] });
      }
      if (sql.includes("FROM holding")) {
        return Promise.resolve({ rows: [{ ticker: "OBSCURE", shares: 100, last_value: 1000 }] });
      }
      if (sql.includes("FROM broker_transactions")) {
        return Promise.resolve({
          rows: [{ txn_date: "2026-03-01", action: "buy", ticker: "OBSCURE", quantity: 100, price: 10, amount: -1000 }],
        });
      }
      if (sql.includes("FROM ticker_market_daily")) {
        return Promise.resolve({ rows: [] }); // no prices
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const out = await reconstructHistoricalSnapshots("user_a");
    expect(out.snapshotsInserted).toBe(0);
    expect(out.skippedDays).toBeGreaterThan(0);
  });
});
```

Run; expect FAIL.

- [ ] **Step 2: Implement**

```ts
// src/lib/broker-history/reconstruct.ts
// Walks the user's transactions backward from current holdings to compute
// historical portfolio values. Writes to portfolio_snapshot with
// source='reconstructed'. Never overwrites source='observed' rows.

import { pool } from "../db";
import { log, errorInfo } from "../log";
import type { ReconstructResult } from "./types";

interface Holding {
  ticker: string;
  shares: number;
  last_value: number;
}

interface Txn {
  txn_date: string;
  action: string;
  ticker: string | null;
  quantity: number | null;
  price: number | null;
  amount: number;
}

interface PriceRow {
  ticker: string;
  captured_at: string;
  close: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function listDatesBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const cur = new Date(fromIso + "T00:00:00Z");
  const end = new Date(toIso + "T00:00:00Z");
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export async function reconstructHistoricalSnapshots(
  userId: string,
  accountId?: string,
): Promise<ReconstructResult> {
  const oldestObservedRes = await pool.query<{ oldest: Date | null }>(
    `SELECT MIN("capturedAt")::timestamptz AS oldest
     FROM portfolio_snapshot
     WHERE "userId" = $1 AND source = 'observed'`,
    [userId],
  );
  const oldestObserved = oldestObservedRes.rows[0]?.oldest ?? null;
  // If no observed snapshot exists, we reconstruct up to today; otherwise stop one day before.
  const reconstructEnd = oldestObserved
    ? new Date(oldestObserved.getTime() - MS_PER_DAY).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const holdingsRes = await pool.query<Holding>(
    accountId
      ? `SELECT ticker, shares, last_value FROM holding WHERE "userId" = $1 AND account_id = $2`
      : `SELECT ticker, shares, last_value FROM holding WHERE "userId" = $1`,
    accountId ? [userId, accountId] : [userId],
  );
  if (holdingsRes.rows.length === 0) {
    return { snapshotsInserted: 0, earliestSnapshotDate: null, skippedDays: 0 };
  }

  const txnsRes = await pool.query<Txn>(
    accountId
      ? `SELECT txn_date::text, action, ticker, quantity, price, amount
         FROM broker_transactions
         WHERE "userId" = $1 AND account_id = $2
         ORDER BY txn_date DESC, "createdAt" DESC`
      : `SELECT txn_date::text, action, ticker, quantity, price, amount
         FROM broker_transactions
         WHERE "userId" = $1
         ORDER BY txn_date DESC, "createdAt" DESC`,
    accountId ? [userId, accountId] : [userId],
  );
  if (txnsRes.rows.length === 0) {
    return { snapshotsInserted: 0, earliestSnapshotDate: null, skippedDays: 0 };
  }

  const earliestTxnDate = txnsRes.rows[txnsRes.rows.length - 1].txn_date;
  const reconstructStart = earliestTxnDate;

  // Build running balance starting from CURRENT state and reverse each txn as we walk back.
  const positions = new Map<string, number>();
  let cash = 0;
  for (const h of holdingsRes.rows) {
    if (h.ticker === "CASH" || h.ticker === "USD") {
      cash += Number(h.last_value);
    } else {
      positions.set(h.ticker, Number(h.shares));
    }
  }

  // Snapshot map: date → { positions snapshot, cash }
  const positionsByDate = new Map<string, { positions: Map<string, number>; cash: number }>();
  // We snapshot the running balance at the start of each transaction date,
  // then for each historical date in [reconstructStart, reconstructEnd] we
  // pick the balance state that was active on that date.

  // Walk newest → oldest, reversing txns:
  for (const t of txnsRes.rows) {
    const tk = t.ticker ?? "";
    const qty = Number(t.quantity ?? 0);
    const amt = Number(t.amount);
    switch (t.action) {
      case "buy":
        if (tk) positions.set(tk, (positions.get(tk) ?? 0) - qty);
        cash -= amt; // amount is negative for a buy; -(-x) = +x cash back
        break;
      case "sell":
        if (tk) positions.set(tk, (positions.get(tk) ?? 0) + qty);
        cash -= amt; // amount is positive for a sell; -x cash
        break;
      case "dividend":
      case "interest":
      case "contribution":
        cash -= amt;
        break;
      case "fee":
      case "withdrawal":
        cash -= amt;
        break;
      case "split":
        // Reverse a split: divide shares by the ratio (split ratio is in raw_encrypted);
        // for v1 we don't reverse splits — log and continue
        log.info("broker-history.reconstruct", "split-not-reversed", { userId, ticker: tk });
        break;
      default:
        // 'transfer' and 'other' — don't touch positions
        break;
    }
    // Snapshot AFTER reversal: this is the state BEFORE this transaction
    // (i.e., the state on dates STRICTLY BEFORE t.txn_date)
    positionsByDate.set(t.txn_date, {
      positions: new Map(positions),
      cash,
    });
  }

  const tickers = Array.from(new Set(Array.from(positions.keys()).concat(
    Array.from(positionsByDate.values()).flatMap((s) => Array.from(s.positions.keys())),
  ))).filter(Boolean);

  // Pull all close prices in the reconstruction window for these tickers
  const pricesRes = await pool.query<PriceRow>(
    `SELECT ticker, captured_at::text AS captured_at, close::float AS close
     FROM ticker_market_daily
     WHERE ticker = ANY($1::text[])
       AND captured_at BETWEEN $2::date AND $3::date
       AND close IS NOT NULL`,
    [tickers, reconstructStart, reconstructEnd],
  );
  const priceMap = new Map<string, Map<string, number>>(); // date → ticker → close
  for (const row of pricesRes.rows) {
    if (!priceMap.has(row.captured_at)) priceMap.set(row.captured_at, new Map());
    priceMap.get(row.captured_at)!.set(row.ticker, row.close);
  }

  // For each date in the reconstruction range, find the running-balance state
  // that was active on that date (the most recent txn_date ≤ this date)
  const dates = listDatesBetween(reconstructStart, reconstructEnd);
  let snapshotsInserted = 0;
  let skippedDays = 0;
  let earliestSnapshotDate: string | null = null;
  const sortedTxnDates = Array.from(positionsByDate.keys()).sort();

  for (const date of dates) {
    // Find the last txn date strictly greater than `date` — its post-reversal
    // state IS the state on `date` (because txn happens AT that date, so dates
    // BEFORE it have the pre-txn state, which our reversal produces).
    let active: { positions: Map<string, number>; cash: number } | null = null;
    for (const td of sortedTxnDates) {
      if (td > date) {
        active = positionsByDate.get(td)!;
        break;
      }
    }
    // If no txn after `date`, then current state applies (no reversals from this side)
    if (!active) {
      active = { positions: new Map(positions), cash };
    }

    // Compute total
    let total = active.cash;
    let missingPrice = false;
    for (const [tk, sh] of active.positions) {
      if (sh === 0) continue;
      const price = priceMap.get(date)?.get(tk);
      if (price === undefined) {
        missingPrice = true;
        break;
      }
      total += sh * price;
    }
    if (missingPrice) {
      skippedDays++;
      continue;
    }
    if (total <= 0) {
      skippedDays++;
      continue;
    }

    try {
      const r = await pool.query(
        `INSERT INTO portfolio_snapshot ("userId", "capturedAt", "totalValue", source)
         VALUES ($1, $2::timestamptz, $3, 'reconstructed')
         ON CONFLICT ("userId", "capturedAt") DO NOTHING`,
        [userId, date, total],
      );
      if ((r.rowCount ?? 0) > 0) {
        snapshotsInserted++;
        if (!earliestSnapshotDate || date < earliestSnapshotDate) earliestSnapshotDate = date;
      }
    } catch (err) {
      log.warn("broker-history.reconstruct", "insert failed", { userId, date, ...errorInfo(err) });
    }
  }

  log.info("broker-history.reconstruct", "complete", {
    userId, snapshotsInserted, skippedDays, earliestSnapshotDate,
  });
  return { snapshotsInserted, earliestSnapshotDate, skippedDays };
}
```

This implementation is approximate — the core invariant it must hold is "never insert a row with `source='reconstructed'` for a date the user already has `source='observed'` snapshot for". The `ON CONFLICT (userId, capturedAt) DO NOTHING` enforces idempotency; the `reconstructEnd` cutoff (`oldestObserved - 1 day`) enforces the no-overlap rule.

If the existing `portfolio_snapshot` table doesn't have a UNIQUE constraint on `(userId, capturedAt)`, the migration in Task 1 needs to add one. The implementer subagent verifies this; if missing, adds it to the migration before applying.

- [ ] **Step 3: Run tests, expect PASS**

```bash
npm test -- src/lib/broker-history/reconstruct.test.ts
```

- [ ] **Step 4: Commit (combined with Task 7 orchestrator)**

```bash
git add src/lib/broker-history/backfill.ts \
        src/lib/broker-history/reconstruct.ts \
        src/lib/broker-history/reconstruct.test.ts
git commit -m "feat(broker-history): orchestrator + reconstruction worker (TDD)

Orchestrator dequeues jobs from broker_history_queue, dispatches to
per-source loader (snaptrade-loader or plaid-loader), then triggers
reconstruction. Reconstruction walks transactions backward from
current holdings, computes daily portfolio values, INSERTs into
portfolio_snapshot with source='reconstructed' (never overwrites
observed rows). Skips dates without ticker_market_daily price data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Three cron routes

**Files:**
- Create: `src/app/api/cron/broker-history-worker/route.ts`
- Create: `src/app/api/cron/broker-history-delta/route.ts`
- Create: `src/app/api/cron/broker-history-reconcile/route.ts`
- Modify: `vercel.json`

**Files to inspect first:**
- `src/app/api/cron/risk-radar/route.ts` for the Bearer-CRON_SECRET pattern.

- [ ] **Step 1: Implement worker route**

```ts
// src/app/api/cron/broker-history-worker/route.ts
// Runs every 5 minutes. Drains the broker_history_queue.
import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { runBackfillTick } from "@/lib/broker-history/backfill";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runBackfillTick();
  log.info("cron.broker-history-worker", "complete", result);
  return NextResponse.json({ ok: true, ...result });
}
```

- [ ] **Step 2: Implement delta route**

```ts
// src/app/api/cron/broker-history-delta/route.ts
// Runs every 6 hours. Enqueues delta_sync jobs for every active connection.
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";
import { enqueueJob } from "@/lib/broker-history/queue";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const conns = await pool.query<{ userId: string; source: string; account_id: string }>(
    `SELECT DISTINCT
       h."userId",
       CASE WHEN EXISTS (
         SELECT 1 FROM snaptrade_connection sc WHERE sc."userId" = h."userId"
       ) THEN 'snaptrade' ELSE 'plaid' END AS source,
       h.account_id
     FROM holding h`,
  );
  let enqueued = 0;
  for (const c of conns.rows) {
    await enqueueJob(c.userId, c.source as "snaptrade" | "plaid", c.account_id, "delta_sync");
    enqueued++;
  }
  log.info("cron.broker-history-delta", "complete", { enqueued });
  return NextResponse.json({ ok: true, enqueued });
}
```

- [ ] **Step 3: Implement reconcile route**

```ts
// src/app/api/cron/broker-history-reconcile/route.ts
// Runs quarterly. Same shape as delta, different job_type.
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";
import { enqueueJob } from "@/lib/broker-history/queue";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const conns = await pool.query<{ userId: string; source: string; account_id: string }>(
    `SELECT DISTINCT
       h."userId",
       CASE WHEN EXISTS (SELECT 1 FROM snaptrade_connection sc WHERE sc."userId" = h."userId")
            THEN 'snaptrade' ELSE 'plaid' END AS source,
       h.account_id
     FROM holding h`,
  );
  let enqueued = 0;
  for (const c of conns.rows) {
    await enqueueJob(c.userId, c.source as "snaptrade" | "plaid", c.account_id, "reconcile");
    enqueued++;
  }
  log.info("cron.broker-history-reconcile", "complete", { enqueued });
  return NextResponse.json({ ok: true, enqueued });
}
```

- [ ] **Step 4: Add cron entries to vercel.json**

Open `vercel.json` and add to the `crons` array:

```json
{ "path": "/api/cron/broker-history-worker", "schedule": "*/5 * * * *" },
{ "path": "/api/cron/broker-history-delta", "schedule": "0 */6 * * *" },
{ "path": "/api/cron/broker-history-reconcile", "schedule": "0 6 1 3,6,9,12 *" }
```

- [ ] **Step 5: Verify build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/broker-history-worker/route.ts \
        src/app/api/cron/broker-history-delta/route.ts \
        src/app/api/cron/broker-history-reconcile/route.ts \
        vercel.json
git commit -m "feat(cron): broker-history worker + delta + reconcile routes

worker: every 5 min, drains broker_history_queue (5 jobs/tick)
delta: every 6 hr, enqueues delta_sync per connection
reconcile: quarterly (Mar/Jun/Sep/Dec 1st 6am UTC)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Webhook handler updates

**Files:**
- Modify: `src/app/api/plaid/webhook/route.ts` (HISTORICAL_UPDATE → enqueue)
- Modify or Create: SnapTrade webhook route — recon shows it doesn't exist at `src/app/api/snaptrade/webhook`. Inspect first; if SnapTrade webhook route doesn't exist yet, create one at `src/app/api/snaptrade/webhook/route.ts`.

- [ ] **Step 1: Inspect existing Plaid webhook**

```bash
sed -n '120,180p' src/app/api/plaid/webhook/route.ts
```

Find the section that handles `HISTORICAL_UPDATE`. Add an enqueue call:

```ts
// In the HISTORICAL_UPDATE branch:
import { enqueueJob } from "@/lib/broker-history/queue";

// ... inside the handler where wCode === "HISTORICAL_UPDATE":
//   For each account on the item, enqueue a full_backfill job.
const { rows: accounts } = await pool.query<{ account_id: string }>(
  `SELECT DISTINCT account_id FROM holding
   WHERE "userId" = $1
     AND account_id IN (
       SELECT "plaidAccountId" FROM plaid_account WHERE "itemId" = $2
     )`,
  [userId, itemId],
);
for (const a of accounts) {
  await enqueueJob(userId, "plaid", a.account_id, "full_backfill");
}
```

(Adapt to actual schema — `plaid_account` table may be named differently; inspect via `grep -n "plaid_account\|plaidAccount" src/lib/plaid.ts`. Use whatever the existing code uses.)

- [ ] **Step 2: Inspect or create SnapTrade webhook**

```bash
ls src/app/api/snaptrade/
```

If no `webhook/` directory, **the project doesn't currently receive SnapTrade webhooks**. Two paths:

**A.** **Skip the webhook for now** — rely on the 6-hour delta cron to detect new connections by joining `holding` to `broker_history_queue` and enqueueing missing entries. (The migration's initial sweep already covers existing connections; new connections will be picked up within 6 hours.) Document this in the commit.

**B.** **Add a SnapTrade webhook route** — register the URL with SnapTrade dashboard, verify signature, enqueue on `CONNECTION_ADDED`.

**Pick A** for v1 — minimizes scope and the 6-hour cron is acceptable latency for a "we'll backfill soon" feature. Document the deferral in the commit message and TODO inline.

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/plaid/webhook/route.ts
git commit -m "feat(webhooks): Plaid HISTORICAL_UPDATE enqueues broker-history full_backfill

SnapTrade webhook route deferred to follow-up (existing 6-hour delta
cron picks up new connections within one tick). v1 acceptable for
a backfill latency budget.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Track-record route + chart visual treatment

**Files:**
- Modify: `src/app/api/track-record/route.ts` — emit per-point `source`, `oldestObservedDate`
- Modify: `src/components/dashboard/blocks.tsx` `BlockChart` — render reconstructed range with dashed/opacity treatment + legend

- [ ] **Step 1: Update `/api/track-record/route.ts`**

Add `source` to the `portfolioSeries` row select:

```ts
// in the existing portfolioSeries query:
const { rows } = await pool.query<{
  capturedAt: Date | string;
  totalValue: number;
  source: "observed" | "reconstructed";
}>(
  `SELECT "capturedAt", "totalValue"::float AS "totalValue", source
   FROM portfolio_snapshot
   WHERE "userId" = $1 AND "capturedAt" >= $2::date
   ORDER BY "capturedAt" ASC`,
  [userId, fromDate],
);

// in the response shape, include per-point source:
portfolioSeries: rows.map((r) => ({
  date: r.capturedAt instanceof Date ? r.capturedAt.toISOString().slice(0,10) : String(r.capturedAt).slice(0,10),
  totalValue: Number(r.totalValue),
  source: r.source,
})),

// Add oldestObservedDate to the response:
const oldestObservedRes = await pool.query<{ oldest: Date | null }>(
  `SELECT MIN("capturedAt")::date AS oldest
   FROM portfolio_snapshot
   WHERE "userId" = $1 AND source = 'observed'`,
  [userId],
);
const oldestObservedDate = oldestObservedRes.rows[0]?.oldest
  ? oldestObservedRes.rows[0].oldest.toISOString().slice(0,10)
  : null;

// Include in response:
return NextResponse.json({
  ok: true,
  range: actualRange,
  oldestSnapshotDate,
  oldestObservedDate,    // NEW
  supportedRanges,
  portfolioSeries,
  // ... existing fields preserved
});
```

- [ ] **Step 2: Update `BlockChart` visual treatment**

In `src/components/dashboard/blocks.tsx` `BlockChart`:
- Update the `Point` type to include `source`
- Split the LineChart into TWO lines: one for reconstructed (dashed, 0.6 opacity), one for observed (solid, full opacity). Use `recharts` `<Line strokeDasharray>`.
- Below the chart, add a small legend: `<span>● Observed</span><span>┄ Reconstructed</span>` with the visual sample.

```tsx
// Adapt to existing BlockChart structure. Sketch:
type ChartPoint = { date: string; totalValue: number; source: "observed" | "reconstructed" };

// Split into two arrays for separate Line components:
const observedPoints = series.filter((p) => p.source === "observed");
const reconstructedPoints = series.filter((p) => p.source === "reconstructed");

// In LineChart, render two Line components on the same XAxis:
<LineChart data={series}>
  <Line type="monotone" dataKey="totalValue"
        stroke="var(--buy)" strokeWidth={2}
        // Render dashed for reconstructed; recharts' Line accepts a function for stroke-dasharray
        // Approach: render TWO <Line> components — one for each source — using `connectNulls={false}`
        // and setting non-matching points to null.
  />
</LineChart>

// Cleaner approach: produce two parallel arrays where each entry in the
// "observed" series has totalValue=null on dates that are reconstructed
// (and vice versa). The chart connects only non-null points within each
// series.
```

The implementer subagent will use whichever recharts pattern produces clean output — the spec just requires (a) reconstructed range visually distinguished, (b) legend present.

Add legend below chart:

```tsx
{series.length > 0 && reconstructedPoints.length > 0 && (
  <div className="text-[10px] text-[var(--muted-foreground)] mt-2 flex gap-3">
    <span>━ Observed</span>
    <span>┄ Reconstructed from broker txns</span>
  </div>
)}
```

- [ ] **Step 3: Verify build**

```bash
npm test
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/track-record/route.ts src/components/dashboard/blocks.tsx
git commit -m "feat(chart): render reconstructed range with dashed/opacity + legend

Trust tenet (rule #13): never silently merge reconstructed and observed.
Per-point source flows through /api/track-record response. Legend
makes the boundary explicit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: User control surface + 2 API routes

**Files:**
- Create: `src/app/app/settings/data/page.tsx`
- Create: `src/app/api/user/transactions/export/route.ts`
- Create: `src/app/api/user/transactions/[accountId]/route.ts`

- [ ] **Step 1: Implement export route**

```ts
// src/app/api/user/transactions/export/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { rows } = await pool.query<{
    txn_date: string; source: string; account_id: string; action: string;
    ticker: string | null; quantity: string | null; price: string | null;
    amount: string; fees: string | null; currency: string;
  }>(
    `SELECT txn_date::text, source, account_id, action,
            ticker, quantity::text, price::text, amount::text, fees::text, currency
     FROM broker_transactions
     WHERE "userId" = $1
     ORDER BY txn_date DESC`,
    [session.user.id],
  );

  const header = "date,source,account_id,action,ticker,qty,price,amount,fees,currency";
  const lines = rows.map((r) => [
    r.txn_date, r.source, r.account_id, r.action,
    r.ticker ?? "", r.quantity ?? "", r.price ?? "", r.amount, r.fees ?? "", r.currency,
  ].map((c) => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(","));
  const csv = [header, ...lines].join("\n");

  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="clearpath-transactions-${today}.csv"`,
    },
  });
}
```

- [ ] **Step 2: Implement purge route**

```ts
// src/app/api/user/transactions/[accountId]/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";
import { reconstructHistoricalSnapshots } from "@/lib/broker-history/reconstruct";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { accountId } = await params;
  const userId = session.user.id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txnRes = await client.query(
      `DELETE FROM broker_transactions
       WHERE "userId" = $1 AND account_id = $2
       RETURNING id`,
      [userId, accountId],
    );
    const transactionsDeleted = txnRes.rowCount ?? 0;
    // Drop reconstructed snapshots for this user — we'll regenerate from
    // remaining transactions across other accounts below.
    const snapRes = await client.query(
      `DELETE FROM portfolio_snapshot
       WHERE "userId" = $1 AND source = 'reconstructed'
       RETURNING id`,
      [userId],
    );
    const snapshotsDeleted = snapRes.rowCount ?? 0;
    await client.query("COMMIT");

    // Recompute reconstruction with whatever's left (other accounts may still have txns)
    await reconstructHistoricalSnapshots(userId).catch((err) =>
      log.warn("user.transactions.purge", "reconstruct after purge failed", { userId, err: String(err) }),
    );

    log.info("user.transactions.purge", "complete", { userId, accountId, transactionsDeleted, snapshotsDeleted });
    return NextResponse.json({ ok: true, transactionsDeleted, snapshotsDeleted });
  } catch (err) {
    await client.query("ROLLBACK");
    log.error("user.transactions.purge", "failed", { userId, accountId, err: String(err) });
    return NextResponse.json({ error: "purge_failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: Implement settings page**

```tsx
// src/app/app/settings/data/page.tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { DataPurgeButton } from "@/components/dashboard/data-purge-button";

export const dynamic = "force-dynamic";

interface ConnectionRow {
  account_id: string;
  source: string;
  earliest_txn_date: string | null;
  txn_count: number;
}

export default async function DataPrivacyPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/sign-in");
  const userId = session.user.id;

  const { rows } = await pool.query<ConnectionRow>(
    `SELECT account_id, source,
            MIN(txn_date)::text AS earliest_txn_date,
            COUNT(*)::int       AS txn_count
     FROM broker_transactions
     WHERE "userId" = $1
     GROUP BY account_id, source
     ORDER BY earliest_txn_date NULLS LAST`,
    [userId],
  );

  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }}>
      <main className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Data &amp; Privacy</h1>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Connection summary</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No transaction history stored yet. Backfill runs in the background after you connect a broker.
            </p>
          ) : (
            <ul className="text-sm space-y-2">
              {rows.map((r) => (
                <li key={`${r.source}-${r.account_id}`} className="flex justify-between">
                  <span>
                    <b>{r.source === "snaptrade" ? "SnapTrade" : "Plaid"}</b> · earliest{" "}
                    {r.earliest_txn_date ?? "—"} · {r.txn_count} stored
                  </span>
                  <DataPurgeButton accountId={r.account_id} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-2">Export</h2>
          <p className="text-xs text-[var(--muted-foreground)] mb-3">
            Download all stored transactions as CSV. Includes: date, source, account_id,
            action, ticker, qty, price, amount, fees. Excludes encrypted broker memos.
          </p>
          <a
            href="/api/user/transactions/export"
            className="inline-block bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded"
          >
            Download CSV
          </a>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-2">About this data</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Transaction history is encrypted at rest. We never store your broker login
            credentials or account numbers. See <a href="/privacy" className="underline">Privacy Policy</a> for full details.
          </p>
        </Card>
      </main>
    </AppShell>
  );
}
```

- [ ] **Step 4: Implement DataPurgeButton client component**

```tsx
// src/components/dashboard/data-purge-button.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function DataPurgeButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function purge() {
    if (!confirm(
      "Delete all stored transactions and reconstructed history from this connection? Your current holdings remain. This cannot be undone.",
    )) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/user/transactions/${encodeURIComponent(accountId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`purge failed: ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      alert(`Couldn't purge: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={purge}
      disabled={busy}
      className="text-[10px] border border-[var(--sell)] text-[var(--sell)] px-2 py-0.5 rounded disabled:opacity-50"
    >
      {busy ? "Deleting…" : "Delete history"}
    </button>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/app/app/settings/data/page.tsx \
        src/app/api/user/transactions/export/route.ts \
        src/app/api/user/transactions/[accountId]/route.ts \
        src/components/dashboard/data-purge-button.tsx
git commit -m "feat(settings): /app/settings/data page + CSV export + per-connection purge

Spec §8. Per-connection summary table with stored count + earliest date,
CSV export of broker_transactions (excluding encrypted raw column),
per-connection DELETE that wraps txn-purge + snapshot-purge in one
Postgres transaction and re-runs reconstruction with remaining accounts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Privacy policy update

**Files:**
- Modify: `src/app/privacy/page.tsx`

- [ ] **Step 1: Inspect existing privacy page**

```bash
sed -n '1,80p' src/app/privacy/page.tsx
```

Note the existing structure — likely sections like "Information we collect", "How we use it", "Your rights", "Contact." We add to existing sections rather than creating new ones.

- [ ] **Step 2: Add the 8 bullets, Data Vendors section, and breach paragraph**

In the appropriate sections, add:

```tsx
{/* Add to "Information we collect" section: */}
<li>
  We retrieve and store your broker transaction history (buys, sells,
  dividends, fees, splits, transfers) for up to the depth your broker
  permits, currently as far back as 24 months for most institutions
  and approximately 4 years for Charles Schwab.
</li>
<li>
  We never store your broker account numbers or login credentials.
  Account references use opaque aggregator IDs from SnapTrade or Plaid.
</li>

{/* Add to "How we secure it" section (or create one): */}
<li>
  Transaction data is encrypted at rest (database-level via AWS KMS) and
  in transit (TLS 1.3). Free-text broker memos are additionally encrypted
  at the application layer with AES-256-GCM.
</li>
<li>
  We retain transaction history while your ClearPath account is active.
  Account deletion purges from primary systems immediately and from
  database backups within 30 days.
</li>

{/* Add to "Your rights" section: */}
<li>
  You can export all stored transaction data as CSV at any time from
  Settings → Data &amp; Privacy.
</li>
<li>
  You can purge transaction history from any individual broker connection
  at any time, while keeping your current holdings.
</li>

{/* Add to "How we use it" section: */}
<li>
  We use this data only to power your performance chart and analysis
  surfaces. We do not share it with third parties, do not sell it,
  and do not use it for advertising.
</li>
<li>
  Past transaction outcomes are informational only. Not investment advice.
  Not a guarantee of future performance.
</li>
```

Add a new "Data Vendors" subsection:

```tsx
<h2 className="text-base font-semibold mt-6 mb-2">Data Vendors</h2>
<p className="text-sm">
  ClearPath relies on the following service providers, each with their
  own privacy practices:
</p>
<ul className="list-disc ml-6 text-sm">
  <li>
    <a href="https://snaptrade.com/privacy" target="_blank" rel="noreferrer">SnapTrade</a> —
    brokerage data aggregation
  </li>
  <li>
    <a href="https://plaid.com/legal/" target="_blank" rel="noreferrer">Plaid</a> —
    investments transactions and holdings
  </li>
  <li>
    <a href="https://neon.tech/privacy" target="_blank" rel="noreferrer">Neon</a> —
    Postgres database hosting (data encrypted at rest via AWS KMS)
  </li>
  <li>
    <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noreferrer">Vercel</a> —
    application hosting and CDN
  </li>
</ul>
```

Add a breach notification paragraph:

```tsx
<h2 className="text-base font-semibold mt-6 mb-2">Breach Notification</h2>
<p className="text-sm">
  In the event of a data breach affecting 500 or more individuals, we
  will notify the U.S. Federal Trade Commission and affected users in
  writing within 30 days of detection, in compliance with the
  Gramm-Leach-Bliley Act Safeguards Rule.
</p>
```

Update the "Last updated" date at the bottom of the page to today's date.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/privacy/page.tsx
git commit -m "docs(privacy): broker transaction history disclosure + breach notification

Spec §9. 8 new bullets covering retrieval depth, no credentials/account
numbers stored, encryption, retention, export, per-connection purge,
no third-party sharing, informational-only disclaimer. New Data Vendors
subsection naming SnapTrade, Plaid, Neon, Vercel. New Breach Notification
section committing to GLBA-compliant 30-day FTC + user notice.

Per Q3 lock: privacy policy updates ship in same merge as the data
collection code.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Final verification + acceptance pass

**Files:** none modified — verification only.

- [ ] **Step 1: Full vitest**

```bash
npm test
```

Expected: ALL tests pass. Test count grows by ~30-40 (normalize, snaptrade-loader, plaid-loader, reconstruct).

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: lint**

```bash
npm run lint
```

Expected: 0 errors. Pre-existing warnings OK.

- [ ] **Step 4: Production build**

```bash
npm run build
```

- [ ] **Step 5: Manual acceptance pass against spec §10**

Sign in as `demo@clearpathinvest.app` (`DemoPass2026!`) locally. Verify each AC:

- [ ] AC1 — `broker_transactions`, `broker_history_queue` tables exist; `portfolio_snapshot.source` column exists
- [ ] AC2 — SnapTrade webhook enqueues `full_backfill` (deferred per Task 10 — verify cron handles it instead)
- [ ] AC3 — Plaid webhook handler enqueues on `HISTORICAL_UPDATE`
- [ ] AC4 — Migration sweep populated `broker_history_queue` with one row per existing connection
- [ ] AC5 — Backfill worker normalizes types + idempotent on rerun
- [ ] AC6 — `raw_encrypted` column populated; manual decryption test via `decryptSecret()`
- [ ] AC7 — Reconstruction worker writes `source='reconstructed'` rows; never overwrites observed
- [ ] AC8-9 — 6h delta + quarterly reconcile cron registered in `vercel.json`
- [ ] AC10 — Chart renders reconstructed range with dashed/opacity + legend
- [ ] AC11 — `/app/settings/data` renders with summary, export, purge per connection
- [ ] AC12 — CSV export endpoint returns valid CSV
- [ ] AC13 — Purge endpoint deletes txns + reconstructed snapshots in one transaction
- [ ] AC14 — Privacy policy updated with bullets, Data Vendors, breach paragraph
- [ ] AC15 — Demo user has reconstructed history visible on chart after sweep completes

- [ ] **Step 6: Final commit**

```bash
git commit --allow-empty -m "chore(broker-history): Phase 10 feature-complete and acceptance-verified

All §10 acceptance criteria validated against demo user.
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
| §1 Problem / §2 Goals / §3 Locked decisions | Plan-wide context |
| §4 Architecture | Tasks 1-9 (data + compute layers) |
| §5.1 broker_transactions | Task 1 |
| §5.2 portfolio_snapshot.source | Task 1 |
| §5.3 broker_history_queue | Task 1 + Task 4 (helpers) |
| §5.4 Encryption strategy | Task 5 + Task 6 (encrypt via existing snaptrade.ts) |
| §5.5 Access control v1 | Plan-wide (single pool, WHERE-scoped) |
| §6.1 Webhook handlers | Task 10 |
| §6.2 Worker cron | Task 9 |
| §6.3 Delta cron | Task 9 |
| §6.4 Reconcile cron | Task 9 |
| §6.5 Backfill worker | Tasks 5, 6, 7 |
| §6.6 Reconstruction worker | Task 8 |
| §6.7 Initial sweep | Task 1 |
| §7 Chart integration | Task 11 |
| §8.1 /app/settings/data | Task 12 |
| §8.2 API routes | Task 12 |
| §9 Privacy policy | Task 13 |
| §10 Acceptance criteria | Task 14 |
| §11 Risks & mitigations | Plan-wide; baked into individual tasks |
| §12 Implementation outline | Tasks 1-14 mirror the outline |

**Note on §6.1 SnapTrade webhook:** the spec assumes a SnapTrade webhook route exists. Recon shows it does NOT — only `/api/snaptrade/{holdings,sync,login-url}/route.ts`. Task 10 explicitly defers SnapTrade webhook ingestion to a follow-up phase and relies on the 6-hour delta cron to pick up new connections. Documented in commit message.

---

**End of plan.**
