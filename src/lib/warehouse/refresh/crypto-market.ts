import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  alphaVantageConfigured,
  getCryptoDaily,
  getCryptoSpot,
} from "../../data/alpha-vantage";
import { getCryptoSpotCoinGecko } from "../../data/coingecko";

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
 * Pricing strategy per ticker (in order):
 *   1. AV DIGITAL_CURRENCY_DAILY  — primary; gives OHLCV
 *   2. AV CURRENCY_EXCHANGE_RATE  — fallback; lighter, just spot
 *   3. CoinGecko /simple/price    — tertiary; covers tokens AV doesn't
 *      list (SPK, HYPE, newer DeFi). Free + key-less.
 *
 * Source of stored row: 'alpha_vantage' or 'coingecko' depending on
 * which step actually returned the price.
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
  // We can still serve crypto via CoinGecko even when AV is missing.
  if (!alphaVantageConfigured()) {
    log.warn(
      "warehouse.refresh.crypto",
      "alpha vantage not configured — relying on CoinGecko for crypto"
    );
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
      let close: number | null = null;
      let open: number | null = null;
      let high: number | null = null;
      let low: number | null = null;
      let volume: number | null = null;
      let source: "alpha_vantage" | "coingecko" = "alpha_vantage";
      let changePct: number | null = null;

      // 1. AV daily — gives OHLCV in one round trip.
      if (alphaVantageConfigured()) {
        const daily = await getCryptoDaily(ticker, "USD");
        if (daily) {
          close = daily.close ?? null;
          open = daily.open ?? null;
          high = daily.high ?? null;
          low = daily.low ?? null;
          // ticker_market_daily.volume is BIGINT — crypto trades
          // fractional units, so DIGITAL_CURRENCY_DAILY returns volume
          // as a decimal. Round to integer; sub-unit precision loss is
          // fine at warehouse granularity.
          volume = daily.volume != null ? Math.round(daily.volume) : null;
        }

        // 2. AV spot — lighter fallback when daily call failed.
        if (close == null) {
          const spot = await getCryptoSpot(ticker, "USD");
          if (spot?.price) close = spot.price;
        }
      }

      // 3. CoinGecko — covers AV-missing tokens (SPK, HYPE, smaller-cap).
      //    Only call when nothing else worked; cheap (key-less) but we
      //    don't want to burn rate limit when AV already answered.
      if (close == null) {
        const cg = await getCryptoSpotCoinGecko(ticker);
        if (cg?.price) {
          close = cg.price;
          source = "coingecko";
          // CG gives us 24h change and 24h volume but not open/high/low.
          // Synthesize open from change so the AI prompt + drill have
          // SOMETHING to anchor on.
          if (cg.change24hPct != null) {
            // close = open * (1 + change/100) → open = close / (1+change/100)
            const ratio = 1 + cg.change24hPct / 100;
            if (ratio > 0) open = close / ratio;
            changePct = cg.change24hPct;
          }
          if (cg.volume24h != null) {
            volume = Math.round(cg.volume24h);
          }
        }
      }

      if (close == null || close <= 0) {
        skipped++;
        log.warn("warehouse.refresh.crypto", "no price from any source", {
          ticker,
        });
        continue;
      }

      // change_pct vs open of today's bar (when we have it from AV daily).
      if (changePct == null && open != null && open > 0) {
        changePct = ((close - open) / open) * 100;
      }

      await pool.query(
        `INSERT INTO "ticker_market_daily"
          (ticker, captured_at, source,
           open, high, low, close, volume, change_pct)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (ticker, captured_at) DO UPDATE SET
           open = EXCLUDED.open,
           high = EXCLUDED.high,
           low = EXCLUDED.low,
           close = EXCLUDED.close,
           volume = EXCLUDED.volume,
           change_pct = EXCLUDED.change_pct,
           source = EXCLUDED.source,
           as_of = NOW()`,
        [ticker, source, open, high, low, close, volume, changePct]
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
