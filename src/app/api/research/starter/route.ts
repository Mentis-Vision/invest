import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/research/starter
 *
 * Returns the empty-state material for the Research page:
 *   - `recent`    : user's own most-recently-researched tickers (last 30d)
 *   - `trending`  : anonymized top tickers researched across ALL users (last 7d)
 *   - `earnings`  : held tickers with earnings in the next 7 days
 *   - `filings`   : held tickers with filings in the last 7 days
 *
 * All reads, no AI. Auth-gated. Safe defaults on failure — the page
 * degrades gracefully to a plain search box.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: {
    recent: Array<{ ticker: string; recommendation: string; when: string }>;
    trending: Array<{ ticker: string; count: number }>;
    earnings: Array<{ ticker: string; eventDate: string }>;
    filings: Array<{ ticker: string; eventType: string; eventDate: string; url: string | null }>;
  } = { recent: [], trending: [], earnings: [], filings: [] };

  try {
    const recent = await pool.query(
      `SELECT DISTINCT ON (ticker)
         ticker,
         recommendation,
         "createdAt"
       FROM "recommendation"
       WHERE "userId" = $1
         AND "createdAt" > NOW() - INTERVAL '30 days'
       ORDER BY ticker, "createdAt" DESC
       LIMIT 12`,
      [session.user.id]
    );
    result.recent = recent.rows.map((r) => ({
      ticker: String(r.ticker),
      recommendation: String(r.recommendation),
      when: new Date(r.createdAt as Date).toISOString(),
    }));
  } catch (err) {
    log.warn("research.starter", "recent failed", errorInfo(err));
  }

  try {
    // Trending: top researched tickers by distinct-user count in the last
    // 7 days. Distinct-user count is the privacy-safe signal — a single
    // user hammering one ticker shouldn't dominate.
    const trending = await pool.query(
      `SELECT ticker, COUNT(DISTINCT "userId")::int AS n
       FROM "recommendation"
       WHERE "createdAt" > NOW() - INTERVAL '7 days'
       GROUP BY ticker
       ORDER BY n DESC, ticker ASC
       LIMIT 10`
    );
    result.trending = trending.rows.map((r) => ({
      ticker: String(r.ticker),
      count: Number(r.n ?? 0),
    }));
  } catch (err) {
    log.warn("research.starter", "trending failed", errorInfo(err));
  }

  try {
    // Earnings in the next 7 days — intersected with the user's holdings
    // so the list is personally-relevant.
    const earnings = await pool.query(
      `SELECT ticker, event_date::text AS event_date
       FROM (
         SELECT DISTINCT ON (e.ticker)
           e.ticker,
           e.event_date
         FROM "ticker_events" e
         JOIN "holding" h ON h.ticker = e.ticker AND h."userId" = $1
         WHERE e.event_type = 'earnings'
           AND e.event_date >= CURRENT_DATE
           AND e.event_date <= CURRENT_DATE + INTERVAL '7 days'
         ORDER BY e.ticker, e.event_date ASC
       ) upcoming
       ORDER BY event_date ASC, ticker ASC
       LIMIT 10`,
      [session.user.id]
    );
    result.earnings = earnings.rows.map((r) => ({
      ticker: String(r.ticker),
      eventDate: String(r.event_date),
    }));
  } catch (err) {
    log.warn("research.starter", "earnings failed", errorInfo(err));
  }

  try {
    // Recent filings on holdings — last 7 days, most recent first.
    const filings = await pool.query(
      `SELECT DISTINCT ON (e.ticker, e.event_type)
         e.ticker,
         e.event_type,
         e.event_date::text AS event_date,
         (e.details->>'url') AS url
       FROM "ticker_events" e
       JOIN "holding" h ON h.ticker = e.ticker AND h."userId" = $1
       WHERE e.event_type LIKE 'filing_%'
         AND e.event_date >= CURRENT_DATE - INTERVAL '7 days'
         AND e.event_date <= CURRENT_DATE
       ORDER BY e.ticker, e.event_type, e.event_date DESC
       LIMIT 12`,
      [session.user.id]
    );
    result.filings = filings.rows.map((r) => ({
      ticker: String(r.ticker),
      eventType: String(r.event_type),
      eventDate: String(r.event_date),
      url: r.url ? String(r.url) : null,
    }));
  } catch (err) {
    log.warn("research.starter", "filings failed", errorInfo(err));
  }

  return NextResponse.json(result);
}
