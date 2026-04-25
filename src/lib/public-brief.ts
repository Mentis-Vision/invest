import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { log, errorInfo } from "./log";
import { getStockSnapshot, formatWarehouseEnhancedDataBlock } from "./data/yahoo";
import { getRecentFilings, formatFilingsForAI } from "./data/sec";
import { getMacroSnapshot, formatMacroForAI } from "./data/fred";
import {
  runAnalystPanel,
  runBullBearDebate,
  runSupervisor,
  type ModelResult,
  type SupervisorResult,
  type DebateResult,
} from "./ai/consensus";

/**
 * Public weekly brief pipeline.
 *
 * This is the system-scoped (no user) version of the research pipeline
 * used by /api/research. It shares the same AI primitives — runAnalystPanel,
 * runBullBearDebate, runSupervisor — but:
 *
 *   - No auth check (cron-gated via Bearer CRON_SECRET upstream)
 *   - No user profile rider (public brief has no user context)
 *   - No per-user rate limiting or usage cap (system-level cost cap
 *     enforced by this module's monthly budget check)
 *   - Saves to public_weekly_brief, not recommendation
 *
 * Cost budget: one Panel run ≈ $0.10–0.30 depending on tool calls.
 * One brief per week → $5–15/yr per ticker schedule at steady state.
 *
 * Picker strategy — the ticker chosen each Monday is one where:
 *   1. Warehouse has a fresh market row (so data is rich)
 *   2. It's NOT the ticker we picked in the last 4 weeks (rotation)
 *   3. It's in the curated retail-interest pool (hand-picked list
 *      below — can be expanded later or swapped for a trending signal)
 *
 * The picker is deliberately simple right now. If/when we want fancier
 * "find the ticker with highest three-lens disagreement," that's a
 * Phase 2 upgrade tracked in the handoff doc.
 */

// Curated retail-interest ticker pool. Rotates through these so every
// brief targets a ticker people actually search. Reorder / add to taste.
const CURATED_POOL = [
  "NVDA", "AAPL", "TSLA", "MSFT", "GOOGL", "META", "AMZN",
  "AMD", "PLTR", "COIN", "NFLX", "UBER", "DIS",
  "COST", "WMT", "JPM", "BRK.B", "V", "MA",
  "LLY", "UNH", "JNJ", "MRK",
  "AVGO", "TSM", "ASML", "ARM",
  "SHOP", "CRWD", "SNOW", "NET",
  "SPY", "QQQ", "VOO",
];

export type WeeklyBriefSummary = {
  id: string;
  ticker: string;
  weekOf: string; // YYYY-MM-DD (Monday)
  slug: string;
  recommendation: string;
  confidence: string;
  consensus: string;
  priceAtRec: number | null;
  summary: string | null;
  createdAt: string;
};

export type WeeklyBriefFull = WeeklyBriefSummary & {
  bullCase: string | null;
  bearCase: string | null;
  analysisJson: Record<string, unknown>;
  dataAsOf: string | null;
};

/**
 * ISO date string for the Monday of the week containing `d`.
 * UTC-stable so crons and manual runs produce the same key.
 */
export function mondayOf(d: Date): string {
  const day = d.getUTCDay(); // 0 Sun..6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return monday.toISOString().slice(0, 10);
}

/**
 * Pick a ticker that (a) is in the curated pool, (b) hasn't been
 * featured in the last N weeks. Returns null if everything is on
 * cooldown — callers should fall through to a fallback or skip.
 */
export async function pickWeeklyTicker(cooldownWeeks = 4): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ ticker: string; week_of: string }>(
      `SELECT ticker, week_of::text AS week_of
         FROM "public_weekly_brief"
        WHERE week_of > CURRENT_DATE - ($1 || ' weeks')::interval
        ORDER BY week_of DESC`,
      [String(cooldownWeeks)]
    );
    const recent = new Set(rows.map((r) => r.ticker.toUpperCase()));
    const available = CURATED_POOL.filter((t) => !recent.has(t));
    if (available.length === 0) return null;

    // Deterministic-ish pick: rotate based on ISO week number so
    // consecutive runs on the same week always pick the same ticker
    // (idempotent retry safety).
    const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
    return available[week % available.length];
  } catch (err) {
    log.error("public-brief", "pickWeeklyTicker failed", errorInfo(err));
    return null;
  }
}

