import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * Weekly retention sweep for warehouse + observability tables.
 * Schedule: 0 3 * * 0 (Sunday 03:00 UTC).
 * Authorization: same Bearer $CRON_SECRET as the daily cron.
 *
 * Steps (all idempotent, pure SQL):
 *   1. Hard-delete sentiment rows older than 180 days.
 *   2. Delete past events older than 2 years.
 *   3. Delete system_aggregate_daily rows older than 2 years.
 *   4. Delete plaid_webhook_event rows older than 30 days (observability log).
 *
 * Market-daily roll-up is intentionally deferred until the table crosses
 * ~1M rows or 2 years of history. At current scale the daily grain is
 * still cheaper than a rollup join.
 */
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron.retention", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const result: Record<string, unknown> = {};

  try {
    const r = await pool.query(
      `DELETE FROM "ticker_sentiment_daily"
       WHERE captured_at < CURRENT_DATE - INTERVAL '180 days'`
    );
    result.sentimentDeleted = r.rowCount ?? 0;
  } catch (err) {
    log.error("cron.retention", "sentiment prune failed", errorInfo(err));
    result.sentimentDeleted = { error: "failed" };
  }

  try {
    const r = await pool.query(
      `DELETE FROM "ticker_events"
       WHERE event_date < CURRENT_DATE - INTERVAL '730 days'`
    );
    result.eventsDeleted = r.rowCount ?? 0;
  } catch (err) {
    log.error("cron.retention", "events prune failed", errorInfo(err));
    result.eventsDeleted = { error: "failed" };
  }

  try {
    const r = await pool.query(
      `DELETE FROM "system_aggregate_daily"
       WHERE captured_at < CURRENT_DATE - INTERVAL '730 days'`
    );
    result.aggregatesDeleted = r.rowCount ?? 0;
  } catch (err) {
    log.error("cron.retention", "aggregates prune failed", errorInfo(err));
    result.aggregatesDeleted = { error: "failed" };
  }

  // plaid_webhook_event: observability log for every webhook attempt.
  // 30-day retention — enough to debug incident reports and compute
  // 7-day rolling failure metrics on the admin dashboard, without
  // letting the table grow unbounded if traffic spikes.
  try {
    const r = await pool.query(
      `DELETE FROM "plaid_webhook_event"
       WHERE "receivedAt" < NOW() - INTERVAL '30 days'`
    );
    result.plaidWebhookEventsDeleted = r.rowCount ?? 0;
  } catch (err) {
    log.error(
      "cron.retention",
      "plaid_webhook_event prune failed",
      errorInfo(err)
    );
    result.plaidWebhookEventsDeleted = { error: "failed" };
  }

  // Note: weekly/monthly roll-ups for ticker_market_daily are NOT yet
  // implemented. At current scale (days of data, not years), the daily
  // granular table is fine. Add the roll-up step here when the table
  // crosses ~1M rows or 2 years old, whichever comes first.
  result.marketRollupStatus = "deferred_until_scale";

  result.durationMs = Date.now() - started;
  log.info("cron.retention", "run complete", result);
  return NextResponse.json(result);
}
