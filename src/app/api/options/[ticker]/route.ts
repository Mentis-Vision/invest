import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { polygonConfigured, getFrontMonthChain } from "@/lib/data/polygon";
import { getStockSnapshot } from "@/lib/data/yahoo";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/options/[ticker]
 *
 * Returns a near-ATM front-month options chain for the ticker.
 * Source: Polygon.io. Returns { configured: false } when Polygon
 * isn't keyed so the UI hides the section gracefully.
 *
 * Auth-gated; rate-limited at 60/hr per user. No AI cost.
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
    { ...RULES.researchUser, name: "options:user", limit: 60 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  if (!polygonConfigured()) {
    return NextResponse.json({
      ticker,
      configured: false,
      message: "Options chain unavailable.",
    });
  }

  try {
    // Need spot price to pick the at-the-money strikes.
    const snapshot = await getStockSnapshot(ticker).catch(() => null);
    if (!snapshot || !snapshot.price) {
      return NextResponse.json(
        { ticker, configured: true, error: "no_spot" },
        { status: 200 }
      );
    }
    const chain = await getFrontMonthChain(ticker, snapshot.price, 5);
    if (!chain) {
      return NextResponse.json({
        ticker,
        configured: true,
        spotPrice: snapshot.price,
        chain: null,
      });
    }
    return NextResponse.json({
      ticker,
      configured: true,
      spotPrice: snapshot.price,
      ...chain,
    });
  } catch (err) {
    log.error("options.route", "failed", {
      ticker,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not load options chain." },
      { status: 500 }
    );
  }
}