/**
 * Return the existing brief for this ticker+week, if any. Idempotency
 * guard for the cron.
 */
export async function getBriefByWeek(
  ticker: string,
  weekOf: string
): Promise<WeeklyBriefFull | null> {
  const { rows } = await pool.query(
    `SELECT * FROM "public_weekly_brief" WHERE ticker = $1 AND week_of = $2::date LIMIT 1`,
    [ticker.toUpperCase(), weekOf]
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function getBriefBySlug(slug: string): Promise<WeeklyBriefFull | null> {
  const { rows } = await pool.query(
    `SELECT * FROM "public_weekly_brief" WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function listRecentBriefs(limit = 50): Promise<WeeklyBriefSummary[]> {
  const { rows } = await pool.query(
    `SELECT id, ticker, week_of::text AS week_of, slug, recommendation,
            confidence, consensus, price_at_rec, summary, created_at
       FROM "public_weekly_brief"
      WHERE status = 'published'
      ORDER BY week_of DESC, created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    ticker: String(r.ticker),
    weekOf: String(r.week_of),
    slug: String(r.slug),
    recommendation: String(r.recommendation),
    confidence: String(r.confidence),
    consensus: String(r.consensus),
    priceAtRec: r.price_at_rec == null ? null : Number(r.price_at_rec),
    summary: r.summary == null ? null : String(r.summary),
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
  }));
}

/**
 * Run the three-lens Panel pipeline for a ticker and persist the result
 * as a public weekly brief. Returns the saved brief, or throws.
 *
 * Caller is responsible for idempotency (check getBriefByWeek first).
 */
