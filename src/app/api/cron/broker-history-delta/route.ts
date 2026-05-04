// src/app/api/cron/broker-history-delta/route.ts
// Runs every 6 hours. Enqueues delta_sync per active connection.
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { errorInfo, log } from "@/lib/log";
import { enqueueJob } from "@/lib/broker-history/queue";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  try {
    let enqueued = 0;

    // Plaid connections — derived from holding.plaidAccountId. Each
    // (userId, plaidAccountId) pair is a single account on a single item.
    const plaidConns = await pool.query<{ userId: string; account_id: string }>(
      `SELECT DISTINCT "userId", "plaidAccountId" AS account_id
       FROM holding
       WHERE "plaidAccountId" IS NOT NULL`,
    );
    for (const c of plaidConns.rows) {
      await enqueueJob(c.userId, "plaid", c.account_id, "delta_sync");
      enqueued++;
    }

    // SnapTrade connections — keyed by brokerageAuthorizationId. Skip
    // disabled rows so we don't keep retrying broken connections.
    const snConns = await pool.query<{ userId: string; account_id: string }>(
      `SELECT DISTINCT "userId", "brokerageAuthorizationId" AS account_id
       FROM snaptrade_connection
       WHERE "brokerageAuthorizationId" IS NOT NULL
         AND disabled = false`,
    );
    for (const c of snConns.rows) {
      await enqueueJob(c.userId, "snaptrade", c.account_id, "delta_sync");
      enqueued++;
    }

    log.info("cron.broker-history-delta", "complete", {
      enqueued,
      plaid: plaidConns.rowCount ?? 0,
      snaptrade: snConns.rowCount ?? 0,
      ms: Date.now() - started,
    });
    return NextResponse.json({ ok: true, enqueued });
  } catch (err) {
    log.error("cron.broker-history-delta", "failed", {
      ms: Date.now() - started,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "failed", ms: Date.now() - started },
      { status: 500 },
    );
  }
}
