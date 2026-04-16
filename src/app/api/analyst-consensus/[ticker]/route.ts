import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getAnalystConsensus } from "@/lib/data/yahoo-extras";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/analyst-consensus/[ticker]
 * Wall Street analyst consensus strip data — target price, coverage count,
 * recommendation key, recent upgrades/downgrades. Sourced from Yahoo Finance
 * quoteSummary; auth-gated + rate-limited.
 *
 * Note: this is the third-party analyst *consensus* (the Street), rendered
 * alongside ClearPath's own verdict for cross-reference. Explicitly NOT
 * the same as ClearPath's AI-panel recommendation.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const rl = await checkRateLimit(
    { ...RULES.researchUser, name: "analyst-consensus:user", limit: 60 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const data = await getAnalystConsensus(ticker);
    return NextResponse.json(data);
  } catch (err) {
    log.error("analyst-consensus", "failed", { ticker, ...errorInfo(err) });
    return NextResponse.json(
      { error: "Could not load analyst consensus." },
      { status: 500 }
    );
  }
}
