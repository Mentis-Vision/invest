import { pool } from "./db";
import { log, errorInfo } from "./log";
import type { ModelResult } from "./ai/consensus";
import type { SupervisorOutput } from "./ai/schemas";
import type { StockSnapshot } from "./data/yahoo";

/**
 * Historical tracking for recommendations.
 *
 * Every recommendation gets persisted with the full analysis payload,
 * plus four outcome rows scheduled at 7/30/90/365 days.
 *
 * Failures here must NOT break the research response — wrap calls in
 * try/catch upstream and swallow. The user sees the analysis either way;
 * tracking is a secondary concern.
 */

export type SaveRecommendationInput = {
  userId: string;
  ticker: string;
  snapshot: StockSnapshot;
  analyses: ModelResult[];
  supervisor: SupervisorOutput;
  sources: { yahoo: boolean; sec: boolean; fred: boolean };
  supervisorModel: string;
};

/**
 * Generate a simple UUID-like ID using crypto.randomUUID (available in Node 19+).
 * No external dep needed.
 */
function genId(): string {
  return (
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

const OUTCOME_WINDOWS: Array<{ label: string; days: number }> = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1yr", days: 365 },
];

export async function saveRecommendationAndSchedule(
  input: SaveRecommendationInput
): Promise<string | null> {
  const id = genId();
  const analysisJson = JSON.stringify({
    snapshot: input.snapshot,
    analyses: input.analyses,
    supervisor: input.supervisor,
    supervisorModel: input.supervisorModel,
    sources: input.sources,
  });

  try {
    await pool.query(
      `INSERT INTO "recommendation"
        (id, "userId", ticker, recommendation, confidence, consensus, "priceAtRec", summary, "analysisJson", "dataAsOf")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        id,
        input.userId,
        input.ticker,
        input.supervisor.finalRecommendation,
        input.supervisor.confidence,
        input.supervisor.consensus,
        input.snapshot.price ?? 0,
        input.supervisor.summary.slice(0, 2000),
        analysisJson,
        input.supervisor.dataAsOf,
      ]
    );

    // Cache today's price snapshot (used later for outcome eval)
    if (input.snapshot.price) {
      try {
        await pool.query(
          `INSERT INTO "price_snapshot" (ticker, "capturedAt", price, source)
           VALUES ($1, CURRENT_DATE, $2, 'yahoo')
           ON CONFLICT (ticker, "capturedAt") DO NOTHING`,
          [input.ticker, input.snapshot.price]
        );
      } catch (err) {
        log.warn("history", "price_snapshot cache failed", { ...errorInfo(err) });
      }
    }

    // Only schedule outcomes for actionable recommendations
    if (input.supervisor.finalRecommendation !== "INSUFFICIENT_DATA") {
      const now = new Date();
      const values: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      for (const w of OUTCOME_WINDOWS) {
        const checkAt = new Date(now.getTime() + w.days * 24 * 60 * 60 * 1000);
        values.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
        params.push(genId(), id, checkAt, w.label);
      }
      await pool.query(
        `INSERT INTO "recommendation_outcome" (id, "recommendationId", "checkAt", "window")
         VALUES ${values.join(",")}`,
        params
      );
    }

    return id;
  } catch (err) {
    log.error("history", "saveRecommendation failed", {
      userId: input.userId,
      ticker: input.ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

/**
 * Read the history list for a single user.
 * Returns most recent first. Capped at 200 to keep it UI-friendly.
 */
export type HistoryItem = {
  id: string;
  ticker: string;
  recommendation: string;
  confidence: string;
  consensus: string;
  priceAtRec: number;
  summary: string;
  dataAsOf: string;
  createdAt: string;
  outcomes: Array<{
    window: string;
    status: string;
    priceAtCheck: number | null;
    percentMove: number | null;
    userActed: boolean | null;
    verdict: string | null;
    evaluatedAt: string | null;
  }>;
};

/**
 * Lookup the most recent recommendation for (user, ticker) within a
 * short freshness window. Used by the research route to short-circuit
 * re-runs of the same ticker inside a session — saves the entire AI
 * pipeline + wallet hit on a cache hit.
 *
 * Returns null if no sufficiently-recent rec exists.
 *
 * Design notes:
 *   - Only considers the most recent rec. Older ones in the history
 *     are displayed via getUserHistory but never served as a cache hit.
 *   - INSUFFICIENT_DATA recs are excluded: those are genuinely failed
 *     runs and user might be retrying them on purpose.
 *   - The returned item carries its full analysisJson so the caller
 *     can reconstruct the identical response shape the live pipeline
 *     would have emitted.
 */
export async function getCachedRecommendation(
  userId: string,
  ticker: string,
  maxAgeMinutes = 10
): Promise<{
  id: string;
  ticker: string;
  createdAt: Date;
  analysisJson: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
} | null> {
  try {
    const { rows } = await pool.query(
      `SELECT id, ticker, "createdAt", "analysisJson"
       FROM "recommendation"
       WHERE "userId" = $1
         AND ticker = $2
         AND recommendation <> 'INSUFFICIENT_DATA'
         AND "createdAt" > NOW() - ($3 || ' minutes')::interval
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [userId, ticker, String(maxAgeMinutes)]
    );
    if (rows.length === 0) return null;
    const r = rows[0] as {
      id: string;
      ticker: string;
      createdAt: Date;
      analysisJson: Record<string, unknown>;
    };
    const snapshot =
      (r.analysisJson?.snapshot as Record<string, unknown>) ?? null;
    return {
      id: r.id,
      ticker: r.ticker,
      createdAt: new Date(r.createdAt),
      analysisJson: r.analysisJson,
      snapshot,
    };
  } catch (err) {
    log.warn("history", "cache lookup failed", {
      userId,
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

/**
 * Fetch a single recommendation by id, enforcing user ownership.
 * Returns null if the record doesn't exist OR belongs to a different user
 * (we don't leak the difference — 404 either way at the route level).
 */
export type FullRecommendation = HistoryItem & {
  analysisJson: unknown;
  supervisorModel: string | null;
};

export async function getRecommendationForUser(
  userId: string,
  recommendationId: string
): Promise<FullRecommendation | null> {
  const { rows } = await pool.query(
    `SELECT r.id, r.ticker, r.recommendation, r.confidence, r.consensus,
            r."priceAtRec", r.summary, r."dataAsOf", r."createdAt",
            r."analysisJson",
            COALESCE(json_agg(
              json_build_object(
                'window', o."window",
                'status', o.status,
                'priceAtCheck', o."priceAtCheck",
                'percentMove', o."percentMove",
                'userActed', o."userActed",
                'verdict', o.verdict,
                'evaluatedAt', o."evaluatedAt"
              ) ORDER BY
                CASE o."window"
                  WHEN '7d' THEN 1 WHEN '30d' THEN 2 WHEN '90d' THEN 3 ELSE 4
                END
            ) FILTER (WHERE o.id IS NOT NULL), '[]') AS outcomes
     FROM "recommendation" r
     LEFT JOIN "recommendation_outcome" o ON o."recommendationId" = r.id
     WHERE r."userId" = $1 AND r.id = $2
     GROUP BY r.id
     LIMIT 1`,
    [userId, recommendationId]
  );
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;
  const analysisJson = r.analysisJson as Record<string, unknown> | null;
  const supervisorModel =
    (analysisJson && typeof analysisJson === "object" && "supervisorModel" in analysisJson
      ? (analysisJson.supervisorModel as string)
      : null) ?? null;
  return {
    id: r.id as string,
    ticker: r.ticker as string,
    recommendation: r.recommendation as string,
    confidence: r.confidence as string,
    consensus: r.consensus as string,
    priceAtRec: Number(r.priceAtRec),
    summary: r.summary as string,
    dataAsOf: (r.dataAsOf as Date).toISOString(),
    createdAt: (r.createdAt as Date).toISOString(),
    outcomes: (r.outcomes as HistoryItem["outcomes"]) ?? [],
    analysisJson,
    supervisorModel,
  };
}

export async function getUserHistory(userId: string, limit = 50): Promise<HistoryItem[]> {
  const { rows } = await pool.query(
    `SELECT r.id, r.ticker, r.recommendation, r.confidence, r.consensus,
            r."priceAtRec", r.summary, r."dataAsOf", r."createdAt",
            COALESCE(json_agg(
              json_build_object(
                'window', o."window",
                'status', o.status,
                'priceAtCheck', o."priceAtCheck",
                'percentMove', o."percentMove",
                'userActed', o."userActed",
                'verdict', o.verdict,
                'evaluatedAt', o."evaluatedAt"
              ) ORDER BY
                CASE o."window"
                  WHEN '7d' THEN 1 WHEN '30d' THEN 2 WHEN '90d' THEN 3 ELSE 4
                END
            ) FILTER (WHERE o.id IS NOT NULL), '[]') AS outcomes
     FROM "recommendation" r
     LEFT JOIN "recommendation_outcome" o ON o."recommendationId" = r.id
     WHERE r."userId" = $1
     GROUP BY r.id
     ORDER BY r."createdAt" DESC
     LIMIT $2`,
    [userId, limit]
  );

  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    ticker: r.ticker as string,
    recommendation: r.recommendation as string,
    confidence: r.confidence as string,
    consensus: r.consensus as string,
    priceAtRec: Number(r.priceAtRec),
    summary: r.summary as string,
    dataAsOf: (r.dataAsOf as Date).toISOString(),
    createdAt: (r.createdAt as Date).toISOString(),
    outcomes: (r.outcomes as HistoryItem["outcomes"]) ?? [],
  }));
}

/**
 * Per-ticker past recommendations — used for the "our track record for this ticker" strip.
 */
export async function getTickerTrackRecord(
  userId: string,
  ticker: string,
  limit = 10
): Promise<{
  total: number;
  byRec: Record<string, number>;
  wins30d: number;
  losses30d: number;
  flats30d: number;
}> {
  const { rows } = await pool.query(
    `SELECT r.recommendation,
            (SELECT o.verdict FROM "recommendation_outcome" o
             WHERE o."recommendationId" = r.id AND o."window" = '30d'
             LIMIT 1) AS verdict30d
     FROM "recommendation" r
     WHERE r."userId" = $1 AND r.ticker = $2
     ORDER BY r."createdAt" DESC
     LIMIT $3`,
    [userId, ticker, limit]
  );

  const byRec: Record<string, number> = {};
  let wins = 0, losses = 0, flats = 0;
  for (const r of rows) {
    byRec[r.recommendation] = (byRec[r.recommendation] ?? 0) + 1;
    const v = (r.verdict30d as string | null) ?? "";
    if (v.includes("win")) wins++;
    else if (v.includes("loss") || v.includes("regret")) losses++;
    else if (v.includes("flat") || v.includes("hold_confirmed")) flats++;
  }

  return {
    total: rows.length,
    byRec,
    wins30d: wins,
    losses30d: losses,
    flats30d: flats,
  };
}

/**
 * Aggregate dashboard metrics for a user.
 */
export async function getUserTrackRecord(userId: string, days = 30) {
  const { rows: totals } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE recommendation = 'BUY')::int AS buys,
            COUNT(*) FILTER (WHERE recommendation = 'SELL')::int AS sells,
            COUNT(*) FILTER (WHERE recommendation = 'HOLD')::int AS holds
     FROM "recommendation"
     WHERE "userId" = $1 AND "createdAt" > NOW() - $2::interval`,
    [userId, `${days} days`]
  );

  const { rows: verdicts } = await pool.query(
    `SELECT COUNT(*)::int AS evaluated,
            COUNT(*) FILTER (WHERE verdict LIKE '%win%')::int AS wins,
            COUNT(*) FILTER (WHERE verdict LIKE '%loss%' OR verdict LIKE '%regret%')::int AS losses,
            COUNT(*) FILTER (WHERE verdict LIKE '%flat%')::int AS flats,
            COUNT(*) FILTER (WHERE "userActed" = true)::int AS acted
     FROM "recommendation_outcome" o
     JOIN "recommendation" r ON r.id = o."recommendationId"
     WHERE r."userId" = $1 AND o.status = 'completed'
       AND o."window" IN ('7d','30d')
       AND r."createdAt" > NOW() - $2::interval`,
    [userId, `${days} days`]
  );

  return {
    totals: totals[0] ?? { total: 0, buys: 0, sells: 0, holds: 0 },
    outcomes: verdicts[0] ?? { evaluated: 0, wins: 0, losses: 0, flats: 0, acted: 0 },
  };
}
