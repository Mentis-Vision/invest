import { pool } from "./db";
import { log, errorInfo } from "./log";
import { default as YahooFinanceCtor } from "yahoo-finance2";

const yahooFinance = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

/**
 * Outcome evaluation engine.
 * Called from the daily cron (/api/cron/evaluate-outcomes).
 *
 * Responsibilities:
 * 1. For every `recommendation_outcome` row with status='pending' and
 *    checkAt <= NOW(), fetch today's price for the ticker and compute move.
 * 2. Detect whether the user traded between rec time and check time.
 * 3. Categorize the outcome via `categorize()` and persist.
 *
 * Reads `recommendation.priceAtRec` as baseline. Caches prices in
 * `price_snapshot` keyed by (ticker, CURRENT_DATE).
 */

const THRESHOLD = 3; // percent — below which we call it "flat"

type PendingRow = {
  id: string;
  recommendationId: string;
  ticker: string;
  recommendation: string;
  priceAtRec: string | number;
  userId: string;
  createdAt: Date;
  checkAt: Date;
};

export async function evaluatePendingOutcomes(limit = 200): Promise<{
  evaluated: number;
  skipped: number;
  failed: number;
}> {
  const { rows } = await pool.query(
    `SELECT o.id, o."recommendationId", o."checkAt",
            r.ticker, r.recommendation, r."priceAtRec", r."userId", r."createdAt"
     FROM "recommendation_outcome" o
     JOIN "recommendation" r ON r.id = o."recommendationId"
     WHERE o.status = 'pending' AND o."checkAt" <= NOW()
     ORDER BY o."checkAt" ASC
     LIMIT $1`,
    [limit]
  );

  let evaluated = 0;
  let skipped = 0;
  let failed = 0;

  for (const raw of rows) {
    const row = raw as PendingRow;
    try {
      const currentPrice = await getOrFetchPrice(row.ticker);
      if (currentPrice == null) {
        // Mark as skipped — we couldn't price it today.
        await pool.query(
          `UPDATE "recommendation_outcome"
           SET status = 'skipped', "evaluatedAt" = NOW()
           WHERE id = $1`,
          [row.id]
        );
        skipped++;
        continue;
      }

      const priceAtRec = Number(row.priceAtRec);
      const percentMove =
        priceAtRec > 0 ? ((currentPrice - priceAtRec) / priceAtRec) * 100 : 0;

      // Did the user trade this ticker between rec time and check time?
      const { rows: trades } = await pool.query(
        `SELECT type FROM "trade"
         WHERE "userId" = $1 AND ticker = $2
           AND "executedAt" > $3 AND "executedAt" <= $4
         ORDER BY "executedAt" ASC`,
        [row.userId, row.ticker, row.createdAt, row.checkAt]
      );

      const userActed = trades.length > 0;
      const actionType = trades.find(
        (t: { type: string }) => t.type === "BUY" || t.type === "SELL"
      )?.type;

      const verdict = categorize(row.recommendation, actionType, percentMove);

      await pool.query(
        `UPDATE "recommendation_outcome"
         SET status = 'completed',
             "priceAtCheck" = $1,
             "percentMove" = $2,
             "userActed" = $3,
             verdict = $4,
             "evaluatedAt" = NOW()
         WHERE id = $5`,
        [currentPrice, percentMove, userActed, verdict, row.id]
      );
      evaluated++;
    } catch (err) {
      log.error("outcomes", "evaluation failed", {
        outcomeId: row.id,
        ticker: row.ticker,
        ...errorInfo(err),
      });
      failed++;
    }
  }

  return { evaluated, skipped, failed };
}

/**
 * Returns today's price for `ticker`, using the price_snapshot cache if
 * already fetched today. Writes back to cache on miss.
 */
export async function getOrFetchPrice(ticker: string): Promise<number | null> {
  try {
    const { rows } = await pool.query(
      `SELECT price FROM "price_snapshot"
       WHERE ticker = $1 AND "capturedAt" = CURRENT_DATE
       LIMIT 1`,
      [ticker]
    );
    if (rows.length > 0) return Number(rows[0].price);

    const q = (await yahooFinance.quote(ticker)) as Record<string, unknown>;
    const price = typeof q.regularMarketPrice === "number" ? q.regularMarketPrice : null;
    if (price == null) return null;

    try {
      await pool.query(
        `INSERT INTO "price_snapshot" (ticker, "capturedAt", price, source)
         VALUES ($1, CURRENT_DATE, $2, 'yahoo')
         ON CONFLICT (ticker, "capturedAt") DO NOTHING`,
        [ticker, price]
      );
    } catch {
      /* ignore cache write failures */
    }

    return price;
  } catch (err) {
    log.warn("outcomes", "getOrFetchPrice failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

/**
 * Link recent trades back to their driving recommendations.
 * Runs on the cron. Uses a lookback of 90 days.
 */
export async function linkTradesToRecommendations(): Promise<number> {
  try {
    const res = await pool.query(
      `WITH latest AS (
        SELECT DISTINCT ON (r2."userId", r2.ticker)
          r2.id, r2."userId", r2.ticker, r2.recommendation
        FROM "recommendation" r2
        WHERE r2."createdAt" > NOW() - INTERVAL '90 days'
          AND r2.recommendation IN ('BUY','SELL','HOLD')
        ORDER BY r2."userId", r2.ticker, r2."createdAt" DESC
      )
      UPDATE "trade" t SET
        "recommendationId" = r.id,
        "recommendationAlignment" = CASE
          WHEN (r.recommendation = 'BUY' AND t.type = 'BUY') THEN 'followed'
          WHEN (r.recommendation = 'SELL' AND t.type = 'SELL') THEN 'followed'
          WHEN (r.recommendation = 'HOLD' AND t.type IN ('BUY','SELL')) THEN 'contrary'
          WHEN (r.recommendation = 'BUY' AND t.type = 'SELL') THEN 'contrary'
          WHEN (r.recommendation = 'SELL' AND t.type = 'BUY') THEN 'contrary'
          ELSE 'unrelated'
        END
      FROM latest r
      WHERE t."userId" = r."userId"
        AND t.ticker = r.ticker
        AND t."recommendationId" IS NULL
        AND t."executedAt" > NOW() - INTERVAL '7 days'`
    );
    return res.rowCount ?? 0;
  } catch (err) {
    log.error("outcomes", "linkTrades failed", errorInfo(err));
    return 0;
  }
}

export function categorize(
  rec: string,
  action: string | undefined,
  move: number
): string {
  if (rec === "BUY") {
    if (action === "BUY") {
      return move > THRESHOLD
        ? "followed_win"
        : move < -THRESHOLD
        ? "followed_loss"
        : "followed_flat";
    }
    return move > THRESHOLD
      ? "ignored_win"
      : move < -THRESHOLD
      ? "ignored_bullet"
      : "ignored_flat";
  }
  if (rec === "SELL") {
    if (action === "SELL") {
      return move < -THRESHOLD
        ? "followed_win"
        : move > THRESHOLD
        ? "followed_loss"
        : "followed_flat";
    }
    return move < -THRESHOLD
      ? "ignored_regret"
      : move > THRESHOLD
      ? "ignored_rally"
      : "ignored_flat";
  }
  if (rec === "HOLD") {
    if (action) return move > 0 ? "contrary_regret" : "contrary_win";
    return "hold_confirmed";
  }
  return "unknown";
}
