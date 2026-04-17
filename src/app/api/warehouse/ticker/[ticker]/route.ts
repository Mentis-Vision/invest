import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getTickerMarket,
  getTickerFundamentals,
  getUpcomingEvents,
  getRecentEvents,
  getTickerSentiment,
  getTickerDossier,
} from "@/lib/warehouse";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/warehouse/ticker/[ticker]
 *
 * Returns warehouse data for a single ticker in one payload:
 *   { ticker, market, fundamentals, upcomingEvents, recentEvents, sentiment }
 *
 * Each field is null / empty array when the warehouse hasn't captured
 * anything yet (reader responsibility — the route just relays).
 *
 * Auth-gated + rate-limited at 120/hr per user. No AI spend.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const rl = await checkRateLimit(
    { ...RULES.researchUser, name: "warehouse:ticker", limit: 120 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const [market, fundamentals, upcoming, recent, sentiment, dossier] =
      await Promise.all([
        getTickerMarket(ticker),
        getTickerFundamentals(ticker),
        getUpcomingEvents(ticker, { windowDays: 60 }),
        getRecentEvents(ticker, { windowDays: 90 }),
        getTickerSentiment(ticker),
        getTickerDossier(ticker),
      ]);
    return NextResponse.json({
      ticker,
      dossier,
      market,
      fundamentals,
      upcomingEvents: upcoming,
      recentEvents: recent,
      sentiment,
    });
  } catch (err) {
    log.error("warehouse.ticker.route", "failed", {
      ticker,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not load warehouse data." },
      { status: 500 }
    );
  }
}
