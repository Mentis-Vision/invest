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
