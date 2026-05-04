import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserTrackRecord } from "@/lib/history";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";
import {
  computeSupportedRanges,
  isRangeKey,
  rangeStartDate,
  type RangeKey,
} from "@/lib/track-record/range";

/**
 * GET /api/track-record
 *
 * Returns:
 *   - Track-record totals + outcome counts (last 30 days)
 *   - Portfolio value series, filtered to the requested range
 *   - Range metadata so the dashboard performance chart can render
 *     range buttons honestly:
 *       * `oldestSnapshotDate`  — the actual earliest snapshot we have
 *       * `supportedRanges`      — which range buttons should be enabled
 *       * `range`                — what we actually rendered (may differ
 *                                  from the request when the requested
 *                                  range exceeds available depth)
 *
 * Range param accepts: 30d | ytd | 1y | 2y | 3y | 5y | max.
 * Default `ytd` for backward compatibility with the prior single-range
 * behavior.
 *
 * AGENTS.md hard rule #13 (trust tenet): if depth is insufficient for
 * the requested range, fall back to `max` and echo what was rendered;
 * never interpolate, never lie about depth.
 *
 * Range helpers (VALID_RANGES, isRangeKey, rangeStartDate,
 * computeSupportedRanges) live in `@/lib/track-record/range` because
 * Next.js App Router route files only permit handler exports.
 */

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawRange = url.searchParams.get("range");
  const requested: RangeKey = isRangeKey(rawRange) ? rawRange : "ytd";

  try {
    // Pull track-record summary, oldest snapshot date, oldest *observed*
    // snapshot date (the boundary between reconstructed and observed for
    // the chart legend), and the full series in parallel. We fetch the
    // full available series (no upper age cap) because filtering is cheap
    // in JS once we have it, and it lets us answer `range=max` honestly.
    const [recordData, oldestRow, oldestObservedRow, seriesRows] = await Promise.all([
      getUserTrackRecord(session.user.id, 30),
      pool.query<{ oldest: Date | null }>(
        `SELECT MIN("capturedAt")::timestamptz AS oldest
         FROM "portfolio_snapshot"
         WHERE "userId" = $1`,
        [session.user.id]
      ),
      pool.query<{ oldest: Date | null }>(
        `SELECT MIN("capturedAt")::timestamptz AS oldest
         FROM "portfolio_snapshot"
         WHERE "userId" = $1 AND COALESCE(source, 'observed') = 'observed'`,
        [session.user.id]
      ),
      pool.query(
        `SELECT "capturedAt", "totalValue"::float AS "totalValue",
                "positionCount",
                COALESCE(source, 'observed') AS source
         FROM "portfolio_snapshot"
         WHERE "userId" = $1
         ORDER BY "capturedAt" ASC`,
        [session.user.id]
      ),
    ]);

    const oldestSnapshot = oldestRow.rows[0]?.oldest ?? null;
    const oldestIso =
      oldestSnapshot instanceof Date
        ? oldestSnapshot.toISOString().slice(0, 10)
        : oldestSnapshot
          ? String(oldestSnapshot).slice(0, 10)
          : null;

    const oldestObserved = oldestObservedRow.rows[0]?.oldest ?? null;
    const oldestObservedDate =
      oldestObserved instanceof Date
        ? oldestObserved.toISOString().slice(0, 10)
        : oldestObserved
          ? String(oldestObserved).slice(0, 10)
          : null;

    const now = new Date();
    const supportedRanges = computeSupportedRanges(
      oldestSnapshot instanceof Date
        ? oldestSnapshot
        : oldestSnapshot
          ? new Date(String(oldestSnapshot))
          : null,
      now
    );

    // Resolve effective range. If the requester asked for a range that
    // exceeds available depth, fall back to `max` so we never render a
    // misleading window.
    const effectiveRange: RangeKey = supportedRanges.includes(requested)
      ? requested
      : "max";

    const fullSeries = seriesRows.rows.map(
      (r: Record<string, unknown>) => ({
        date:
          r.capturedAt instanceof Date
            ? r.capturedAt.toISOString().slice(0, 10)
            : String(r.capturedAt).slice(0, 10),
        totalValue: Number(r.totalValue),
        positionCount: Number(r.positionCount),
        source:
          r.source === "reconstructed"
            ? ("reconstructed" as const)
            : ("observed" as const),
      })
    );

    const start = rangeStartDate(effectiveRange, now);
    const portfolioSeries = start
      ? fullSeries.filter((p) => new Date(`${p.date}T00:00:00Z`) >= start)
      : fullSeries;

    return NextResponse.json({
      ok: true,
      ...recordData,
      range: effectiveRange,
      requestedRange: requested,
      oldestSnapshotDate: oldestIso,
      oldestObservedDate,
      supportedRanges,
      portfolioSeries,
    });
  } catch (err) {
    log.error("track-record", "failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json({
      ok: false,
      totals: { total: 0, buys: 0, sells: 0, holds: 0 },
      outcomes: { evaluated: 0, wins: 0, losses: 0, flats: 0, acted: 0 },
      range: "ytd",
      requestedRange: requested,
      oldestSnapshotDate: null,
      oldestObservedDate: null,
      supportedRanges: [],
      portfolioSeries: [],
    });
  }
}
