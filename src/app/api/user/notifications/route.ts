import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * Notifications preferences.
 *
 * GET  — return the current flags
 * POST — update one or more flags. Body: { weeklyDigestOptOut?: boolean }
 *
 * Kept small: right now the only switch is the weekly-digest opt-out,
 * but this shape scales (add transactional-email opts, marketing
 * opts, etc. as future flags without restructuring).
 */

type Prefs = {
  weeklyDigestOptOut: boolean;
};

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { rows } = await pool.query<{ weeklyDigestOptOut: boolean | null }>(
      `SELECT "weeklyDigestOptOut" FROM "user" WHERE id = $1`,
      [session.user.id]
    );
    const prefs: Prefs = {
      weeklyDigestOptOut: Boolean(rows[0]?.weeklyDigestOptOut),
    };
    return NextResponse.json(prefs);
  } catch (err) {
    log.error("user.notifications", "GET failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not load preferences." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { weeklyDigestOptOut?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const sets: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (typeof body.weeklyDigestOptOut === "boolean") {
      sets.push(`"weeklyDigestOptOut" = $${p++}`);
      params.push(body.weeklyDigestOptOut);
    }
    if (sets.length === 0) {
      return NextResponse.json(
        { error: "No supported fields in body." },
        { status: 400 }
      );
    }
    params.push(session.user.id);
    await pool.query(
      `UPDATE "user" SET ${sets.join(", ")} WHERE id = $${p}`,
      params
    );
    const { rows } = await pool.query<{ weeklyDigestOptOut: boolean | null }>(
      `SELECT "weeklyDigestOptOut" FROM "user" WHERE id = $1`,
      [session.user.id]
    );
    log.info("user.notifications", "updated", {
      userId: session.user.id,
      weeklyDigestOptOut: rows[0]?.weeklyDigestOptOut ?? null,
    });
    return NextResponse.json({
      weeklyDigestOptOut: Boolean(rows[0]?.weeklyDigestOptOut),
    });
  } catch (err) {
    log.error("user.notifications", "POST failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not save preferences." },
      { status: 500 }
    );
  }
}
