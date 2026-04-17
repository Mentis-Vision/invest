import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  alphaVantageConfigured,
  getCryptoDaily,
  getCryptoSpot,
} from "../../data/alpha-vantage";

/**
 * Crypto-specific market refresh.
 *
 * Why this exists separately from refreshMarket():
 *   Yahoo Finance's quote API resolves naked crypto symbols (BTC, LINK,
 *   ATOM, SPK) to EQUITY namesakes — Bitgreen, Interlink Electronics,
 *   Atomera, Spark Energy. Real-money users see "BTC closed at $33"
 *   when Bitcoin is at $97,000. That's a worst-class data quality bug.
 *
 *   Alpha Vantage's DIGITAL_CURRENCY_DAILY + CURRENCY_EXCHANGE_RATE
 *   correctly resolve to the actual coin. We route crypto through here
 *   so the warehouse stores accurate values.
 *
 * Pricing strategy per ticker:
 *   1. CURRENCY_EXCHANGE_RATE (lighter, realtime spot) — primary
 *   2. DIGITAL_CURRENCY_DAILY (heavier, historical OHLCV) — fallback +
 *      provides the open/high/low we want in the warehouse row
 *
 * Source of stored row: 'alpha_vantage'
 */

export type CryptoMarketRefreshResult = {
  attempted: number;
  written: number;
  skipped: number;
  failed: Array<{ ticker: string; error: string }>;
  reason?: string;
};

export async function refreshCryptoMarket(
  cryptoTickers: string[]
): Promise<CryptoMarketRefreshResult> {
  const attempted = cryptoTickers.length;
  if (cryptoTickers.length === 0) {
    return { attempted: 0, written: 0, skipped: 0, failed: [] };
  }
  if (!alphaVantageConfigured()) {
    log.warn(
      "warehouse.refresh.crypto",
      "alpha vantage not configured — crypto skipped"
    );
    return {
      attempted,
      written: 0,
      skipped: attempted,
      failed: [],
      reason: "alpha_vantage_not_configured",
    };
  }

  let written = 0;
  let skipped = 0;
  const failed: CryptoMarketRefreshResult["failed"] = [];

  // Sequential by design: AV free tier is 5 req/min, premium varies.
  // Even at premium speed, sequential keeps us off the rate-limit curve
  // for a typical universe of <20 crypto tickers.
  for (const rawTicker of cryptoTickers) {
    const ticker = rawTicker.toUpperCase();
    try {
      // Try the daily series first — it gives us OHLCV for one round trip.
      const daily = await getCryptoDaily(ticker, "USD");
      let close: number | null = daily?.close ?? null;
      let open: number | null = daily?.open ?? null;
      let high: number | null = daily?.high ?? null;
      let low: number | null = daily?.low ?? null;
      // ticker_market_daily.volume is BIGINT — crypto trades fractional
      // units, so AV's DIGITAL_CURRENCY_DAILY returns volume as a
      // decimal. Round to integer; for very high volume coins this loses
      // sub-unit precision which is fine at warehouse granularity.
      let volume: number | null =
        daily?.volume != null ? Math.round(daily.volume) : null;

      // Fall back to spot price if the daily call failed or returned no data.
      if (close == null) {
        const spot = await getCryptoSpot(ticker, "USD");
        close = spot?.price ?? null;
      }

      if (close == null || close <= 0) {
        skipped++;
        log.warn("warehouse.refresh.crypto", "no price returned", { ticker });
        continue;
      }

      // change_pct vs previous close, if we have both
      const changePct =
        open != null && open > 0 ? ((close - open) / open) * 100 : null;

      await pool.query(
        `INSERT INTO "ticker_market_daily"
          (ticker, captured_at, source,
           open, high, low, close, volume, change_pct)
         VALUES ($1, CURRENT_DATE, 'alpha_vantage', $2, $3, $4, $5, $6, $7)
         ON CONFLICT (ticker, captured_at) DO UPDATE SET
           open = EXCLUDED.open,
           high = EXCLUDED.high,
           low = EXCLUDED.low,
           close = EXCLUDED.close,
           volume = EXCLUDED.volume,
           change_pct = EXCLUDED.change_pct,
           source = 'alpha_vantage',
           as_of = NOW()`,
        [ticker, open, high, low, close, volume, changePct]
      );
      written++;
    } catch (err) {
      failed.push({
        ticker,
        error: err instanceof Error ? err.message : "unknown",
      });
      log.warn("warehouse.refresh.crypto", "ticker failed", {
        ticker,
        ...errorInfo(err),
      });
    }
  }

  return { attempted, written, skipped, failed };
}
