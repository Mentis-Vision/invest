import { NextRequest, NextResponse } from "next/server";
import { sendDueNudges } from "@/lib/trial-nudge";
import { log, errorInfo } from "@/lib/log";

export const maxDuration = 300;

/**
 * GET /api/cron/trial-nudge
 *
 * Daily cron that sends trial-end nudge emails — T-7, T-3, T-1, T+0,
 * T+7 — to users whose trials are ending or recently ended.
 * Idempotent per (userId, kind) via the trial_nudge_log table.
 *
 * See `src/lib/trial-nudge.ts` for the email templates and window
 * definitions. This route is just the cron envelope.
 *
 * Schedule: vercel.json runs this at 16:00 UTC (12 PM ET / 9 AM PT)
 * — late enough that users on the West Coast are awake, early
 * enough that East Coast users see it before their inbox saturates.
 *
 * Auth: same `Authorization: Bearer $CRON_SECRET` pattern as every
 * other cron in this codebase.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron.trialNudge", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  try {
    const counts = await sendDueNudges();
    const ms = Date.now() - started;
    log.info("cron.trialNudge", "complete", { counts, ms });
    return NextResponse.json({ counts, ms });
  } catch (err) {
    log.error("cron.trialNudge", "failed", errorInfo(err));
    return NextResponse.json(
      { error: "failed", ms: Date.now() - started },
      { status: 500 }
    );
  }
}
