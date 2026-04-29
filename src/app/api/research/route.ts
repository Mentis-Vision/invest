import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getStockSnapshot,
  formatWarehouseEnhancedDataBlock,
} from "@/lib/data/yahoo";
import { getRecentFilings, formatFilingsForAI } from "@/lib/data/sec";
import { getMacroSnapshot, formatMacroForAI } from "@/lib/data/fred";
import {
  runAnalystPanel,
  runBullBearDebate,
  runSupervisor,
  type ModelResult,
} from "@/lib/ai/consensus";
import {
  checkRateLimit,
  RULES,
  getClientIp,
  sweepStaleBuckets,
} from "@/lib/rate-limit";
import {
  checkUsageCap,
  recordBatchUsage,
  recordUsage,
  TIER_LIMITS,
} from "@/lib/usage";
import { log, errorInfo } from "@/lib/log";
import {
  saveRecommendationAndSchedule,
  getCachedRecommendation,
} from "@/lib/history";
import { getUserProfile, buildProfileRider } from "@/lib/user-profile";
import {
  formatDecisionAction,
  runDecisionEngine,
  type DecisionEngineOutput,
} from "@/lib/decision-engine";

export const maxDuration = 120;

const TICKER_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function formatDecisionEngineOverlayForAI(
  decisionEngine: DecisionEngineOutput
): string {
  const triggered = decisionEngine.riskGates
    .filter((gate) => gate.triggered)
    .map((gate) => `${gate.severity.toUpperCase()}: ${gate.title}`)
    .slice(0, 5);
  const rewardRisk =
    decisionEngine.positionSizing.rewardRiskRatio == null
      ? "Unknown"
      : `${decisionEngine.positionSizing.rewardRiskRatio.toFixed(2)}:1`;
  return [
    "[DECISION ENGINE RISK OVERLAY]",
    `- Trade Quality Score: ${decisionEngine.tradeQualityScore}/100`,
    `- Action: ${decisionEngine.action} (${formatDecisionAction(decisionEngine.action)})`,
    `- Confidence: ${decisionEngine.confidence}`,
    `- Risk Level: ${decisionEngine.riskLevel}`,
    `- Market Regime: ${decisionEngine.marketRegime}`,
    `- Key Risk Gates: ${triggered.length > 0 ? triggered.join("; ") : "None triggered"}`,
    `- Suggested Max Allocation: ${decisionEngine.positionSizing.suggestedMaxPositionPct}%`,
    `- Max Risk Per Trade: ${decisionEngine.positionSizing.maxRiskPerTradePct}%`,
    `- Reward/Risk: ${rewardRisk}`,
    "- Note: This is a deterministic internal risk-control overlay, not an external market fact.",
  ].join("\n");
}

