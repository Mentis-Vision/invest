import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ticker) id, ticker, recommendation, "createdAt"
     FROM "recommendation"
     WHERE "userId" = $1 AND "source" = 'research'
     ORDER BY ticker, "createdAt" DESC
     LIMIT 10`,
    [session.user.id]
  );
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id as string,
      ticker: r.ticker as string,
      verdict: r.recommendation as string,
      date: (r.createdAt as Date).toISOString().slice(0, 10),
    })),
  });
}
