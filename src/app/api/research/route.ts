import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getStockSnapshot, formatSnapshotForAI } from "@/lib/data/yahoo";
import { getRecentFilings, formatFilingsForAI } from "@/lib/data/sec";
import { getMacroSnapshot, formatMacroForAI } from "@/lib/data/fred";
import { runAnalystPanel, runSupervisor } from "@/lib/ai/consensus";
import { checkRateLimit, RULES, getClientIp, sweepStaleBuckets } from "@/lib/rate-limit";
import { checkUsageCap, recordBatchUsage, recordUsage, TIER_LIMITS } from "@/lib/usage";
import { log, errorInfo } from "@/lib/log";
import { saveRecommendationAndSchedule } from "@/lib/history";

export const maxDuration = 120;

const TICKER_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse + validate body
  let body: { ticker?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ticker = body.ticker?.toUpperCase().trim();
  if (!ticker || !TICKER_PATTERN.test(ticker)) {
    return NextResponse.json(
      { error: "Invalid ticker. Use 1–10 uppercase letters, digits, dots, or dashes." },
      { status: 400 }
    );
  }

  // Rate limit: per user (primary) and per IP (defense in depth)
  const userId = session.user.id;
  const ip = getClientIp(req);

  const userRl = await checkRateLimit(RULES.researchUser, userId);
  if (!userRl.ok) {
    log.warn("research", "user rate limit hit", { userId, ticker });
    return NextResponse.json(
      {
        error: "rate_limit",
        message: `You've hit your research limit (${RULES.researchUser.limit}/hour). Try again in ${Math.ceil(userRl.retryAfterSec / 60)} minutes.`,
        retryAfterSec: userRl.retryAfterSec,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(userRl.retryAfterSec),
          "X-RateLimit-Limit": String(RULES.researchUser.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(userRl.resetAt),
        },
      }
    );
  }

  // IP check catches shared-account / credential-stuffing patterns
  const ipRl = await checkRateLimit(
    { ...RULES.researchUser, name: "research:ip", limit: 40 },
    ip
  );
  if (!ipRl.ok) {
    log.warn("research", "ip rate limit hit", { ip, ticker });
    return NextResponse.json(
      {
        error: "rate_limit_ip",
        message: "Too many research requests from your network. Slow down and try again later.",
        retryAfterSec: ipRl.retryAfterSec,
      },
      { status: 429, headers: { "Retry-After": String(ipRl.retryAfterSec) } }
    );
  }

  // Monthly cost cap
  const cap = await checkUsageCap(userId);
  if (!cap.ok) {
    log.info("research", "usage cap hit", { userId, reason: cap.reason, tier: cap.tier });
    return NextResponse.json(
      {
        error: "monthly_limit",
        message:
          cap.reason === "tokens"
            ? `You've used this month's research allowance (${TIER_LIMITS[cap.tier].label} tier). Resets ${cap.resetAt.toISOString()}.`
            : `You've reached your monthly research budget (${TIER_LIMITS[cap.tier].label} tier). Resets ${cap.resetAt.toISOString()}.`,
        resetAt: cap.resetAt,
        tier: cap.tier,
      },
      { status: 402 }
    );
  }

  // Fetch data in parallel
  try {
    const [snap, filings, macro] = await Promise.all([
      getStockSnapshot(ticker),
      getRecentFilings(ticker, 5),
      getMacroSnapshot(),
    ]);

    const dataBlock = [
      formatSnapshotForAI(snap),
      "",
      formatFilingsForAI(filings),
      "",
      formatMacroForAI(macro),
    ].join("\n");

    const analyses = await runAnalystPanel(ticker, dataBlock);
    const supervisor = await runSupervisor(ticker, dataBlock, analyses, snap.asOf);

    // Record usage (fire-and-forget; don't block response)
    const analystUsage = analyses
      .filter((a) => a.tokensUsed)
      .map((a) => ({ model: a.model, tokens: a.tokensUsed ?? 0 }));
    recordBatchUsage(userId, analystUsage).catch(() => {});
    if (supervisor.tokensUsed > 0) {
      recordUsage(userId, supervisor.pricingKey, supervisor.tokensUsed).catch(() => {});
    }

    // Persist recommendation + schedule outcome checks (non-blocking on failure)
    const recordId = await saveRecommendationAndSchedule({
      userId,
      ticker,
      snapshot: snap,
      analyses,
      supervisor: supervisor.output,
      sources: {
        yahoo: true,
        sec: filings.length > 0,
        fred: macro.length > 0,
      },
      supervisorModel: supervisor.supervisorModel,
    }).catch((err) => {
      log.error("research", "saveRecommendation failed", { userId, ticker, ...errorInfo(err) });
      return null;
    });

    // 1% opportunistic sweep of stale rate limit buckets
    if (Math.random() < 0.01) sweepStaleBuckets();

    return NextResponse.json({
      ticker,
      snapshot: snap,
      analyses,
      supervisor: supervisor.output,
      supervisorModel: supervisor.supervisorModel,
      recommendationId: recordId,
      sources: {
        yahoo: true,
        sec: filings.length > 0,
        fred: macro.length > 0,
      },
      usage: {
        tier: cap.tier,
        remainingTokens: cap.remainingTokens,
        remainingCents: cap.remainingCents,
      },
    });
  } catch (err) {
    log.error("research", "pipeline failed", { userId, ticker, ...errorInfo(err) });
    const msg =
      err instanceof Error && err.message.toLowerCase().includes("fetch")
        ? `Could not fetch data for ${ticker}. Verify the ticker symbol.`
        : "Analysis failed. Please try again.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
