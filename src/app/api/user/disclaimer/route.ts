import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ accepted: false }, { status: 401 });
  }

  try {
    const { rows } = await pool.query(
      `SELECT "disclaimerAcceptedAt" FROM "user" WHERE id = $1`,
      [session.user.id]
    );
    const row = rows[0] as { disclaimerAcceptedAt: Date | null } | undefined;
    return NextResponse.json({
      accepted: !!row?.disclaimerAcceptedAt,
      acceptedAt: row?.disclaimerAcceptedAt ?? null,
    });
  } catch (err) {
    log.error("user.disclaimer", "read failed", { ...errorInfo(err) });
    return NextResponse.json({ accepted: false });
  }
}

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await pool.query(
      `UPDATE "user" SET "disclaimerAcceptedAt" = NOW() WHERE id = $1`,
      [session.user.id]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("user.disclaimer", "write failed", { ...errorInfo(err) });
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
