import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/warehouse/freshness
 *
 * Returns the most-recent warehouse refresh timestamp so app surfaces
 * can show "Refreshed overnight" / "Last sync 6:42 AM" tags. The actual
 * data is the max(as_of) across ticker_market_daily — that table is
 * the always-populated centerpiece of every cron run, so it's the most
 * reliable freshness signal.
 *
 * Auth-gated (the proxy already gates /api/warehouse/*) but no PII or
 * per-user data — same row for every caller. Cached at the CDN edge for
 * 60s since the answer changes at most once per cron tick (nightly).
 */
export const revalidate = 60;

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { rows } = await pool.query(
      `SELECT MAX(as_of) AS as_of, MAX(captured_at) AS captured_at,
              COUNT(*)::int AS row_count
         FROM "ticker_market_daily"
        WHERE captured_at >= CURRENT_DATE - INTERVAL '2 days'`
    );
    const r = (rows[0] ?? {}) as {
      as_of: Date | null;
      captured_at: Date | null;
      row_count: number;
    };
    if (!r.as_of) {
      return NextResponse.json({
        asOf: null,
        capturedAt: null,
        rowCount: 0,
        isFreshToday: false,
      });
    }
    const asOfIso =
      r.as_of instanceof Date ? r.as_of.toISOString() : String(r.as_of);
    const capturedIso =
      r.captured_at instanceof Date
        ? r.captured_at.toISOString().slice(0, 10)
        : null;
    const today = new Date().toISOString().slice(0, 10);
    return NextResponse.json({
      asOf: asOfIso,
      capturedAt: capturedIso,
      rowCount: r.row_count,
      isFreshToday: capturedIso === today,
    });
  } catch (err) {
    log.warn("warehouse.freshness", "query failed", errorInfo(err));
    return NextResponse.json(
      { asOf: null, capturedAt: null, rowCount: 0, isFreshToday: false },
      { status: 200 }
    );
  }
}
