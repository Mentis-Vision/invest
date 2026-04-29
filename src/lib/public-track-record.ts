import { pool } from "./db";
import { log, errorInfo } from "./log";

/**
 * Public, system-wide track-record aggregates.
 *
 * Returns counts + hit-rate stats across ALL users in a given window.
 * Zero PII: no userId, no ticker-level detail, no individual briefs.
 * Only aggregate integers and percentages — safe for the unauthenticated
 * /track-record marketing page.
 *
 * The `recommendation_outcome` table is populated by the nightly
 * /api/cron/evaluate-outcomes job, which marks outcomes by window
 * (7d / 30d / 90d / 365d). We surface 30d here as the default because
 * it's the shortest window that survives noise.
 */

export type PublicTrackRecord = {
  /** Total briefs issued in the window. */
  totalBriefs: number;
  /** Recommendation-type breakdown. */
  byCall: { buy: number; hold: number; sell: number };
  /** Outcomes evaluated — only counts closed 30d windows. */
  evaluated: number;
  /** Hit-rate percentages (nullable if `evaluated === 0`). */
  hitRate: {
    overall: number | null;
    buy: number | null;
    sell: number | null;
    hold: number | null;
  };
  /** Distribution of wins/losses/flats. */
  outcomes: { wins: number; losses: number; flats: number };
  /** Confidence calibration — does HIGH outperform LOW? */
  byConfidence: {
    high: { evaluated: number; winRate: number | null };
    medium: { evaluated: number; winRate: number | null };
    low: { evaluated: number; winRate: number | null };
  };
  benchmark?: {
    benchmarkTicker: "SPY";
    evaluated: number;
    averageAlphaPct: number | null;
    note: string;
  };
  /** Window in days for all figures. */
  windowDays: number;
  /** As-of ISO timestamp for the snapshot. */
  asOf: string;
};

const EMPTY: PublicTrackRecord = {
  totalBriefs: 0,
  byCall: { buy: 0, hold: 0, sell: 0 },
  evaluated: 0,
  hitRate: { overall: null, buy: null, sell: null, hold: null },
  outcomes: { wins: 0, losses: 0, flats: 0 },
  byConfidence: {
    high: { evaluated: 0, winRate: null },
    medium: { evaluated: 0, winRate: null },
    low: { evaluated: 0, winRate: null },
  },
  benchmark: {
    benchmarkTicker: "SPY",
    evaluated: 0,
    averageAlphaPct: null,
    note: "SPY benchmark data unavailable; alpha was not calculated.",
  },
  windowDays: 30,
  asOf: new Date().toISOString(),
};

