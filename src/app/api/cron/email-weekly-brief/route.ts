import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";
import { getBriefByWeek, mondayOf } from "@/lib/public-brief";
import {
  sendWeeklyBriefEmail,
  buildUnsubscribeToken,
} from "@/lib/email/weekly-brief-email";

/**
 * Email the weekly bull-vs-bear brief — runs Mondays 11:00 UTC, one
 * hour after the brief-generator cron writes its row. Audience is
 * every verified user plus every waitlist signup, minus anyone who
 * opted out of this specific notification type (weeklyBriefOptOut).
 *
 * Protected by Bearer CRON_SECRET like every other cron route.
 *
 * Fair-use throttle: one send per recipient per week, max 500
 * recipients per invocation. If the audience grows past 500 we'll
 * split into batched runs — for now this is a head-of-list LIMIT with
 * the idempotency guard (weeklyBriefSentAt within 5 days → skip)
 * ensuring repeated invocations don't double-send.
 *
 * Query overrides for ops:
 *   ?week=YYYY-MM-DD — override the target week (must be a Monday)
 *   ?dry=1           — log planned sends, don't actually send mail
 */

export const maxDuration = 300;

const BATCH_CAP = 500;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron.email-weekly-brief", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const weekOverride = url.searchParams.get("week");
  const dry = url.searchParams.get("dry") === "1";

  const weekOf = weekOverride ?? mondayOf(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) {
    return NextResponse.json(
      { error: "invalid_week", message: "Pass week=YYYY-MM-DD (Monday)." },
      { status: 400 }
    );
  }

  const started = Date.now();

  // ── Step 1: locate the brief for this week ──────────────────────
  // There's exactly one brief per (ticker, week_of), but we don't know
  // the ticker here — pull the latest row with this week_of.
  const { rows: briefRows } = await pool.query<{ ticker: string }>(
    `SELECT ticker FROM "public_weekly_brief"
      WHERE week_of = $1::date AND status = 'published'
      ORDER BY created_at DESC LIMIT 1`,
    [weekOf]
  );

  if (briefRows.length === 0) {
    // Brief cron probably hasn't run yet (or failed). No-op — next
    // Monday will try again; ops can replay manually if needed.
    log.warn("cron.email-weekly-brief", "no brief for week — skipping", {
      weekOf,
    });
    return NextResponse.json({
      status: "no_brief_for_week",
      weekOf,
      tookMs: Date.now() - started,
    });
  }

  const ticker = briefRows[0].ticker;
  const brief = await getBriefByWeek(ticker, weekOf);
  if (!brief) {
    log.error("cron.email-weekly-brief", "brief row missing after select", {
      ticker,
      weekOf,
    });
    return NextResponse.json(
      { error: "brief_missing_on_reread" },
      { status: 500 }
    );
  }

  // ── Step 2: collect eligible recipients ─────────────────────────
  // Users: verified, not opted out of weekly brief, not demo, not
  // already sent this week. Waitlist: not opted out, not already sent
  // this week. Dedupe by lowercased email (waitlist signups that also
  // have a user account should only receive one email — user row wins).
  const { rows: userRows } = await pool.query<{
    userId: string;
    email: string;
    name: string | null;
  }>(
    `SELECT id AS "userId", email, name
       FROM "user"
      WHERE "emailVerified" = true
        AND "weeklyBriefOptOut" = false
        AND email <> 'demo@clearpathinvest.app'
        AND ("weeklyBriefSentAt" IS NULL
             OR "weeklyBriefSentAt" < NOW() - interval '5 days')
      ORDER BY "createdAt" ASC
      LIMIT $1`,
    [BATCH_CAP]
  );

  const userEmails = new Set(userRows.map((r) => r.email.toLowerCase()));
  const remainingCap = Math.max(0, BATCH_CAP - userRows.length);

  const { rows: waitlistRows } =
    remainingCap > 0
      ? await pool.query<{
          id: number;
          email: string;
          name: string | null;
        }>(
          `SELECT id, email, name
             FROM "waitlist"
            WHERE "weeklyBriefOptOut" = false
              AND ("weeklyBriefSentAt" IS NULL
                   OR "weeklyBriefSentAt" < NOW() - interval '5 days')
            ORDER BY "createdAt" ASC
            LIMIT $1`,
          [remainingCap]
        )
      : { rows: [] as Array<{ id: number; email: string; name: string | null }> };

  // Drop waitlist rows whose email already appears in the user list.
  const waitlistFiltered = waitlistRows.filter(
    (r) => !userEmails.has(r.email.toLowerCase())
  );

  const totalPlanned = userRows.length + waitlistFiltered.length;
  log.info("cron.email-weekly-brief", "batch assembled", {
    weekOf,
    ticker,
    users: userRows.length,
    waitlist: waitlistFiltered.length,
    total: totalPlanned,
    dry,
  });

  if (dry) {
    return NextResponse.json({
      status: "dry_run",
      weekOf,
      ticker,
      slug: brief.slug,
      planned: totalPlanned,
      users: userRows.length,
      waitlist: waitlistFiltered.length,
      tookMs: Date.now() - started,
    });
  }

  // ── Step 3: send per recipient ──────────────────────────────────
  let sent = 0;
  let errored = 0;
  let skipped = 0;

  for (const u of userRows) {
    try {
      const token = buildUnsubscribeToken(u.email, "user");
      const res = await sendWeeklyBriefEmail({
        recipient: { email: u.email, name: u.name, audience: "user" },
        brief,
        unsubscribeToken: token,
      });
      if (!res.ok) {
        errored++;
        continue;
      }
      if (res.skipped) {
        skipped++;
        continue;
      }
      sent++;
      await pool
        .query(
          `UPDATE "user" SET "weeklyBriefSentAt" = NOW() WHERE id = $1`,
          [u.userId]
        )
        .catch((err) => {
          log.warn("cron.email-weekly-brief", "user sent-at update failed", {
            userId: u.userId,
            ...errorInfo(err),
          });
        });
    } catch (err) {
      errored++;
      log.warn("cron.email-weekly-brief", "user send failed", {
        userId: u.userId,
        ...errorInfo(err),
      });
    }
  }

  for (const w of waitlistFiltered) {
    try {
      const token = buildUnsubscribeToken(w.email, "waitlist");
      const res = await sendWeeklyBriefEmail({
        recipient: {
          email: w.email,
          name: w.name,
          audience: "waitlist",
        },
        brief,
        unsubscribeToken: token,
      });
      if (!res.ok) {
        errored++;
        continue;
      }
      if (res.skipped) {
        skipped++;
        continue;
      }
      sent++;
      await pool
        .query(
          `UPDATE "waitlist" SET "weeklyBriefSentAt" = NOW() WHERE id = $1`,
          [w.id]
        )
        .catch((err) => {
          log.warn("cron.email-weekly-brief", "waitlist sent-at update failed", {
            waitlistId: w.id,
            ...errorInfo(err),
          });
        });
    } catch (err) {
      errored++;
      log.warn("cron.email-weekly-brief", "waitlist send failed", {
        waitlistId: w.id,
        ...errorInfo(err),
      });
    }
  }

  const result = {
    status: "complete" as const,
    weekOf,
    ticker,
    slug: brief.slug,
    planned: totalPlanned,
    sent,
    skipped,
    errored,
    tookMs: Date.now() - started,
  };
  log.info("cron.email-weekly-brief", "run complete", result);
  return NextResponse.json(result);
}
