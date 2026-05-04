// src/lib/broker-history/snaptrade-loader.ts
// Pulls activity history from SnapTrade and inserts canonical rows
// into broker_transactions. Idempotent via UNIQUE (source, external_txn_id).
//
// SnapTrade SDK shape (snaptrade-typescript-sdk v9):
//   client.transactionsAndReporting.getActivities({
//     userId, userSecret, startDate, endDate,
//     accounts?, brokerageAuthorizations?, type?
//   })
//
// In Batch 1's queue-seeding logic, the queue's `account_id` for a
// SnapTrade job is the brokerageAuthorizationId (because `holding`
// has no canonical SnapTrade account id). So we filter via
// `brokerageAuthorizations`, which the SDK docs note takes precedence
// over `accounts`.

import { pool } from "../db";
import { log, errorInfo } from "../log";
import { snaptradeClient, ensureSnaptradeUser, encryptSecret } from "../snaptrade";
import { normalizeAction } from "./normalize";
import type { BackfillResult } from "./types";

interface SnaptradeActivity {
  id?: string | null;
  trade_date?: string | null;
  settlement_date?: string | null;
  action?: string;
  symbol?: { symbol?: string } | null;
  units?: number | null;
  price?: number | null;
  amount?: number | null;
  fee?: number | null;
  currency?: { code?: string };
}

/**
 * Backfill all SnapTrade activities for a single brokerageAuthorization.
 * `accountId` here is the SnapTrade brokerageAuthorizationId (per
 * Batch 1's queue-seeding logic — SnapTrade doesn't expose a stable
 * per-account id on the holding table).
 */
export async function backfillSnaptradeAccount(
  userId: string,
  accountId: string,
): Promise<BackfillResult> {
  const { snaptradeUserId, userSecret } = await ensureSnaptradeUser(userId);
  const client = snaptradeClient();
  const startDate = "1900-01-01";
  const endDate = new Date().toISOString().slice(0, 10);

  let activities: SnaptradeActivity[] = [];
  try {
    const resp = await client.transactionsAndReporting.getActivities({
      userId: snaptradeUserId,
      userSecret,
      brokerageAuthorizations: accountId,
      startDate,
      endDate,
    });
    activities = (resp?.data as SnaptradeActivity[]) ?? [];
  } catch (err) {
    log.warn("broker-history.snaptrade", "getActivities failed", {
      userId,
      accountId,
      ...errorInfo(err),
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
          userId,
          accountId,
          a.id,
          txnDate,
          a.settlement_date ?? null,
          action,
          ticker,
          a.units ?? null,
          a.price ?? null,
          a.amount ?? 0,
          a.fee ?? null,
          a.currency?.code ?? "USD",
          rawEncrypted,
        ],
      );
      if ((r.rowCount ?? 0) > 0) inserted++;
    } catch (err) {
      log.warn("broker-history.snaptrade", "insert failed", {
        userId,
        txnId: a.id,
        ...errorInfo(err),
      });
    }
  }

  if (unknownActionCount > 0) {
    log.info("broker-history.snaptrade", "unknown-actions", {
      userId,
      accountId,
      count: unknownActionCount,
    });
  }

  return { inserted, earliestTxnDate, unknownActionCount };
}
