import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await ctx.params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { rows } = await pool.query(
    `SELECT id, recommendation, confidence, "createdAt", "userAction"
     FROM "recommendation"
     WHERE "userId" = $1 AND ticker = $2
     ORDER BY "createdAt" DESC
     LIMIT 3`,
    [session.user.id, ticker.toUpperCase()]
  );
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id as string,
      verdict: r.recommendation as string,
      confidence: r.confidence as string,
      date: (r.createdAt as Date).toISOString().slice(0, 10),
      userAction: (r.userAction as string | null) ?? null,
    })),
  });
}
