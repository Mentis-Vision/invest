import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/portfolio-review/next-move-state
 *
 * Body: { state: "active" | "done" | "snoozed" | "dismissed" | null }
 *
 * Marks the user's reaction to today's Next Move hero:
 *   - `done`      — "I did this" → hero flips to a confirmation tile
 *                     with a "changed my mind" undo
 *   - `snoozed`   — "not now" → hero collapses; re-appears tomorrow
 *   - `dismissed` — "not interested" → hero hides for the day
 *   - `active`    — default; re-active after an undo
 *   - `null`      — clears the state (equivalent to `active`)
 *
 * Operates only on TODAY's row in portfolio_review_daily. There's no
 * past-day mutation pattern — if no row exists yet (brand-new user,
 * cron hasn't fired), we 404 rather than insert.
 */

const VALID: Readonly<Set<string>> = new Set([
  "active",
  "done",
  "snoozed",
  "dismissed",
]);

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { state?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.state === null ? null : String(body.state ?? "");
  if (raw !== null && !VALID.has(raw)) {
    return NextResponse.json(
      {
        error: "state must be one of: active, done, snoozed, dismissed, null",
      },
      { status: 400 }
    );
  }
  const state = raw === null || raw === "active" ? null : (raw as string);

  try {
    const { rowCount } = await pool.query(
      `UPDATE "portfolio_review_daily"
         SET "nextMoveState" = $1,
             "nextMoveStateAt" = CASE WHEN $1::text IS NULL THEN NULL ELSE NOW() END
       WHERE "userId" = $2 AND "capturedAt" = CURRENT_DATE`,
      [state, session.user.id]
    );
    if (rowCount === 0) {
      return NextResponse.json(
        {
          error: "No review for today yet. Open Strategy to generate one.",
        },
        { status: 404 }
      );
    }
    log.info("portfolio-review.next-move-state", "set", {
      userId: session.user.id,
      state,
    });
    return NextResponse.json({
      ok: true,
      state: state ?? "active",
    });
  } catch (err) {
    log.error("portfolio-review.next-move-state", "save failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not save state." },
      { status: 500 }
    );
  }
}
