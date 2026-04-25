import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * Notifications preferences.
 *
 * GET  — return the current flags
 * POST — update one or more flags. Body shape:
 *          { weeklyDigestOptOut?: boolean; weeklyBriefOptOut?: boolean }
 *
 * Pattern scales: each new switch adds one entry to the SUPPORTED_FLAGS
 * map below, no other changes. Both flags persisted on `"user"` via a
 * single UPDATE so a multi-flag toggle is atomic.
 */

type Prefs = {
  weeklyDigestOptOut: boolean;
  weeklyBriefOptOut: boolean;
};

// Centralised flag list — column name in DB, mirrors body key 1:1. Add
// new flags here and they automatically work in GET + POST.
const SUPPORTED_FLAGS = ["weeklyDigestOptOut", "weeklyBriefOptOut"] as const;
type FlagKey = (typeof SUPPORTED_FLAGS)[number];

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Build the SELECT list dynamically so we never reference a column
    // not in SUPPORTED_FLAGS — keeps the surface area honest.
    const cols = SUPPORTED_FLAGS.map((f) => `"${f}"`).join(", ");
    const { rows } = await pool.query<Record<FlagKey, boolean | null>>(
      `SELECT ${cols} FROM "user" WHERE id = $1`,
      [session.user.id]
    );
    const row = rows[0] ?? ({} as Partial<Record<FlagKey, boolean | null>>);
    const prefs: Prefs = {
      weeklyDigestOptOut: Boolean(row.weeklyDigestOptOut),
      weeklyBriefOptOut: Boolean(row.weeklyBriefOptOut),
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

  let body: Partial<Record<FlagKey, unknown>>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const sets: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const flag of SUPPORTED_FLAGS) {
      const v = body[flag];
      if (typeof v === "boolean") {
        sets.push(`"${flag}" = $${p++}`);
        params.push(v);
      }
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
    const cols = SUPPORTED_FLAGS.map((f) => `"${f}"`).join(", ");
    const { rows } = await pool.query<Record<FlagKey, boolean | null>>(
      `SELECT ${cols} FROM "user" WHERE id = $1`,
      [session.user.id]
    );
    const row = rows[0] ?? ({} as Partial<Record<FlagKey, boolean | null>>);
    log.info("user.notifications", "updated", {
      userId: session.user.id,
      weeklyDigestOptOut: row.weeklyDigestOptOut ?? null,
      weeklyBriefOptOut: row.weeklyBriefOptOut ?? null,
    });
    return NextResponse.json({
      weeklyDigestOptOut: Boolean(row.weeklyDigestOptOut),
      weeklyBriefOptOut: Boolean(row.weeklyBriefOptOut),
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