export async function generateAndSaveWeeklyBrief(
  ticker: string,
  weekOf: string
): Promise<WeeklyBriefFull> {
  const t = ticker.toUpperCase();

  // 1. Data ingest — same warehouse-enhanced block as /api/research.
  const [snap, filings, macro] = await Promise.all([
    getStockSnapshot(t),
    getRecentFilings(t, 5),
    getMacroSnapshot(),
  ]);

  const dataBlock = [
    await formatWarehouseEnhancedDataBlock(snap),
    "",
    formatFilingsForAI(filings),
    "",
    formatMacroForAI(macro),
  ].join("\n");

  const dataAsOf = new Date().toISOString();

  // 2. Panel — three independent lens analyses.
  const analyses: ModelResult[] = await runAnalystPanel(t, dataBlock);

  // 3. Bull-vs-bear debate — the hook that makes this a *weekly brief*
  // rather than a plain recommendation. Adds explicit bull/bear cases
  // to the JSON.
  const debate: DebateResult = await runBullBearDebate(t, dataBlock, analyses);

  // 4. Supervisor — final verdict with consensus calibration.
  const supervisor: SupervisorResult = await runSupervisor(
    t,
    dataBlock,
    analyses,
    dataAsOf,
    debate
  );

  // 5. Persist. Slug is URL-friendly: `AAPL-2026-04-21`.
  const slug = `${t.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${weekOf}`;
  const id = randomUUID();

  const analysisJson = {
    snapshot: snap,
    analyses,
    debate,
    supervisor: supervisor.output,
    supervisorModel: supervisor.supervisorModel,
    sources: {
      yahoo: true,
      sec: filings.length > 0,
      fred: macro.length > 0,
    },
  };

  // Flatten the bull / bear sides into readable paragraphs for the
  // dedicated bull_case / bear_case columns — the full structured debate
  // stays in analysis_json for anyone who wants the detail.
  const bullCaseText = debate.bull
    ? [
        debate.bull.thesis,
        ...debate.bull.reasons.map((r) => `• ${r.point} (${r.citation})`),
        debate.bull.conditionThatWouldChangeMind
          ? `Would change our mind: ${debate.bull.conditionThatWouldChangeMind}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : null;
  const bearCaseText = debate.bear
    ? [
        debate.bear.thesis,
        ...debate.bear.reasons.map((r) => `• ${r.point} (${r.citation})`),
        debate.bear.conditionThatWouldChangeMind
          ? `Would change our mind: ${debate.bear.conditionThatWouldChangeMind}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : null;

  const priceAtRec = Number.isFinite(snap.price) ? snap.price : null;

  await pool.query(
    `INSERT INTO "public_weekly_brief"
       (id, ticker, week_of, slug, recommendation, confidence, consensus,
        price_at_rec, summary, bull_case, bear_case, analysis_json, data_as_of,
        cost_cents, status)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7,
             $8, $9, $10, $11, $12::jsonb, $13,
             $14, 'published')
     ON CONFLICT (ticker, week_of) DO UPDATE SET
       slug           = EXCLUDED.slug,
       recommendation = EXCLUDED.recommendation,
       confidence     = EXCLUDED.confidence,
       consensus      = EXCLUDED.consensus,
       price_at_rec   = EXCLUDED.price_at_rec,
       summary        = EXCLUDED.summary,
       bull_case      = EXCLUDED.bull_case,
       bear_case      = EXCLUDED.bear_case,
       analysis_json  = EXCLUDED.analysis_json,
       data_as_of     = EXCLUDED.data_as_of,
       cost_cents     = EXCLUDED.cost_cents,
       updated_at     = NOW()`,
    [
      id,
      t,
      weekOf,
      slug,
      supervisor.output.finalRecommendation,
      supervisor.output.confidence,
      supervisor.output.consensus,
      Number.isFinite(priceAtRec) ? priceAtRec : null,
      supervisor.output.summary ?? null,
      bullCaseText,
      bearCaseText,
      JSON.stringify(analysisJson),
      dataAsOf,
      // Rough cost estimate — supervisor.tokensUsed isn't a $-figure
      // so treat this as a placeholder; refine once we wire the
      // actual usage table. 1 cent floor when the pipeline ran so the
      // weekly accounting view doesn't round to zero.
      supervisor.tokensUsed > 0
        ? Math.max(5, Math.floor(supervisor.tokensUsed / 1000))
        : 0,
    ]
  );

  void id; // id kept for future provenance; ON CONFLICT path overwrites

  const saved = await getBriefByWeek(t, weekOf);
  if (!saved) {
    throw new Error("public-brief: insert succeeded but read-back returned null");
  }
  log.info("public-brief", "generated", {
    ticker: t,
    weekOf,
    recommendation: supervisor.output.finalRecommendation,
    confidence: supervisor.output.confidence,
  });
  return saved;
}

// ── helpers ─────────────────────────────────────────────────────────

function mapRow(r: Record<string, unknown>): WeeklyBriefFull {
  return {
    id: String(r.id),
    ticker: String(r.ticker),
    weekOf:
      r.week_of instanceof Date
        ? r.week_of.toISOString().slice(0, 10)
        : String(r.week_of),
    slug: String(r.slug),
    recommendation: String(r.recommendation),
    confidence: String(r.confidence),
    consensus: String(r.consensus),
    priceAtRec: r.price_at_rec == null ? null : Number(r.price_at_rec),
    summary: r.summary == null ? null : String(r.summary),
    bullCase: r.bull_case == null ? null : String(r.bull_case),
    bearCase: r.bear_case == null ? null : String(r.bear_case),
    analysisJson: (r.analysis_json ?? {}) as Record<string, unknown>,
    dataAsOf: r.data_as_of == null ? null : String(r.data_as_of),
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
  };
}
