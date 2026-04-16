import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getInsiderAggregates } from "@/lib/data/insider";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/insider/[ticker]
 * Returns aggregated Form 4 insider activity over the last 90 days.
 * Auth-gated and rate-limited because each call hits SEC EDGAR for up
 * to 20 filings, so repeated abuse could get our User-Agent throttled.
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

  // Cheap ceiling — insider lookups are ~20 fetches to SEC so we cap tightly.
  const rl = await checkRateLimit(
    { ...RULES.researchUser, name: "insider:user", limit: 30 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const data = await getInsiderAggregates(ticker, 90);
    return NextResponse.json(data);
  } catch (err) {
    log.error("insider.route", "failed", { ticker, ...errorInfo(err) });
    return NextResponse.json(
      { error: "Could not load insider activity." },
      { status: 500 }
    );
  }
}
