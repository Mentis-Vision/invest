// src/app/api/user/transactions/export/route.ts
// CSV export of all stored broker transactions for the authenticated
// user. Spec §8 — user-control surface. The export deliberately
// excludes encrypted broker memos / raw payloads; only the normalized
// columns the user can reason about are emitted.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let rows: Array<{
    txn_date: string;
    source: string;
    account_id: string;
    action: string;
    ticker: string | null;
    quantity: string | null;
    price: string | null;
    amount: string;
    fees: string | null;
    currency: string;
  }>;
  try {
    const result = await pool.query<{
      txn_date: string;
      source: string;
      account_id: string;
      action: string;
      ticker: string | null;
      quantity: string | null;
      price: string | null;
      amount: string;
      fees: string | null;
      currency: string;
    }>(
      `SELECT txn_date::text, source, account_id, action,
              ticker, quantity::text, price::text, amount::text, fees::text, currency
       FROM broker_transactions
       WHERE "userId" = $1
       ORDER BY txn_date DESC`,
      [userId],
    );
    rows = result.rows;
  } catch (err) {
    log.error("user.transactions.export", "query failed", {
      userId,
      err: String(err),
    });
    return NextResponse.json({ error: "export_failed" }, { status: 500 });
  }

  const header =
    "date,source,account_id,action,ticker,qty,price,amount,fees,currency";
  const lines = rows.map((r) =>
    [
      r.txn_date,
      r.source,
      r.account_id,
      r.action,
      r.ticker ?? "",
      r.quantity ?? "",
      r.price ?? "",
      r.amount,
      r.fees ?? "",
      r.currency,
    ]
      .map((c) =>
        /[",\n]/.test(String(c))
          ? `"${String(c).replace(/"/g, '""')}"`
          : String(c),
      )
      .join(","),
  );
  const csv = [header, ...lines].join("\n");

  log.info("user.transactions.export", "complete", {
    userId,
    rowCount: rows.length,
    bytes: csv.length,
  });

  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="clearpath-transactions-${today}.csv"`,
    },
  });
}
