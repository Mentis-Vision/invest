// src/app/api/cron/broker-history-worker/route.ts
// Runs every 5 minutes. Drains the broker_history_queue (5 jobs/tick).
import { NextResponse } from "next/server";
import { errorInfo, log } from "@/lib/log";
import { runBackfillTick } from "@/lib/broker-history/backfill";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  try {
    const result = await runBackfillTick();
    log.info("cron.broker-history-worker", "complete", {
      ...result,
      ms: Date.now() - started,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log.error("cron.broker-history-worker", "failed", {
      ms: Date.now() - started,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "failed", ms: Date.now() - started },
      { status: 500 },
    );
  }
}
