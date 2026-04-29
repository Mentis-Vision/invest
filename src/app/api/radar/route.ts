import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getClientIp, checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";
import {
  scanTickerForRadarAlerts,
  scanUserHoldingsForRadarAlerts,
} from "@/lib/decision-engine/radar";

const TICKER_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ alerts: [] }, { status: 401 });
  }

  const userId = session.user.id;
  const userRl = await checkRateLimit(
    { ...RULES.researchUser, name: "radar:user", limit: 30 },
    userId
  );
  if (!userRl.ok) {
    return NextResponse.json(
      {
        error: "rate_limit",
        message: `Risk Radar limit reached. Try again in ${Math.ceil(userRl.retryAfterSec / 60)} minutes.`,
        retryAfterSec: userRl.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(userRl.retryAfterSec) },
      }
    );
  }

  const ipRl = await checkRateLimit(
    { ...RULES.researchUser, name: "radar:ip", limit: 80 },
    getClientIp(req)
  );
  if (!ipRl.ok) {
    return NextResponse.json(
      {
        error: "rate_limit_ip",
        message: "Too many radar requests from your network. Try again later.",
        retryAfterSec: ipRl.retryAfterSec,
      },
      { status: 429, headers: { "Retry-After": String(ipRl.retryAfterSec) } }
    );
  }

  const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim();
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 12);
  const limit = Number.isFinite(limitParam) ? limitParam : 12;

  if (ticker && !TICKER_PATTERN.test(ticker)) {
    return NextResponse.json(
      { error: "Invalid ticker." },
      { status: 400 }
    );
  }

  try {
    const alerts = ticker
      ? await scanTickerForRadarAlerts({ userId, ticker })
      : await scanUserHoldingsForRadarAlerts({ userId, limit });
    return NextResponse.json(
      {
        alerts,
        disclosure:
          "Risk Radar is decision support only. Informational only, not investment advice.",
      },
      {
        headers: {
          "Cache-Control": "private, max-age=30",
        },
      }
    );
  } catch (err) {
    log.warn("radar", "scan failed", errorInfo(err));
    return NextResponse.json({ alerts: [] });
  }
}