export async function getPublicTrackRecord(
  days = 30
): Promise<PublicTrackRecord> {
  try {
    const [totals, outcomes, byConf, benchmark] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE recommendation = 'BUY')::int  AS buys,
                COUNT(*) FILTER (WHERE recommendation = 'SELL')::int AS sells,
                COUNT(*) FILTER (WHERE recommendation = 'HOLD')::int AS holds
           FROM "recommendation"
          WHERE "createdAt" > NOW() - $1::interval`,
        [`${days} days`]
      ),
      pool.query(
        `SELECT
            COUNT(*)::int AS evaluated,
            COUNT(*) FILTER (WHERE verdict LIKE '%win%')::int AS wins,
            COUNT(*) FILTER (WHERE verdict LIKE '%loss%' OR verdict LIKE '%regret%')::int AS losses,
            COUNT(*) FILTER (WHERE verdict LIKE '%flat%')::int AS flats,
            COUNT(*) FILTER (WHERE verdict LIKE '%win%' AND r.recommendation = 'BUY')::int  AS buy_wins,
            COUNT(*) FILTER (WHERE r.recommendation = 'BUY')::int                             AS buy_total,
            COUNT(*) FILTER (WHERE verdict LIKE '%win%' AND r.recommendation = 'SELL')::int AS sell_wins,
            COUNT(*) FILTER (WHERE r.recommendation = 'SELL')::int                            AS sell_total,
            COUNT(*) FILTER (WHERE verdict LIKE '%win%' AND r.recommendation = 'HOLD')::int AS hold_wins,
            COUNT(*) FILTER (WHERE r.recommendation = 'HOLD')::int                            AS hold_total
           FROM "recommendation_outcome" o
           JOIN "recommendation" r ON r.id = o."recommendationId"
          WHERE o.status = 'completed'
            AND o."window" = '30d'
            AND r."createdAt" > NOW() - $1::interval`,
        [`${days} days`]
      ),
      pool.query(
        `SELECT
            r.confidence AS confidence,
            COUNT(*)::int AS evaluated,
            COUNT(*) FILTER (WHERE o.verdict LIKE '%win%')::int AS wins
           FROM "recommendation_outcome" o
           JOIN "recommendation" r ON r.id = o."recommendationId"
          WHERE o.status = 'completed'
            AND o."window" = '30d'
            AND r."createdAt" > NOW() - $1::interval
          GROUP BY r.confidence`,
        [`${days} days`]
      ),
      pool.query(
        `WITH evaluated AS (
           SELECT r."createdAt",
                  r."priceAtRec"::float AS start_price,
                  o."priceAtCheck"::float AS end_price,
                  o."evaluatedAt"
             FROM "recommendation_outcome" o
             JOIN "recommendation" r ON r.id = o."recommendationId"
            WHERE o.status = 'completed'
              AND o."window" = '30d'
              AND r."priceAtRec" > 0
              AND o."priceAtCheck" IS NOT NULL
              AND r."createdAt" > NOW() - $1::interval
         )
         SELECT COUNT(*) FILTER (
                  WHERE b_start.close IS NOT NULL
                    AND b_end.close IS NOT NULL
                    AND b_start.close > 0
                )::int AS evaluated,
                AVG(
                  ((e.end_price - e.start_price) / e.start_price * 100)
                  -
                  ((b_end.close - b_start.close) / b_start.close * 100)
                ) FILTER (
                  WHERE b_start.close IS NOT NULL
                    AND b_end.close IS NOT NULL
                    AND b_start.close > 0
                )::numeric(10,2) AS average_alpha_pct
           FROM evaluated e
           LEFT JOIN LATERAL (
             SELECT close
               FROM "ticker_market_daily"
              WHERE ticker = 'SPY'
                AND captured_at <= e."createdAt"::date
                AND close IS NOT NULL
              ORDER BY captured_at DESC
              LIMIT 1
           ) b_start ON TRUE
           LEFT JOIN LATERAL (
             SELECT close
               FROM "ticker_market_daily"
              WHERE ticker = 'SPY'
                AND captured_at <= COALESCE(e."evaluatedAt", NOW())::date
                AND close IS NOT NULL
              ORDER BY captured_at DESC
              LIMIT 1
           ) b_end ON TRUE`,
        [`${days} days`]
      ),
    ]);

    const t = totals.rows[0] ?? { total: 0, buys: 0, sells: 0, holds: 0 };
    const o = outcomes.rows[0] ?? {
      evaluated: 0,
      wins: 0,
      losses: 0,
      flats: 0,
      buy_wins: 0,
      buy_total: 0,
      sell_wins: 0,
      sell_total: 0,
      hold_wins: 0,
      hold_total: 0,
    };

    const pct = (n: number, d: number): number | null =>
      d > 0 ? Math.round((n / d) * 1000) / 10 : null;

    const confMap = new Map<string, { evaluated: number; wins: number }>();
    for (const row of byConf.rows as Array<{
      confidence: string | null;
      evaluated: number;
      wins: number;
    }>) {
      const key = (row.confidence ?? "").toUpperCase();
      confMap.set(key, { evaluated: row.evaluated, wins: row.wins });
    }
    const confBucket = (key: "HIGH" | "MEDIUM" | "LOW") => {
      const r = confMap.get(key) ?? { evaluated: 0, wins: 0 };
      return { evaluated: r.evaluated, winRate: pct(r.wins, r.evaluated) };
    };
    const benchRow = benchmark.rows[0] as
      | { evaluated: number; average_alpha_pct: string | number | null }
      | undefined;
    const benchmarkEvaluated = Number(benchRow?.evaluated ?? 0);
    const averageAlphaPct =
      benchRow?.average_alpha_pct == null
        ? null
        : Number(benchRow.average_alpha_pct);

    return {
      totalBriefs: t.total,
      byCall: { buy: t.buys, hold: t.holds, sell: t.sells },
      evaluated: o.evaluated,
      hitRate: {
        overall: pct(o.wins, o.evaluated),
        buy: pct(o.buy_wins, o.buy_total),
        sell: pct(o.sell_wins, o.sell_total),
        hold: pct(o.hold_wins, o.hold_total),
      },
      outcomes: { wins: o.wins, losses: o.losses, flats: o.flats },
      byConfidence: {
        high: confBucket("HIGH"),
        medium: confBucket("MEDIUM"),
        low: confBucket("LOW"),
      },
      benchmark: {
        benchmarkTicker: "SPY",
        evaluated: benchmarkEvaluated,
        averageAlphaPct:
          benchmarkEvaluated > 0 && Number.isFinite(averageAlphaPct)
            ? averageAlphaPct
            : null,
        note:
          benchmarkEvaluated > 0
            ? "Average alpha versus SPY is retrospective and informational only."
            : "SPY benchmark data unavailable for evaluated rows; alpha was not calculated.",
      },
      windowDays: days,
      asOf: new Date().toISOString(),
    };
  } catch (err) {
    log.warn("public-track-record", "query failed", errorInfo(err));
    return { ...EMPTY, windowDays: days };
  }
}