/**
 * Streaming research pipeline.
 *
 * Response is `application/x-ndjson` — one JSON event per line. Client
 * reads incrementally and renders each stage as it lands. Events:
 *
 *   { type: "snapshot",  ticker, snapshot }
 *   { type: "sources",   sources }
 *   { type: "decision_engine", decisionEngine }
 *   { type: "analyst",   analyst: ModelResult }  (×3, in completion order)
 *   { type: "verdict",   supervisor, supervisorModel, recommendationId,
 *                        toolCalls, usage }
 *   { type: "error",     code, message }         (terminal)
 *   { type: "done" }                             (terminal)
 *
 * Backward compat: accept `Accept: application/json` and in that case
 * buffer the events and return the legacy single-shot JSON shape so
 * existing callers (curl tests, history page refetches) keep working.
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ticker?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ticker = body.ticker?.toUpperCase().trim();
  const force = body.force === true;
  if (!ticker || !TICKER_PATTERN.test(ticker)) {
    return NextResponse.json(
      {
        error:
          "Invalid ticker. Use 1–10 uppercase letters, digits, dots, or dashes.",
      },
      { status: 400 }
    );
  }

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

  const ipRl = await checkRateLimit(
    { ...RULES.researchUser, name: "research:ip", limit: 40 },
    ip
  );
  if (!ipRl.ok) {
    log.warn("research", "ip rate limit hit", { ip, ticker });
    return NextResponse.json(
      {
        error: "rate_limit_ip",
        message:
          "Too many research requests from your network. Slow down and try again later.",
        retryAfterSec: ipRl.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(ipRl.retryAfterSec) },
      }
    );
  }

  // Cache short-circuit: if the user just ran this exact ticker in the
  // last 10 minutes and isn't forcing a refresh, replay the stored
  // analysis. Saves the AI pipeline cost entirely (no tokens, no wallet
  // hit) and returns in ~100ms. Rate limits above still apply so this
  // can't be abused as a free endpoint.
  const wantsStream =
    (req.headers.get("accept") ?? "").includes("application/x-ndjson");

  if (!force) {
    const cached = await getCachedRecommendation(userId, ticker, 10);
    if (cached) {
      const a = cached.analysisJson as {
        snapshot?: Record<string, unknown>;
        analyses?: unknown[];
        supervisor?: Record<string, unknown>;
        supervisorModel?: string;
        sources?: Record<string, unknown>;
        decisionEngine?: unknown;
      };
      const ageMs = Date.now() - cached.createdAt.getTime();
      const payload = {
        ticker,
        snapshot: a.snapshot ?? cached.snapshot,
        analyses: a.analyses ?? [],
        supervisor: a.supervisor ?? {},
        supervisorModel: a.supervisorModel ?? null,
        decisionEngine: a.decisionEngine ?? null,
        recommendationId: cached.id,
        toolCalls: 0,
        sources: a.sources ?? {},
        cached: true,
        cachedAt: cached.createdAt.toISOString(),
        cachedAgeSec: Math.floor(ageMs / 1000),
      };

      if (!wantsStream) {
        return NextResponse.json(payload);
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (evt: Record<string, unknown>) =>
            controller.enqueue(encoder.encode(JSON.stringify(evt) + "\n"));
          send({ type: "snapshot", ticker, snapshot: payload.snapshot });
          send({ type: "sources", sources: payload.sources });
          if (payload.decisionEngine) {
            send({
              type: "decision_engine",
              decisionEngine: payload.decisionEngine,
            });
          }
          // Replay each stored analyst as its own event so the UI
          // renders identically to a live run.
          for (const a of payload.analyses as unknown[]) {
            send({ type: "analyst", analyst: a });
          }
          send({ type: "verdict", ...payload });
          send({ type: "done" });
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no",
          "X-Cache": "HIT",
        },
      });
    }
  }

  const cap = await checkUsageCap(userId);
  if (!cap.ok) {
    log.info("research", "usage cap hit", {
      userId,
      reason: cap.reason,
      tier: cap.tier,
    });
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
  // Capture usage-cap fields into locals so TS keeps the narrowing inside
  // the nested runPipeline closure.
  const capOk = {
    tier: cap.tier,
    remainingTokens: cap.remainingTokens,
    remainingCents: cap.remainingCents,
  };

  // (wantsStream is already declared above in the cache short-circuit block.)

  // Buffer for the legacy JSON path: events are still emitted to the
  // same `emit` function, we just collect into memory.
  const bufferedEvents: Record<string, unknown>[] = [];

  // Core pipeline, parameterized by an emit callback so it can either
  // stream live or buffer for JSON return.
  async function runPipeline(
    emit: (evt: Record<string, unknown>) => void
  ): Promise<void> {
    try {
      const [snap, filings, macro, profile] = await Promise.all([
        getStockSnapshot(ticker!),
        getRecentFilings(ticker!, 5),
        getMacroSnapshot(),
        getUserProfile(userId),
      ]);

      emit({ type: "snapshot", ticker, snapshot: snap });
      const sources = {
        yahoo: true,
        sec: filings.length > 0,
        fred: macro.length > 0,
      };
      emit({ type: "sources", sources });

      const decisionEngine = await runDecisionEngine({
        userId,
        ticker: ticker!,
        snapshot: snap,
        macroRaw: macro,
        riskProfileHint: profile.riskTolerance,
      });
      emit({ type: "decision_engine", decisionEngine });

      // Warehouse-enhanced DATA block: pulls valuation/technicals/fundamentals
      // from ticker_market_daily + ticker_fundamentals when populated, falling
      // back to live Yahoo fields when the warehouse hasn't seen the ticker.
      // Each section is tagged [WAREHOUSE] or [LIVE] for prompt-level audit.
      const dataBlock = [
        await formatWarehouseEnhancedDataBlock(snap),
        "",
        formatFilingsForAI(filings),
        "",
        formatMacroForAI(macro),
        "",
        formatDecisionEngineOverlayForAI(decisionEngine),
      ].join("\n");

      const profileRider = buildProfileRider(profile);

      const analyses = await runAnalystPanel(
        ticker!,
        dataBlock,
        profileRider,
        (result: ModelResult) => {
          emit({ type: "analyst", analyst: result });
        }
      );

      // Adversarial debate layer — runs BEFORE the supervisor so the
      // final synthesis incorporates both sides. Two cheap Haiku calls
      // (~$0.012 total). Streamed to the UI as a separate event so the
      // client can render the bull/bear cards before the verdict lands.
      const debate = await runBullBearDebate(
        ticker!,
        dataBlock,
        analyses
      );
      emit({ type: "debate", debate });

      const supervisor = await runSupervisor(
        ticker!,
        dataBlock,
        analyses,
        snap.asOf,
        debate
      );

      // Fire-and-forget usage + persistence (same as before)
      const analystUsage = analyses
        .filter((a) => a.tokensUsed)
        .map((a) => ({ model: a.model, tokens: a.tokensUsed ?? 0 }));
      recordBatchUsage(userId, analystUsage).catch(() => {});
      if (supervisor.tokensUsed > 0) {
        recordUsage(
          userId,
          supervisor.pricingKey,
          supervisor.tokensUsed
        ).catch(() => {});
      }
      // Bull/Bear debate cost — both sides on Haiku.
      const debateTokens = (debate.bullTokens ?? 0) + (debate.bearTokens ?? 0);
      if (debateTokens > 0) {
        recordUsage(userId, "haiku", debateTokens).catch(() => {});
      }

      const recordId = await saveRecommendationAndSchedule({
        userId,
        ticker: ticker!,
        snapshot: snap,
        analyses,
        supervisor: supervisor.output,
        sources,
        supervisorModel: supervisor.supervisorModel,
        debate,
        decisionEngine,
      }).catch((err) => {
        log.error("research", "saveRecommendation failed", {
          userId,
          ticker,
          ...errorInfo(err),
        });
        return null;
      });

      if (Math.random() < 0.01) sweepStaleBuckets();

      const totalToolCalls = analyses.reduce(
        (sum, a) => sum + (a.toolCalls?.length ?? 0),
        0
      );

      emit({
        type: "verdict",
        ticker,
        snapshot: snap,
        analyses,
        debate,
        decisionEngine,
        supervisor: supervisor.output,
        supervisorModel: supervisor.supervisorModel,
        recommendationId: recordId,
        toolCalls: totalToolCalls,
        sources,
        usage: capOk,
      });
      emit({ type: "done" });
    } catch (err) {
      log.error("research", "pipeline failed", {
        userId,
        ticker,
        ...errorInfo(err),
      });
      const msg =
        err instanceof Error && err.message.toLowerCase().includes("fetch")
          ? `Could not fetch data for ${ticker}. Verify the ticker symbol.`
          : "Analysis failed. Please try again.";
      emit({ type: "error", code: "pipeline_failed", message: msg });
    }
  }

  if (!wantsStream) {
    // Legacy JSON — buffer all events, return the final verdict shape.
    await runPipeline((evt) => bufferedEvents.push(evt));
    const errEvt = bufferedEvents.find((e) => e.type === "error");
    if (errEvt) {
      return NextResponse.json(
        { error: errEvt.message ?? "Research failed." },
        { status: 500 }
      );
    }
    const verdict = bufferedEvents.find((e) => e.type === "verdict");
    if (!verdict) {
      return NextResponse.json(
        { error: "No verdict produced." },
        { status: 500 }
      );
    }
    // Strip the envelope `type` field so the shape matches what callers expect.
    const { type: _t, ...rest } = verdict;
    void _t;
    return NextResponse.json(rest);
  }

  // NDJSON stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (evt: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(evt) + "\n"));
        } catch {
          /* already closed */
        }
      };
      await runPipeline(emit);
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
