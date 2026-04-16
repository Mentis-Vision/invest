import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/outcome-ping
 *
 * Returns up to 3 recent outcome evaluations (last 24h) the user hasn't
 * been nudged about yet. Powers the "your BUY on TSLA 30 days ago
 * was +4.2%" banner on the Research tab.
 *
 * We don't yet persist a "seen" flag on the client side, so the
 * endpoint always returns the same set within the window. The UI
 * dismisses locally per-session (sessionStorage); this keeps the
 * contract simple.
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
         o."priceAtCheck",
         o."percentMove",
         o.verdict,
         o."evaluatedAt",
         r.id AS recommendation_id,
         r.ticker,
         r.recommendation,
         r.confidence,
         r."priceAtRec",
         r."createdAt" AS rec_created_at
       FROM "recommendation_outcome" o
       JOIN "recommendation" r ON r.id = o."recommendationId"
       WHERE r."userId" = $1
         AND o.status = 'completed'
         AND o."evaluatedAt" > NOW() - INTERVAL '24 hours'
       ORDER BY o."evaluatedAt" DESC
       LIMIT 3`,
      [session.user.id]
    );

    const items = rows.map((r: Record<string, unknown>) => ({
      outcomeId: r.outcome_id as string,
      recommendationId: r.recommendation_id as string,
      ticker: r.ticker as string,
      window: r.window as string,
      recommendation: r.recommendation as string,
      confidence: r.confidence as string,
      priceAtRec: Number(r.priceAtRec),
      priceAtCheck: r.priceAtCheck != null ? Number(r.priceAtCheck) : null,
      percentMove: r.percentMove != null ? Number(r.percentMove) : null,
      verdict: r.verdict as string | null,
      evaluatedAt:
        r.evaluatedAt instanceof Date
          ? r.evaluatedAt.toISOString()
          : String(r.evaluatedAt),
      recCreatedAt:
        r.rec_created_at instanceof Date
          ? r.rec_created_at.toISOString()
          : String(r.rec_created_at),
    }));

    return NextResponse.json({ items });
  } catch (err) {
    log.warn("outcome-ping", "query failed", { ...errorInfo(err) });
    return NextResponse.json({ items: [] });
  }
}
