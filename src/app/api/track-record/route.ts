import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserTrackRecord } from "@/lib/history";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

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
 */

const VALID_RANGES = ["30d", "ytd", "1y", "2y", "3y", "5y", "max"] as const;
type RangeKey = (typeof VALID_RANGES)[number];

function isRangeKey(value: string | null): value is RangeKey {
  return !!value && (VALID_RANGES as readonly string[]).includes(value);
}

/**
 * Compute the start date a range covers, given the current day. Returns
 * null for `max` (no lower bound). Uses UTC for consistency with the
 * snapshot capturedAt slicing elsewhere in the file.
 */
function rangeStartDate(range: RangeKey, now: Date): Date | null {
  if (range === "max") return null;
  const d = new Date(now.getTime());
  if (range === "ytd") {
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }
  const days =
    range === "30d"
      ? 30
      : range === "1y"
        ? 365
        : range === "2y"
          ? 730
          : range === "3y"
            ? 1095
            : 1825; // 5y
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/**
 * Compute supportedRanges given the oldest snapshot date. A range is
 * supported when oldest ≤ that range's start date.
 *
 * `max` is always supported when ANY snapshots exist. The other ranges
 * include themselves only if the depth permits — never bait the UI to
 * render a button for data we don't have.
 */
export function computeSupportedRanges(
  oldestSnapshot: Date | null,
  now: Date = new Date()
): RangeKey[] {
  if (!oldestSnapshot) return [];
  const supported: RangeKey[] = [];
  for (const r of VALID_RANGES) {
    if (r === "max") {
      supported.push(r);
      continue;
    }
    const start = rangeStartDate(r, now);
    if (start && oldestSnapshot.getTime() <= start.getTime()) {
      supported.push(r);
    }
  }
  return supported;
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawRange = url.searchParams.get("range");
  const requested: RangeKey = isRangeKey(rawRange) ? rawRange : "ytd";

  try {
    // Pull track-record summary, oldest snapshot date, and the full
    // series in parallel. We fetch the full available series (no upper
    // age cap) because filtering is cheap in JS once we have it, and
    // it lets us answer `range=max` honestly.
    const [recordData, oldestRow, seriesRows] = await Promise.all([
      getUserTrackRecord(session.user.id, 30),
      pool.query<{ oldest: Date | null }>(
        `SELECT MIN("capturedAt")::timestamptz AS oldest
         FROM "portfolio_snapshot"
         WHERE "userId" = $1`,
        [session.user.id]
      ),
      pool.query(
        `SELECT "capturedAt", "totalValue"::float AS "totalValue",
                "positionCount"
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
      supportedRanges: [],
      portfolioSeries: [],
    });
  }
}
