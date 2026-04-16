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

  return NextResponse.json({
    advice:
      "Portfolio strategy analysis is available once you connect a brokerage. Use the Portfolio tab to link your account via Plaid.",
    cta: "connect_brokerage",
  });
}
