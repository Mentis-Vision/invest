import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";
import { sendWeeklyDigestForUser } from "@/lib/weekly-digest";

/**
 * Weekly digest cron — Monday ~9am ET (14:00 UTC).
 *
 * Iterates every verified user, building + sending a short personal
 * recap of the last 7 days: portfolio change, week's movers,
 * this week's alerts, research queries run, upcoming earnings.
 *
 * Authenticated via Bearer CRON_SECRET, like the other cron routes.
 *
 * Fair-use throttle: builds are cheap (all SQL, no AI), but we cap
 * the batch at 500 users per run to keep the function under the
 * 300s max duration even in the worst case. Users skipped in one
 * run will be picked up next week, or by a manual re-hit.
 */

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron.weekly-digest", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  // Select only candidates — reduces per-user gating round-trips.
  // The sendWeeklyDigestForUser helper still re-checks preferences,
  // so this is an optimization not a source-of-truth.
  const { rows } = await pool.query(
    `SELECT id AS "userId", email, name
     FROM "user"
     WHERE "emailVerified" = true
       AND "weeklyDigestOptOut" = false
       AND email <> 'demo@clearpathinvest.app'
     ORDER BY "createdAt" ASC
     LIMIT 500`
  );

  let sent = 0;
  let skipped = 0;
  let errored = 0;
  const skipReasons: Record<string, number> = {};

  for (const r of rows as Array<{
    userId: string;
    email: string;
    name: string | null;
  }>) {
    try {
      const res = await sendWeeklyDigestForUser({
        userId: r.userId,
        email: r.email,
        name: r.name,
      });
      if (res.sent) sent++;
      else {
        skipped++;
        const k = res.skipped ?? "unknown";
        skipReasons[k] = (skipReasons[k] ?? 0) + 1;
      }
    } catch (err) {
      errored++;
      log.warn("cron.weekly-digest", "user failed", {
        userId: r.userId,
        ...errorInfo(err),
      });
    }
  }

  const result = {
    eligible: rows.length,
    sent,
    skipped,
    errored,
    skipReasons,
    durationMs: Date.now() - started,
  };
  log.info("cron.weekly-digest", "run complete", result);
  return NextResponse.json(result);
}
