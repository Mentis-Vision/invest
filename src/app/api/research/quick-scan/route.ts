import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { generateObject } from "ai";
import { auth } from "@/lib/auth";
import { models } from "@/lib/ai/models";
import {
  QuickScanOutputSchema,
  type QuickScanOutput,
} from "@/lib/ai/schemas";
import { checkRateLimit, RULES, getClientIp } from "@/lib/rate-limit";
import { checkUsageCap, recordUsage, TIER_LIMITS } from "@/lib/usage";
import {
  getStockSnapshot,
  formatWarehouseEnhancedDataBlock,
  getPriceSparkline,
} from "@/lib/data/yahoo";
import { getMacroSnapshot, formatMacroForAI } from "@/lib/data/fred";
import {
  getCachedRecommendation,
  saveCacheableRecommendation,
} from "@/lib/history";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/research/quick-scan
 *
 * The cheapest research product in the Unified-B tier scheme. Single Haiku
 * model, no tool use, no supervisor. Returns a 1-line verdict + 3 signals
 * + 1 primary risk. Target cost: ~$0.004 per scan ($2/1M tokens × ~2k tokens).
 *
 * Use case: triage 30-50 candidates without blowing the AI budget.
 * Contrast with /api/research (Full Panel): 3 models + supervisor + tool use,
 * ~$0.21/run.
 *
 * Same auth + rate-limit + usage-cap shape as /api/research. Usage counts
 * against the user's monthly cost cap just like any other AI spend.
 */
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit — more permissive than full research (the point is scanning
  // lots of tickers fast). 60/hr per user, 30/hr per IP.
  const userRl = await checkRateLimit(
    { ...RULES.researchUser, name: "quick-scan:user", limit: 60 },
    session.user.id
  );
  if (!userRl.ok) {
    return NextResponse.json(
      {
        error: "rate_limit",
        message: "Too many scans. Try again in a bit.",
        retryAfterSec: userRl.retryAfterSec,
      },
      { status: 429, headers: { "Retry-After": String(userRl.retryAfterSec) } }
    );
  }

  const ipRl = await checkRateLimit(
    { ...RULES.researchIp, name: "quick-scan:ip", limit: 30 },
    getClientIp(req)
  );
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: "rate_limit_ip", retryAfterSec: ipRl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(ipRl.retryAfterSec) } }
    );
  }

  // Usage cap — same monthly cost envelope that Full Panel uses. Quick
  // Scans are cheap enough that a user can run thousands per month on a
  // $29 tier without bumping the ceiling.
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
  try {
    const body = await req.json();
    const raw = String(body?.ticker ?? "").toUpperCase().trim();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(raw)) {
      return NextResponse.json(
        { error: "Invalid ticker" },
        { status: 400 }
      );
    }
    ticker = raw;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    // Same-day cache short-circuit. The warehouse only refreshes
    // overnight, so a Quick Scan run earlier today will produce an
    // identical verdict — re-running is just spending tokens.
    // 24h window + mode='quick' filter so the Deep Read cache
    // doesn't accidentally satisfy a Quick Scan request.
    const cached = await getCachedRecommendation(
      session.user.id,
      ticker,
      1440,
      "quick"
    );
    if (cached) {
      const a = cached.analysisJson as {
        snapshot?: Record<string, unknown>;
        output?: Record<string, unknown>;
        priceHistory?: number[];
      };
      const ageMs = Date.now() - cached.createdAt.getTime();
      return NextResponse.json({
        ticker,
        snapshot: a.snapshot,
        priceHistory: a.priceHistory ?? [],
        mode: "quick",
        output: a.output,
        tokensUsed: 0,
        costCents: 0,
        cached: true,
        cachedAt: cached.createdAt.toISOString(),
        cachedAgeSec: Math.floor(ageMs / 1000),
        usage: {
          tier: usage.tier,
          remainingCents: usage.remainingCents,
        },
      });
    }

    // Assemble data block. Same warehouse-enhanced path the Full Panel
    // uses, so Quick Scan sees the same numbers — just asks one model to
    // eyeball it quickly without tool use.
    // priceHistory is for the inline sparkline on the result card; it
    // doesn't go to the model, only the UI.
    const [snapshot, macro, priceHistory] = await Promise.all([
      getStockSnapshot(ticker).catch(() => null),
      getMacroSnapshot().catch(() => []),
      getPriceSparkline(ticker, 30).catch(() => [] as number[]),
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
      formatMacroForAI(macro),
    ].join("\n");

    const prompt = `You are a fast-triage analyst running a Quick Scan on ${ticker}.

${dataBlock}

INSTRUCTIONS:
- Read the data block. One pass. No tool calls.
- Give a one-sentence verdict (BUY/HOLD/SELL/INSUFFICIENT_DATA) with confidence.
- Name up to 3 key signals you based it on.
- Name the single biggest risk to this call.

Rules:
- Cite only what's in the data block. Do not invent numbers.
- When in doubt, HOLD. This is a triage read, not a conviction call.
- If the data is too thin for even a triage view, return INSUFFICIENT_DATA.`;

    const result = await generateObject({
      model: models.haikuSupervisor, // Haiku — cheapest path
      schema: QuickScanOutputSchema,
      prompt,
      // Quick means quick. Cap at 1000 output tokens; if the model needs
      // more it's not a quick read anymore.
      maxOutputTokens: 1000,
    });

    const tokensUsed = result.usage?.totalTokens ?? 0;
    // Fire-and-forget usage recording — same pattern the Full Panel uses.
    void recordUsage(session.user.id, "haiku", tokensUsed);

    const output = result.object as QuickScanOutput;

    // Save for same-day cache. Fire-and-forget — even if the write
    // fails we still serve the live response. The next visit on the
    // same day will hit getCachedRecommendation above.
    void saveCacheableRecommendation({
      userId: session.user.id,
      ticker,
      mode: "quick",
      recommendation: output.recommendation,
      confidence: output.confidence,
      consensus: "single",
      summary: output.oneLiner.slice(0, 2000),
      priceAtRec: snapshot.price ?? 0,
      dataAsOf: new Date(snapshot.asOf),
      payload: { snapshot, output, priceHistory },
    });

    return NextResponse.json({
      ticker,
      snapshot,
      priceHistory,
      mode: "quick",
      output,
      tokensUsed,
      costCents: Math.ceil((tokensUsed / 1_000_000) * 200), // Haiku = 200¢/1M
      cached: false,
      usage: {
        tier: usage.tier,
        remainingCents: usage.remainingCents - Math.ceil((tokensUsed / 1_000_000) * 200),
      },
    });
  } catch (err) {
    log.error("research.quick-scan", "failed", {
      userId: session.user.id,
      ticker,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "quick_scan_failed", message: "Quick scan failed. Try again." },
      { status: 500 }
    );
  }
}
