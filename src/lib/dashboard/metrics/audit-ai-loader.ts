// src/lib/dashboard/metrics/audit-ai-loader.ts
//
// Pulls the most-recent N evaluated BUY recommendations from the
// `recommendation` + `recommendation_outcome` tables, joins SPY
// start / end prices from the warehouse, and feeds the math in
// audit-ai.ts.
//
// Per-model attribution is best-effort: we look at the persisted
// `analysisJson.analyses` array (each item carries
// `model: "claude"|"gpt"|"gemini"` and `output.recommendation`).
// Recommendations from before that schema landed will simply lack
// per-lens attribution; the global hit-rate still computes.
//
// PII / privacy:
//   This is a public-facing surface. The underlying SQL aggregates
//   across the entire user base. Caller may pass a `userId` to
//   restrict to a single user's track record (used by the in-app
//   self-audit view); the public marketing-page surface should
//   pass undefined.

import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  computeTrackRecord,
  type OutcomeRecord,
  type TrackRecordResult,
} from "./audit-ai";

const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW_DAYS = 30;

interface JoinedRow {
  recommendationId: string;
  recommendation: string;
  priceAtRec: string | number | null;
  priceAtCheck: string | number | null;
  createdAt: string | Date;
  evaluatedAt: string | Date | null;
  analysisJson: unknown;
  spyStart: string | number | null;
  spyEnd: string | number | null;
}

/**
 * Try to coerce the persisted analysisJson into a Map<lens, rec>.
 * Returns undefined when the shape isn't recognized — caller
 * tolerates absence.
 */
function extractPerLensRecs(
  analysisJson: unknown,
): Partial<Record<"claude" | "gpt" | "gemini", string>> | undefined {
  if (typeof analysisJson !== "object" || analysisJson === null) return undefined;
  const root = analysisJson as Record<string, unknown>;
  const analyses = root.analyses;
  if (!Array.isArray(analyses)) return undefined;
  const out: Partial<Record<"claude" | "gpt" | "gemini", string>> = {};
  for (const entry of analyses) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const model = e.model;
    if (model !== "claude" && model !== "gpt" && model !== "gemini") continue;
    const output = e.output;
    if (typeof output !== "object" || output === null) continue;
    const rec = (output as Record<string, unknown>).recommendation;
    if (typeof rec !== "string") continue;
    out[model] = rec;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface AuditAiOptions {
  /** Restrict to a single user's recs. Undefined = all users (public). */
  userId?: string;
  /** How many most-recent BUYs to consider. Default 100. */
  limit?: number;
  /** Outcome window. Default 30d. */
  windowDays?: number;
}

export async function getAuditAiTrackRecord(
  opts: AuditAiOptions = {},
): Promise<TrackRecordResult | null> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? DEFAULT_LIMIT));
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const windowKey = `${windowDays}d`;

  try {
    const params: Array<string | number> = [windowKey];
    let userClause = "";
    if (opts.userId) {
      params.push(opts.userId);
      userClause = `AND r."userId" = $${params.length}`;
    }
    params.push(limit);
    const limitParam = `$${params.length}`;

    const { rows } = await pool.query<JoinedRow>(
      `SELECT r.id AS "recommendationId",
              r.recommendation AS recommendation,
              r."priceAtRec"::float AS "priceAtRec",
              o."priceAtCheck"::float AS "priceAtCheck",
              r."createdAt" AS "createdAt",
              o."evaluatedAt" AS "evaluatedAt",
              r."analysisJson" AS "analysisJson",
              b_start.close::float AS "spyStart",
              b_end.close::float AS "spyEnd"
         FROM "recommendation" r
         JOIN "recommendation_outcome" o ON o."recommendationId" = r.id
         LEFT JOIN LATERAL (
           SELECT close
             FROM "ticker_market_daily"
            WHERE ticker = 'SPY'
              AND captured_at <= r."createdAt"::date
              AND close IS NOT NULL
            ORDER BY captured_at DESC
            LIMIT 1
         ) b_start ON TRUE
         LEFT JOIN LATERAL (
           SELECT close
             FROM "ticker_market_daily"
            WHERE ticker = 'SPY'
              AND captured_at <= COALESCE(o."evaluatedAt", NOW())::date
              AND close IS NOT NULL
            ORDER BY captured_at DESC
            LIMIT 1
         ) b_end ON TRUE
        WHERE r.recommendation = 'BUY'
          AND o.status = 'completed'
          AND o."window" = $1
          AND r."priceAtRec" > 0
          AND o."priceAtCheck" IS NOT NULL
          ${userClause}
        ORDER BY r."createdAt" DESC
        LIMIT ${limitParam}`,
      params,
    );

    const records: OutcomeRecord[] = rows.map((row) => ({
      recommendationId: row.recommendationId,
      recommendation: row.recommendation,
      priceAtRec: Number(row.priceAtRec),
      priceAtCheck: row.priceAtCheck === null ? null : Number(row.priceAtCheck),
      spyStart: row.spyStart === null ? null : Number(row.spyStart),
      spyEnd: row.spyEnd === null ? null : Number(row.spyEnd),
      perLensRecs: extractPerLensRecs(row.analysisJson),
    }));

    return computeTrackRecord({ outcomes: records, limit, windowDays });
  } catch (err) {
    log.warn("dashboard.audit-ai", "getAuditAiTrackRecord failed", {
      ...errorInfo(err),
      userId: opts.userId,
    });
    return null;
  }
}
