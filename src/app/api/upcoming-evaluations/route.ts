import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/upcoming-evaluations
 *
 * Returns the next 5 pending recommendation_outcome rows for the
 * signed-in user, so the dashboard can render "NVDA 7d check in 2
 * days" countdown chips. Only shows actionable recs (we don't schedule
 * outcomes for INSUFFICIENT_DATA).
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ items: [] }, { status: 401 });
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         o.id AS outcome_id,
         o."window" AS window,
         o."checkAt",
         r.id AS recommendation_id,
         r.ticker,
         r.recommendation,
         r.confidence,
         r."createdAt" AS rec_created_at
       FROM "recommendation_outcome" o
       JOIN "recommendation" r ON r.id = o."recommendationId"
       WHERE r."userId" = $1
         AND o.status = 'pending'
         AND o."checkAt" > NOW()
       ORDER BY o."checkAt" ASC
       LIMIT 5`,
      [session.user.id]
    );

    const items = rows.map((r: Record<string, unknown>) => ({
      outcomeId: r.outcome_id as string,
      recommendationId: r.recommendation_id as string,
      ticker: r.ticker as string,
      window: r.window as string,
      recommendation: r.recommendation as string,
      confidence: r.confidence as string,
      checkAt:
        r.checkAt instanceof Date
          ? r.checkAt.toISOString()
          : String(r.checkAt),
      recCreatedAt:
        r.rec_created_at instanceof Date
          ? r.rec_created_at.toISOString()
          : String(r.rec_created_at),
    }));

    return NextResponse.json({ items });
  } catch (err) {
    log.warn("upcoming-evaluations", "query failed", { ...errorInfo(err) });
    return NextResponse.json({ items: [] });
  }
}
