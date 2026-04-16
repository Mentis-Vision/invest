import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserTrackRecord } from "@/lib/history";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/track-record
 * Returns (a) 30-day track record totals + outcome counts and
 * (b) 90-day portfolio value series from portfolio_snapshot cron.
 * Single endpoint so the dashboard can fetch everything in one call.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [recordData, seriesRows] = await Promise.all([
      getUserTrackRecord(session.user.id, 30),
      pool.query(
        `SELECT "capturedAt", "totalValue"::float AS "totalValue",
                "positionCount"
         FROM "portfolio_snapshot"
         WHERE "userId" = $1
           AND "capturedAt" > CURRENT_DATE - INTERVAL '90 days'
         ORDER BY "capturedAt" ASC`,
        [session.user.id]
      ),
    ]);

    const portfolioSeries = seriesRows.rows.map(
      (r: Record<string, unknown>) => ({
        date:
          r.capturedAt instanceof Date
            ? r.capturedAt.toISOString().slice(0, 10)
            : String(r.capturedAt).slice(0, 10),
        totalValue: Number(r.totalValue),
        positionCount: Number(r.positionCount),
      })
    );

    return NextResponse.json({ ...recordData, portfolioSeries });
  } catch (err) {
    log.error("track-record", "failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json({
      totals: { total: 0, buys: 0, sells: 0, holds: 0 },
      outcomes: { evaluated: 0, wins: 0, losses: 0, flats: 0, acted: 0 },
      portfolioSeries: [],
    });
  }
}
