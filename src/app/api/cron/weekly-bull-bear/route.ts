import { NextRequest, NextResponse } from "next/server";
import { log, errorInfo } from "@/lib/log";
import {
  generateAndSaveWeeklyBrief,
  getBriefByWeek,
  mondayOf,
  pickWeeklyTicker,
} from "@/lib/public-brief";
import { scheduleBriefOutcomes } from "@/lib/public-brief-outcomes";

/**
 * Weekly bull-vs-bear brief generator.
 *
 * Schedule: Mondays 10:00 UTC (6am ET) — registered in vercel.json.
 * Picks a ticker from the curated pool, runs the full three-lens Panel
 * pipeline (including bull/bear debate), persists to public_weekly_brief.
 *
 * Protected by CRON_SECRET Bearer token — same pattern as the existing
 * crons (evaluate-outcomes, warehouse-retention, etc.). Manual triggers
 * during development: hit this route with the correct Bearer header.
 *
 * Idempotency: the picker rotates against the last 4 weeks of picks,
 * and persistence uses ON CONFLICT (ticker, week_of). Running this
 * twice in the same week is a no-op on the second call.
 *
 * Cost: one Panel run ≈ $0.10–0.30 (three analysts + bull/bear debate +
 * supervisor). Weekly cadence → $5–15/yr steady state.
 *
 * Query overrides for ops:
 *   ?ticker=AAPL   — force a specific ticker (still respects week)
 *   ?week=2026-04-21 — force a specific Monday (ISO date, must be a Monday)
 *   ?force=1       — overwrite an existing brief for the same week
 */

// Panel + debate + supervisor can run long — 2 min buffer.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Bearer-token auth — same guard as every other cron in this app.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron.weekly-bull-bear", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const authz = req.headers.get("authorization");
  if (authz !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const tickerOverride = url.searchParams.get("ticker")?.toUpperCase().trim();
  const weekOverride = url.searchParams.get("week");
  const force = url.searchParams.get("force") === "1";

  const weekOf = weekOverride ?? mondayOf(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) {
    return NextResponse.json(
      { error: "invalid_week", message: "Pass week=YYYY-MM-DD (Monday)." },
      { status: 400 }
    );
  }

  const started = Date.now();
  try {
    const ticker = tickerOverride ?? (await pickWeeklyTicker(4));
    if (!ticker) {
      log.warn("cron.weekly-bull-bear", "no available ticker (all on cooldown)");
      return NextResponse.json({
        skipped: "no_available_ticker",
        weekOf,
        tookMs: Date.now() - started,
      });
    }

    // Idempotency guard — skip if we already have this ticker+week
    // unless the caller explicitly asked to force a regeneration.
    const existing = await getBriefByWeek(ticker, weekOf);
    if (existing && !force) {
      log.info("cron.weekly-bull-bear", "already generated", {
        ticker,
        weekOf,
        slug: existing.slug,
      });
      return NextResponse.json({
        status: "already_exists",
        ticker,
        weekOf,
        slug: existing.slug,
        url: `/research/${existing.slug}`,
        tookMs: Date.now() - started,
      });
    }

    const brief = await generateAndSaveWeeklyBrief(ticker, weekOf);

    // Fire-and-forget outcome scheduling — insert the four pending
    // (7d/30d/90d/365d) rows that the daily evaluate-outcomes cron
    // will settle later. MUST NOT fail the brief: a scheduling error
    // downgrades to a warn.
    await scheduleBriefOutcomes(brief.id).catch((e) => {
      log.warn("cron.weekly-bull-bear", "scheduleBriefOutcomes failed", {
        briefId: brief.id,
        ticker: brief.ticker,
        ...errorInfo(e),
      });
    });

    log.info("cron.weekly-bull-bear", "completed", {
      ticker: brief.ticker,
      weekOf: brief.weekOf,
      recommendation: brief.recommendation,
      confidence: brief.confidence,
      tookMs: Date.now() - started,
    });

    return NextResponse.json({
      status: "generated",
      ticker: brief.ticker,
      weekOf: brief.weekOf,
      slug: brief.slug,
      url: `/research/${brief.slug}`,
      recommendation: brief.recommendation,
      confidence: brief.confidence,
      consensus: brief.consensus,
      tookMs: Date.now() - started,
    });
  } catch (err) {
    log.error("cron.weekly-bull-bear", "failed", {
      weekOf,
      ...errorInfo(err),
      tookMs: Date.now() - started,
    });
    return NextResponse.json(
      {
        error: "generation_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
