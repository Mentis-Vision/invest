import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { runSingleAnalyst, runBullBearDebate } from "@/lib/ai/consensus";
import { checkRateLimit, RULES, getClientIp } from "@/lib/rate-limit";
import { checkUsageCap, recordUsage, TIER_LIMITS } from "@/lib/usage";
import { getStockSnapshot, formatWarehouseEnhancedDataBlock } from "@/lib/data/yahoo";
import { getRecentFilings, formatFilingsForAI } from "@/lib/data/sec";
import { getMacroSnapshot, formatMacroForAI } from "@/lib/data/fred";
import { getUserProfile, buildProfileRider } from "@/lib/user-profile";
import {
  getCachedRecommendation,
  saveCacheableRecommendation,
} from "@/lib/history";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/research/standard
 *
 * Middle tier of the Unified-B research suite. Single top-tier model
 * (Claude Sonnet by default), full AnalystOutputSchema including tool
 * use — but NO three-way cross-verification and NO supervisor pass.
 *
 * Sizing: ~8k tokens / ~$0.06 per run. Roughly 3.5× Quick Scan, 1/3 Full
 * Panel. Sweet spot for "I've narrowed to the interesting-looking ones;
 * give me a real thesis before I commit."
 *
 * Caller can optionally specify `model` (claude/gpt/gemini) if they
 * want a specific lens. Default is Claude (value lens).
 */
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 30/hr per user, 15/hr per IP — tighter than Quick Scan because the
  // per-run cost is 15x higher.
  const userRl = await checkRateLimit(
    { ...RULES.researchUser, name: "standard:user", limit: 30 },
    session.user.id
  );
  if (!userRl.ok) {
    return NextResponse.json(
      {
        error: "rate_limit",
        retryAfterSec: userRl.retryAfterSec,
      },
      { status: 429, headers: { "Retry-After": String(userRl.retryAfterSec) } }
    );
  }

  const ipRl = await checkRateLimit(
    { ...RULES.researchIp, name: "standard:ip", limit: 15 },
    getClientIp(req)
  );
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: "rate_limit_ip", retryAfterSec: ipRl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(ipRl.retryAfterSec) } }
    );
  }

  const usage = await checkUsageCap(session.user.id);
  if (!usage.ok) {
    const limits = TIER_LIMITS[usage.tier] ?? TIER_LIMITS.beta;
    return NextResponse.json(
      {
        error: "monthly_limit",
        message: `You've reached your monthly AI budget (${limits.label} tier). Resets ${usage.resetAt.toISOString()}.`,
        tier: usage.tier,
        resetAt: usage.resetAt,
      },
      { status: 402 }
    );
  }

  let ticker: string;
  let lensChoice: "claude" | "gpt" | "gemini" = "claude";
  try {
    const body = await req.json();
    const raw = String(body?.ticker ?? "").toUpperCase().trim();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(raw)) {
      return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
    }
    ticker = raw;
    const requestedLens = String(body?.lens ?? "").toLowerCase();
    if (
      requestedLens === "claude" ||
      requestedLens === "gpt" ||
      requestedLens === "gemini"
    ) {
      lensChoice = requestedLens;
    }
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    // Same-day cache short-circuit. Deep Reads cost ~$0.06 each — a
    // tab-switch + return on the same ticker should NOT spend tokens
    // when the warehouse hasn't refreshed.
    const cached = await getCachedRecommendation(
      session.user.id,
      ticker,
      1440,
      "deep"
    );
    if (cached) {
      const a = cached.analysisJson as {
        snapshot?: Record<string, unknown>;
        analysis?: Record<string, unknown>;
        debate?: Record<string, unknown>;
        lens?: string;
      };
      const ageMs = Date.now() - cached.createdAt.getTime();
      return NextResponse.json({
        ticker,
        snapshot: a.snapshot,
        mode: "deep",
        lens: a.lens ?? "claude",
        analysis: a.analysis,
        debate: a.debate,
        tokensUsed: 0,
        cached: true,
        cachedAt: cached.createdAt.toISOString(),
        cachedAgeSec: Math.floor(ageMs / 1000),
        usage: {
          tier: usage.tier,
          remainingCents: usage.remainingCents,
        },
      });
    }

    // Same warehouse-enhanced DATA block the Full Panel uses. The analyst
    // sees exactly the same verified context, just with fewer cooks.
    const [snapshot, filings, macro, profile] = await Promise.all([
      getStockSnapshot(ticker).catch(() => null),
      getRecentFilings(ticker, 5).catch(() => []),
      getMacroSnapshot().catch(() => []),
      getUserProfile(session.user.id).catch(() => null),
    ]);

    if (!snapshot) {
      return NextResponse.json(
        {
          error: "ticker_not_found",
          message: `Couldn't resolve ${ticker}. Double-check the symbol.`,
        },
        { status: 404 }
      );
    }

    const dataBlock = [
      await formatWarehouseEnhancedDataBlock(snapshot),
      "",
      formatFilingsForAI(filings),
      "",
      formatMacroForAI(macro),
    ].join("\n");

    const profileRider = profile ? buildProfileRider(profile) : null;
    const result = await runSingleAnalyst(
      ticker,
      dataBlock,
      lensChoice,
      profileRider
    );

    // Adversarial debate runs on the single analyst's output. Two cheap
    // Haiku calls (~$0.012). The same architecture the Full Panel uses,
    // just with one analyst feeding the debate instead of three. Gives
    // Deep Read the differentiating bull/bear cards without the cost
    // of the 3-model panel.
    const debate = await runBullBearDebate(ticker, dataBlock, [result]);

    const analystTokens = result.tokensUsed ?? 0;
    const debateTokens = (debate.bullTokens ?? 0) + (debate.bearTokens ?? 0);
    void recordUsage(session.user.id, lensChoice, analystTokens);
    if (debateTokens > 0) {
      void recordUsage(session.user.id, "haiku", debateTokens);
    }

    // Save for same-day cache. Deep Reads cost ~$0.06; we don't want
    // a tab-switch + return on the same ticker to spend tokens twice.
    // ModelResult.output may be missing if the analyst failed schema —
    // skip the cache write in that case (don't poison the cache with
    // garbage).
    if (result.output) {
      void saveCacheableRecommendation({
        userId: session.user.id,
        ticker,
        mode: "deep",
        recommendation: result.output.recommendation,
        confidence: result.output.confidence,
        consensus: "single",
        summary: result.output.thesis.slice(0, 2000),
        priceAtRec: snapshot.price ?? 0,
        dataAsOf: new Date(snapshot.asOf),
        payload: {
          snapshot,
          analysis: result,
          debate,
          lens: lensChoice,
        },
      });
    }

    return NextResponse.json({
      ticker,
      snapshot,
      mode: "deep",
      lens: lensChoice,
      analysis: result,
      debate,
      tokensUsed: analystTokens + debateTokens,
      cached: false,
      usage: {
        tier: usage.tier,
        remainingCents: usage.remainingCents,
      },
    });
  } catch (err) {
    log.error("research.standard", "failed", {
      userId: session.user.id,
      ticker,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "standard_failed", message: "Standard research failed." },
      { status: 500 }
    );
  }
}
