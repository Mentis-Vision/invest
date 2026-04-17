import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkRateLimit, RULES, getClientIp } from "@/lib/rate-limit";
import { log } from "@/lib/log";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRl = await checkRateLimit(RULES.strategyUser, session.user.id);
  if (!userRl.ok) {
    log.warn("strategy", "rate limit hit", { userId: session.user.id });
    return NextResponse.json(
      {
        error: "rate_limit",
        message: `Strategy limit reached (${RULES.strategyUser.limit}/hour). Try again later.`,
        retryAfterSec: userRl.retryAfterSec,
      },
      { status: 429, headers: { "Retry-After": String(userRl.retryAfterSec) } }
    );
  }

  const ipRl = await checkRateLimit(
    { ...RULES.strategyUser, name: "strategy:ip", limit: 20 },
    getClientIp(req)
  );
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: "rate_limit_ip", retryAfterSec: ipRl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(ipRl.retryAfterSec) } }
    );
  }

  // The real strategy analysis lives at /api/portfolio-review (runs the
  // 3-model panel over the user's full portfolio). This endpoint exists
  // only as a stable name for legacy callers; it redirects intent by
  // returning a structured hint rather than any advice of its own.
  return NextResponse.json({
    redirectTo: "/api/portfolio-review",
    message:
      "Use /api/portfolio-review for portfolio-level analysis. Connect a brokerage via the Portfolio tab if you haven't yet.",
    cta: "use_portfolio_review",
  });
}
