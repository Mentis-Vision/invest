// src/app/api/cron/broker-history-reconcile/route.ts
// Quarterly. Enqueues reconcile jobs per active connection. Same shape
// as delta but different job_type — worker handles it as an idempotent
// re-pull.
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

    const plaidConns = await pool.query<{ userId: string; account_id: string }>(
      `SELECT DISTINCT "userId", "plaidAccountId" AS account_id
       FROM holding
       WHERE "plaidAccountId" IS NOT NULL`,
    );
    for (const c of plaidConns.rows) {
      await enqueueJob(c.userId, "plaid", c.account_id, "reconcile");
      enqueued++;
    }

    const snConns = await pool.query<{ userId: string; account_id: string }>(
      `SELECT DISTINCT "userId", "brokerageAuthorizationId" AS account_id
       FROM snaptrade_connection
       WHERE "brokerageAuthorizationId" IS NOT NULL
         AND disabled = false`,
    );
    for (const c of snConns.rows) {
      await enqueueJob(c.userId, "snaptrade", c.account_id, "reconcile");
      enqueued++;
    }

    log.info("cron.broker-history-reconcile", "complete", {
      enqueued,
      plaid: plaidConns.rowCount ?? 0,
      snaptrade: snConns.rowCount ?? 0,
      ms: Date.now() - started,
    });
    return NextResponse.json({ ok: true, enqueued });
  } catch (err) {
    log.error("cron.broker-history-reconcile", "failed", {
      ms: Date.now() - started,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "failed", ms: Date.now() - started },
      { status: 500 },
    );
  }
}
