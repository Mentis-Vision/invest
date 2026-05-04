// src/lib/broker-history/reconstruct.ts
// Walks transactions backward from current holdings, computes daily
// portfolio values, INSERTs into portfolio_snapshot with
// source='reconstructed'. Per AGENTS.md trust tenet (rule #13):
// never overwrites observed rows — INSERT ... ON CONFLICT DO NOTHING
// guarantees this, and the reconstruct window ends *before* the
// earliest observed snapshot.

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
  const reconstructEnd = oldestObserved
    ? new Date(oldestObserved.getTime() - MS_PER_DAY).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // NOTE: holding has no canonical account_id — only plaidAccountId.
  // For SnapTrade backfills, accountId is brokerageAuthorizationId, which
  // doesn't appear on holding. So we currently scope by user only;
  // per-account reconstruction is a follow-up.
  const holdingsRes = await pool.query<Holding>(
    `SELECT ticker, shares::float AS shares, "lastValue"::float AS last_value
     FROM holding WHERE "userId" = $1`,
    [userId],
  );
  if (holdingsRes.rows.length === 0) {
    return { snapshotsInserted: 0, earliestSnapshotDate: null, skippedDays: 0 };
  }

  const txnsRes = await pool.query<Txn>(
    accountId
      ? `SELECT txn_date::text, action, ticker,
                quantity::float AS quantity, price::float AS price, amount::float AS amount
         FROM broker_transactions
         WHERE "userId" = $1 AND account_id = $2
         ORDER BY txn_date DESC, "createdAt" DESC`
      : `SELECT txn_date::text, action, ticker,
                quantity::float AS quantity, price::float AS price, amount::float AS amount
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

  const positions = new Map<string, number>();
  let cash = 0;
  for (const h of holdingsRes.rows) {
    if (h.ticker === "CASH" || h.ticker === "USD") {
      cash += Number(h.last_value);
    } else {
      positions.set(h.ticker, Number(h.shares));
    }
  }

  // Walking transactions back-in-time. For each txn at date T, we
  // snapshot the *post-txn* state (= state at EOD T) BEFORE reversing
  // it. After all reversals, `positions` and `cash` reflect the
  // pre-earliest-txn state (i.e., before the user's history begins).
  //
  // For a query date D, the correct snapshot is the latest txn whose
  // date <= D — i.e., the last txn that has happened by EOD D.
  const postStateByTxnDate = new Map<string, { positions: Map<string, number>; cash: number }>();

  for (const t of txnsRes.rows) {
    // Snapshot the post-txn state (state at EOD t.txn_date) BEFORE
    // reversing this txn. If multiple txns share a txn_date, the
    // first one we see (DESC order = chronologically last) represents
    // the EOD state.
    if (!postStateByTxnDate.has(t.txn_date)) {
      postStateByTxnDate.set(t.txn_date, {
        positions: new Map(positions),
        cash,
      });
    }
    const tk = t.ticker ?? "";
    const qty = Number(t.quantity ?? 0);
    const amt = Number(t.amount);
    switch (t.action) {
      case "buy":
        // Reverse: before this buy, we had fewer shares and more cash.
        if (tk) positions.set(tk, (positions.get(tk) ?? 0) - qty);
        cash -= amt; // amt is negative for a buy → cash goes up
        break;
      case "sell":
        if (tk) positions.set(tk, (positions.get(tk) ?? 0) + qty);
        cash -= amt;
        break;
      case "dividend":
      case "interest":
      case "contribution":
      case "fee":
      case "withdrawal":
        cash -= amt;
        break;
      case "split":
        log.info("broker-history.reconstruct", "split-not-reversed", {
          userId,
          ticker: tk,
        });
        break;
      default:
        break;
    }
  }
  // After the loop, `positions` and `cash` represent the pre-history
  // state (before any txn). We use this for dates < earliest txn date.
  const preHistoryState = { positions: new Map(positions), cash };

  const tickers = Array.from(
    new Set(
      Array.from(preHistoryState.positions.keys()).concat(
        Array.from(postStateByTxnDate.values()).flatMap((s) => Array.from(s.positions.keys())),
      ),
    ),
  ).filter(Boolean);

  if (tickers.length === 0) {
    return { snapshotsInserted: 0, earliestSnapshotDate: null, skippedDays: 0 };
  }

  const pricesRes = await pool.query<PriceRow>(
    `SELECT ticker, captured_at::text AS captured_at, close::float AS close
     FROM ticker_market_daily
     WHERE ticker = ANY($1::text[])
       AND captured_at BETWEEN $2::date AND $3::date
       AND close IS NOT NULL`,
    [tickers, reconstructStart, reconstructEnd],
  );
  const priceMap = new Map<string, Map<string, number>>();
  for (const row of pricesRes.rows) {
    if (!priceMap.has(row.captured_at)) priceMap.set(row.captured_at, new Map());
    priceMap.get(row.captured_at)!.set(row.ticker, row.close);
  }

  const dates = listDatesBetween(reconstructStart, reconstructEnd);
  let snapshotsInserted = 0;
  let skippedDays = 0;
  let earliestSnapshotDate: string | null = null;
  // Sort ASC so binary-search-style scan can find the largest txn_date <= date.
  const sortedTxnDates = Array.from(postStateByTxnDate.keys()).sort();

  for (const date of dates) {
    // Find the largest txn_date <= date — that's the latest txn that
    // had happened by EOD `date`, and its post-txn snapshot represents
    // the portfolio state for that day.
    let active: { positions: Map<string, number>; cash: number } | null = null;
    for (let i = sortedTxnDates.length - 1; i >= 0; i--) {
      if (sortedTxnDates[i] <= date) {
        active = postStateByTxnDate.get(sortedTxnDates[i])!;
        break;
      }
    }
    if (!active) {
      // date is before any txn → use the pre-history state.
      active = preHistoryState;
    }

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
    if (missingPrice || total <= 0) {
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
      log.warn("broker-history.reconstruct", "insert failed", {
        userId,
        date,
        ...errorInfo(err),
      });
    }
  }

  log.info("broker-history.reconstruct", "complete", {
    userId,
    snapshotsInserted,
    skippedDays,
    earliestSnapshotDate,
  });
  return { snapshotsInserted, earliestSnapshotDate, skippedDays };
}
