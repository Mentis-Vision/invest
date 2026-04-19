import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * Record a user's action on a recommendation.
 *
 * The four actions represent the full space of what a user can do in
 * response to a call we made:
 *
 *   - `took`     — followed the recommendation (BUY → bought, SELL → sold)
 *   - `partial`  — did part of it (e.g. sold half instead of all)
 *   - `ignored`  — saw it, didn't act, held position as-is
 *   - `opposed`  — did the opposite (BUY → sold, SELL → bought / added)
 *
 * Plus an optional user `note` (up to 500 chars) — private, for the
 * user's own journaling. "Why I disagreed with the model here" is the
 * intended use. We never surface these notes anywhere else.
 *
 * Body: { action: "took" | "partial" | "ignored" | "opposed" | null, note?: string }
 *   - action === null clears any prior action (lets user undo).
 *   - note === "" or omitted clears the note.
 *
 * Ownership is enforced — we only let a user edit recommendations
 * belonging to them. 404 if not found OR belongs to another user
 * (we don't leak the difference).
 */

const VALID_ACTIONS = new Set(["took", "partial", "ignored", "opposed"]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<Record<string, never>> }
) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = await ctx.params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { recommendationId?: unknown; action?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const recommendationId =
    typeof body.recommendationId === "string" ? body.recommendationId : null;
  if (!recommendationId) {
    return NextResponse.json(
      { error: "recommendationId required" },
      { status: 400 }
    );
  }

  const action = body.action === null ? null : String(body.action ?? "");
  if (action !== null && action !== "" && !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      {
        error: "action must be one of: took, partial, ignored, opposed (or null to clear)",
      },
      { status: 400 }
    );
  }

  // Note: 500 char cap. Empty string → null to normalize storage.
  let note: string | null = null;
  if (typeof body.note === "string") {
    const trimmed = body.note.trim();
    note = trimmed === "" ? null : trimmed.slice(0, 500);
  }

  const finalAction = action === "" ? null : action;

  try {
    const result = await pool.query(
      `UPDATE "recommendation"
         SET "userAction" = $1,
             "userNote" = $2,
             "userActionAt" = CASE
               WHEN $1::text IS NULL THEN NULL
               ELSE NOW()
             END
       WHERE id = $3 AND "userId" = $4
       RETURNING id, "userAction", "userNote", "userActionAt"`,
      [finalAction, note, recommendationId, session.user.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Recommendation not found" },
        { status: 404 }
      );
    }

    const row = result.rows[0] as {
      id: string;
      userAction: string | null;
      userNote: string | null;
      userActionAt: Date | null;
    };

    log.info("history.action", "recorded", {
      userId: session.user.id,
      recommendationId,
      action: finalAction,
      hasNote: note !== null,
    });

    return NextResponse.json({
      ok: true,
      action: row.userAction,
      note: row.userNote,
      actionAt: row.userActionAt ? row.userActionAt.toISOString() : null,
    });
  } catch (err) {
    log.error("history.action", "save failed", {
      userId: session.user.id,
      recommendationId,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not save action" },
      { status: 500 }
    );
  }
}
