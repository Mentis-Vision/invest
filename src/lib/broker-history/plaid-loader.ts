// src/lib/broker-history/plaid-loader.ts
// Full-history Plaid investments transactions pull. Plaid caps at 24mo.
// Paginated via options.count + options.offset. Idempotent INSERT via
// UNIQUE (source, external_txn_id) on broker_transactions.

import { pool } from "../db";
import { log, errorInfo } from "../log";
import { plaidClient, getAccessTokenForItem } from "../plaid";
import { encryptSecret } from "../snaptrade";
import { normalizeAction } from "./normalize";
import type { BackfillResult } from "./types";

const PAGE_SIZE = 100;

interface PlaidTxn {
  investment_transaction_id?: string;
  account_id?: string;
  type?: string;
  subtype?: string;
  date?: string;
  quantity?: number | null;
  price?: number | null;
  amount?: number;
  fees?: number | null;
  iso_currency_code?: string | null;
  security_id?: string | null;
}

interface PlaidSecurity {
  security_id?: string;
  ticker_symbol?: string | null;
  name?: string | null;
}

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
        userId,
        itemId,
        offset,
        ...errorInfo(err),
      });
      throw err;
    }

    const data = resp.data as {
      investment_transactions?: PlaidTxn[];
      securities?: PlaidSecurity[];
      total_investment_transactions?: number;
    };
    const txs: PlaidTxn[] = data.investment_transactions ?? [];
    const securities: PlaidSecurity[] = data.securities ?? [];
    const total = data.total_investment_transactions ?? 0;
    if (txs.length === 0) break;

    const secById = new Map<string, PlaidSecurity>();
    for (const s of securities) {
      if (s.security_id) secById.set(s.security_id, s);
    }

    for (const t of txs) {
      if (!t.investment_transaction_id) continue;
      const sec = t.security_id ? secById.get(t.security_id) : undefined;
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
            userId,
            t.account_id ?? accountId,
            t.investment_transaction_id,
            txnDate,
            action,
            ticker,
            t.quantity ?? null,
            t.price ?? null,
            t.amount ?? 0,
            t.fees ?? null,
            t.iso_currency_code ?? "USD",
            rawEncrypted,
          ],
        );
        if ((r.rowCount ?? 0) > 0) inserted++;
      } catch (err) {
        log.warn("broker-history.plaid", "insert failed", {
          userId,
          txnId: t.investment_transaction_id,
          ...errorInfo(err),
        });
      }
    }

    offset += PAGE_SIZE;
    if (offset >= total) break;
  }

  if (unknownActionCount > 0) {
    log.info("broker-history.plaid", "unknown-actions", {
      userId,
      accountId,
      count: unknownActionCount,
    });
  }

  return { inserted, earliestTxnDate, unknownActionCount };
}
