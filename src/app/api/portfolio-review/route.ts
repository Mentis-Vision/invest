import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { checkRateLimit, RULES, getClientIp } from "@/lib/rate-limit";
import { checkUsageCap, TIER_LIMITS, usageBlockedJson } from "@/lib/usage";
import {
  generatePortfolioReview,
  getCachedPortfolioReview,
  diagnoseEmptyHoldings,
} from "@/lib/portfolio-review";
import { log, errorInfo } from "@/lib/log";

/**
 * GET  /api/portfolio-review  → cached today's review (no AI cost)
 * POST /api/portfolio-review  → force-rerun, costs tokens
 *
 * Why two methods:
 *   The nightly cron now pre-computes the review for every connected
 *   user. First-login the next morning calls GET and reads the stored
 *   row in ~50ms with $0 spent. POST is the explicit "I want a fresh
 *   one right now even though it'll cost tokens" path — the strategy
 *   view only exposes it after the cached one has been shown.
 *
 *   On GET, if no cached review exists yet (new user, just connected
 *   their brokerage minutes ago, cron hasn't run), we still run live
 *   so the user isn't stuck staring at a blank page until tomorrow.
 */
export const maxDuration = 120;

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cheap rate-limit only — GET is hitting cache 99% of the time.
  const userRl = await checkRateLimit(
    { ...RULES.strategyUser, name: "portfolio-review:get", limit: 60 },
    session.user.id
  );
  if (!userRl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: userRl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(userRl.retryAfterSec) } }
    );
  }

  try {
    const cached = await getCachedPortfolioReview(session.user.id);
    if (cached) {
      return NextResponse.json(cached);
    }

    // No cached row for today — likely a brand-new connection that the
    // cron hasn't seen yet. Run live, but enforce the usage cap since
    // this DOES spend tokens. The cap check matters less here because
    // most days users hit the cache.
    const cap = await checkUsageCap(session.user.id);
    if (!cap.ok) {
      // Hard wall (expired/past_due) → 402 trial_ended; over-cap →
      // 429 monthly_limit. Single helper formats both.
      const blocked = usageBlockedJson(cap);
      return NextResponse.json(blocked.body, { status: blocked.status });
    }
    const review = await generatePortfolioReview(session.user.id);
    return NextResponse.json({ ...review, cached: false });
  } catch (err) {
    if ((err as Error)?.message === "no_holdings") {
      const diag = await diagnoseEmptyHoldings(session.user.id);
      return NextResponse.json(
        {
          error: diag.state,
          message: diag.message,
          ...("institutionName" in diag
            ? { institutionName: diag.institutionName }
            : {}),
          ...("retryAfterSec" in diag
            ? { retryAfterSec: diag.retryAfterSec }
            : {}),
          ...("itemId" in diag ? { itemId: diag.itemId } : {}),
        },
        { status: 400 }
      );
    }
    log.error("portfolio-review.get", "failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Review failed. Try again." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const userRl = await checkRateLimit(
    { ...RULES.strategyUser, name: "portfolio-review:user", limit: 10 },
    userId
  );
  if (!userRl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: userRl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(userRl.retryAfterSec) } }
    );
  }

  const ipRl = await checkRateLimit(
    { ...RULES.strategyUser, name: "portfolio-review:ip", limit: 20 },
    getClientIp(req)
  );
  if (!ipRl.ok) {
    return NextResponse.json({ error: "rate_limit_ip" }, { status: 429 });
  }

  const cap = await checkUsageCap(userId);
  if (!cap.ok) {
    // Hard wall (expired/past_due) → 402 trial_ended; over-cap →
    // 429 monthly_limit. Single helper formats both.
    const blocked = usageBlockedJson(cap);
    return NextResponse.json(blocked.body, { status: blocked.status });
  }

  try {
    const review = await generatePortfolioReview(userId);
    return NextResponse.json({ ...review, cached: false });
  } catch (err) {
    if ((err as Error)?.message === "no_holdings") {
      // Give the user an honest, specific message about WHY there are
      // no holdings — syncing, needs reauth, truly not connected, etc.
      // 400 status preserved so existing UI error handling still fires,
      // but the `error` code is specific enough for the client to
      // branch on (e.g. "syncing" → poll; "needs_reauth" → show CTA).
      const diag = await diagnoseEmptyHoldings(session?.user?.id ?? userId);
      return NextResponse.json(
        {
          error: diag.state,
          message: diag.message,
          ...("institutionName" in diag
            ? { institutionName: diag.institutionName }
            : {}),
          ...("retryAfterSec" in diag
            ? { retryAfterSec: diag.retryAfterSec }
            : {}),
          ...("itemId" in diag ? { itemId: diag.itemId } : {}),
        },
        { status: 400 }
      );
    }
    log.error("portfolio-review", "failed", { userId, ...errorInfo(err) });
    return NextResponse.json({ error: "Review failed. Try again." }, { status: 500 });
  }
}
