-- Phase 10: broker transaction history backfill
-- Hand-applied via Neon MCP (broad-sun-50424626 / neondb).
--
-- Schema adaptations vs. plan:
--   * portfolio_snapshot already has UNIQUE ("userId","capturedAt"); the DO block is a no-op.
--   * holding has no canonical account_id column. plaidAccountId exists for Plaid;
--     SnapTrade holdings carry no account id (account info goes through accountName).
--     The seed sweep therefore enqueues jobs from BOTH:
--       - holding rows where plaidAccountId IS NOT NULL  -> source='plaid'
--       - snaptrade_connection rows (active)             -> source='snaptrade',
--         using brokerageAuthorizationId as the account_id.
--   * plaid_transaction columns are camelCase quoted; the copy uses pt."plaidAccountId" etc.
--   * plaid_transaction is currently empty; the one-time copy is effectively a no-op
--     but is left in place so re-running the migration on a populated DB Just Works.

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
  "completedAt"       TIMESTAMPTZ,
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- 4. portfolio_snapshot UNIQUE (userId, capturedAt) — required for ON CONFLICT in reconstruction.
-- Already present as portfolio_snapshot_userId_capturedAt_key; this DO block is a defensive no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'portfolio_snapshot'
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%user%captured%'
  ) THEN
    ALTER TABLE portfolio_snapshot
      ADD CONSTRAINT portfolio_snapshot_user_captured_unique
      UNIQUE ("userId", "capturedAt");
  END IF;
END $$;

-- 5. One-time copy of existing plaid_transaction rows into broker_transactions.
-- plaid_transaction columns are camelCase quoted. Both `type` and `subtype` exist; subtype is
-- the more specific Plaid investment subtype (buy/sell/dividend/etc.), type is the broader
-- bucket (buy/sell/cash/transfer/...). Prefer subtype when present.
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

-- 6. One-time sweep: enqueue full_backfill for every existing connection.
--   Plaid: one job per (userId, plaidAccountId) derived from holdings carrying a plaidAccountId.
--   SnapTrade: one job per active snaptrade_connection, keyed by brokerageAuthorizationId.
INSERT INTO broker_history_queue ("userId", source, account_id, job_type, status)
SELECT DISTINCT
  h."userId",
  'plaid'                       AS source,
  h."plaidAccountId"            AS account_id,
  'full_backfill'               AS job_type,
  'queued'                      AS status
FROM holding h
WHERE h."plaidAccountId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO broker_history_queue ("userId", source, account_id, job_type, status)
SELECT
  sc."userId",
  'snaptrade'                   AS source,
  sc."brokerageAuthorizationId" AS account_id,
  'full_backfill'               AS job_type,
  'queued'                      AS status
FROM snaptrade_connection sc
WHERE sc.disabled = false
ON CONFLICT DO NOTHING;
