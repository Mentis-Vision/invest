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

/**
 * Cap how many tickers we verify per cron run. AV's free tier paces at
 * ~12 s/request via the wrapper throttle, so 12 tickers ≈ 144 s — well
 * inside the 300 s cron budget after Yahoo + crypto + sentiment +
 * fundamentals already ran. Tickers rotate by oldest-verify-first so
 * coverage spreads across days.
 */
const VERIFY_BUDGET_PER_RUN = Number(
  process.env.AV_VERIFY_BUDGET_PER_RUN ?? "12"
);

export async function verifyEquityPrices(
  equityTickers: string[]
): Promise<VerifyEquityPricesResult> {
  if (equityTickers.length === 0) {
    return { attempted: 0, verified: 0, missing: 0, outOfRange: 0, failed: [] };
  }
  if (!alphaVantageConfigured()) {
    return {
      attempted: 0,
      verified: 0,
      missing: 0,
      outOfRange: 0,
      failed: [],
      reason: "alpha_vantage_not_configured",
    };
  }

  // Pick the N tickers most overdue for verification — the ones with
  // the oldest verify_close timestamp (or never verified). Deterministic
  // rotation across days keeps coverage even when the universe is large.
  let queue = equityTickers.map((t) => t.toUpperCase());
  if (queue.length > VERIFY_BUDGET_PER_RUN) {
    try {
      const { rows } = await pool.query(
        `WITH latest AS (
           SELECT DISTINCT ON (ticker) ticker, verify_close, as_of
             FROM "ticker_market_daily"
            WHERE ticker = ANY($1)
            ORDER BY ticker, captured_at DESC
         )
         SELECT ticker FROM latest
          ORDER BY (verify_close IS NULL) DESC, as_of ASC NULLS FIRST
          LIMIT $2`,
        [queue, VERIFY_BUDGET_PER_RUN]
      );
      const ordered = rows.map((r) => String(r.ticker));
      // Append any tickers absent from the warehouse (never been written
      // → no row to ORDER from) so they still get a shot at verification.
      const seen = new Set(ordered);
      for (const t of queue) if (!seen.has(t)) ordered.push(t);
      queue = ordered.slice(0, VERIFY_BUDGET_PER_RUN);
    } catch (err) {
      log.warn("warehouse.verify.equity", "rotation query failed", errorInfo(err));
      queue = queue.slice(0, VERIFY_BUDGET_PER_RUN);
    }
  }

  let verified = 0;
  let missing = 0;
  let outOfRange = 0;
  const failed: VerifyEquityPricesResult["failed"] = [];

  for (const rawTicker of queue) {
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

  return {
    attempted: queue.length,
    verified,
    missing,
    outOfRange,
    failed,
    ...(equityTickers.length > queue.length
      ? {
          reason: `rotated_subset_${queue.length}_of_${equityTickers.length}`,
        }
      : {}),
  };
}
