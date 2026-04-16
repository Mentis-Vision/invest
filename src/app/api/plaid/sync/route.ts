import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { plaidClient, plaidConfigured, decryptAccessToken } from "@/lib/plaid";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * Pulls the latest investment transactions for the signed-in user.
 * Idempotent via `plaid_transaction_id` UNIQUE.
 */
export async function POST(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!plaidConfigured()) {
    return NextResponse.json({ error: "plaid_not_configured" }, { status: 503 });
  }

  const { rows: items } = await pool.query(
    `SELECT id, "accessTokenEncrypted" FROM "plaid_item"
     WHERE "userId" = $1 AND status = 'active'`,
    [session.user.id]
  );

  if (items.length === 0) {
    return NextResponse.json({ ok: true, newTrades: 0 });
  }

  const end = new Date();
  const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().split("T")[0];

  let inserted = 0;

  for (const item of items) {
    try {
      const accessToken = decryptAccessToken(item.accessTokenEncrypted as string);
      const resp = await plaidClient().investmentsTransactionsGet({
        access_token: accessToken,
        start_date: fmt(start),
        end_date: fmt(end),
      });

      const securitiesById = new Map(
        resp.data.securities.map((s) => [s.security_id, s])
      );

      for (const tx of resp.data.investment_transactions) {
        const sec = securitiesById.get(tx.security_id ?? "");
        const ticker =
          sec?.ticker_symbol ??
          sec?.name?.slice(0, 12).toUpperCase() ??
          null;
        if (!ticker) continue;

        // Plaid's investment txn subtypes → our `type`
        const mapped = mapTxType(tx.type, tx.subtype);
        if (!mapped) continue;

        try {
          const res = await pool.query(
            `INSERT INTO "trade" (id, "userId", ticker, type, shares, price, total, fees, "executedAt", "plaidTransactionId")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT ("plaidTransactionId") DO NOTHING`,
            [
              crypto.randomUUID(),
              session.user.id,
              ticker,
              mapped,
              Math.abs(Number(tx.quantity ?? 0)),
              Number(tx.price ?? 0),
              Number(tx.amount ?? 0),
              Number(tx.fees ?? 0),
              new Date(tx.date),
              tx.investment_transaction_id,
            ]
          );
          if (res.rowCount) inserted += res.rowCount;
        } catch (err) {
          log.warn("plaid.sync", "trade insert failed", {
            ticker,
            ...errorInfo(err),
          });
        }
      }

      await pool.query(
        `UPDATE "plaid_item" SET "lastSyncedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
        [item.id]
      );
    } catch (err) {
      log.error("plaid.sync", "item sync failed", {
        userId: session.user.id,
        ...errorInfo(err),
      });
    }
  }

  return NextResponse.json({ ok: true, newTrades: inserted });
}

function mapTxType(type: string, subtype: string): string | null {
  const t = type.toLowerCase();
  const s = subtype.toLowerCase();
  if (s === "buy" || (t === "buy")) return "BUY";
  if (s === "sell" || t === "sell") return "SELL";
  if (s === "dividend" || t === "dividend") return "DIVIDEND";
  if (s === "split") return "SPLIT";
  if (s === "transfer") return t === "buy" ? "TRANSFER_IN" : "TRANSFER_OUT";
  return null;
}
