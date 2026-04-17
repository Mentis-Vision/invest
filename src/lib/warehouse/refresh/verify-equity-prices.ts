import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import { alphaVantageConfigured, getEquityQuote } from "../../data/alpha-vantage";

/**
 * Cross-verify Yahoo equity closing prices against Alpha Vantage's
 * GLOBAL_QUOTE for the same trading day.
 *
 * Why this exists:
 *   Yahoo is our primary equity source — it has the broadest coverage and
 *   gives us OHLCV + valuation in one quoteSummary roundtrip. But Yahoo's
 *   data quality is uneven: stale prices on illiquid names, occasional
 *   wrong-symbol resolution, and the worst-case crypto-namesake bug we
 *   route around in crypto-market.ts.
 *
 *   Verification across two independent sources lets us:
 *     - Surface a "verified across N sources" badge in the ticker drill
 *     - Detect when one source has gone stale (delta > threshold)
 *     - Build trust with users that prices match what they see at their
 *       brokerage
 *
 * How it runs:
 *   - Sequential by design (AV rate limits even on premium tier)
 *   - One GLOBAL_QUOTE call per ticker
 *   - Updates verify_source / verify_close / verify_delta_pct on the row
 *     refreshMarket already wrote earlier in the same cron run
 *   - If AV isn't configured or returns no price, leaves verify_* null
 *     (caller checks IS NOT NULL before showing the badge)
 *
 * Runs in the orchestrator AFTER refreshMarket so the row exists.
 */

export type VerifyEquityPricesResult = {
  attempted: number;
  verified: number;
  missing: number;
  outOfRange: number;
  failed: Array<{ ticker: string; error: string }>;
  reason?: string;
};

/** Anything beyond this delta (%) is logged as a data-quality concern. */
const OUT_OF_RANGE_THRESHOLD_PCT = 5;

export async function verifyEquityPrices(
  equityTickers: string[]
): Promise<VerifyEquityPricesResult> {
  const attempted = equityTickers.length;
  if (attempted === 0) {
    return { attempted: 0, verified: 0, missing: 0, outOfRange: 0, failed: [] };
  }
  if (!alphaVantageConfigured()) {
    return {
      attempted,
      verified: 0,
      missing: 0,
      outOfRange: 0,
      failed: [],
      reason: "alpha_vantage_not_configured",
    };
  }

  let verified = 0;
  let missing = 0;
  let outOfRange = 0;
  const failed: VerifyEquityPricesResult["failed"] = [];

  for (const rawTicker of equityTickers) {
    const ticker = rawTicker.toUpperCase();
    try {
      const av = await getEquityQuote(ticker);
      if (!av || typeof av.price !== "number" || av.price <= 0) {
        missing++;
        continue;
      }

      // Compare to whatever close we wrote in this cron run for today.
      const { rows } = await pool.query(
        `SELECT close FROM "ticker_market_daily"
         WHERE ticker = $1 AND captured_at = CURRENT_DATE`,
        [ticker]
      );
      const yahooClose =
        rows.length > 0 && rows[0].close !== null
          ? Number(rows[0].close)
          : null;

      if (yahooClose === null || yahooClose <= 0) {
        // No Yahoo row to verify against (Yahoo returned null for this
        // ticker earlier). Still record AV's price so the row gains a
        // verify_source — useful as a fallback when Yahoo failed.
        await pool.query(
          `UPDATE "ticker_market_daily"
              SET verify_source = 'alpha_vantage',
                  verify_close = $2,
                  verify_delta_pct = NULL,
                  as_of = NOW()
            WHERE ticker = $1 AND captured_at = CURRENT_DATE`,
          [ticker, av.price]
        );
        missing++;
        continue;
      }

      const deltaPct = ((av.price - yahooClose) / yahooClose) * 100;
      const absDelta = Math.abs(deltaPct);

      await pool.query(
        `UPDATE "ticker_market_daily"
            SET verify_source = 'alpha_vantage',
                verify_close = $2,
                verify_delta_pct = $3,
                as_of = NOW()
          WHERE ticker = $1 AND captured_at = CURRENT_DATE`,
        [ticker, av.price, deltaPct]
      );
      verified++;

      if (absDelta > OUT_OF_RANGE_THRESHOLD_PCT) {
        outOfRange++;
        log.warn("warehouse.verify.equity", "price disagreement", {
          ticker,
          yahooClose,
          alphaVantageClose: av.price,
          deltaPct: Number(deltaPct.toFixed(3)),
        });
      }
    } catch (err) {
      failed.push({
        ticker,
        error: err instanceof Error ? err.message : "unknown",
      });
      log.warn("warehouse.verify.equity", "ticker failed", {
        ticker,
        ...errorInfo(err),
      });
    }
  }

  return { attempted, verified, missing, outOfRange, failed };
}
