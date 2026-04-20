import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { rows } = await pool.query(
    `SELECT id FROM "recommendation"
     WHERE "userId" = $1 AND "source" = 'strategy' AND "createdAt" > NOW() - interval '48 hours'
     ORDER BY "createdAt" DESC LIMIT 1`,
    [session.user.id]
  );
  return NextResponse.json({ id: rows[0]?.id ?? null });
}
