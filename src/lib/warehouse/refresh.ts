import { getClassifiedUniverse } from "./universe";
import { refreshMarket } from "./refresh/market";
import { refreshCryptoMarket } from "./refresh/crypto-market";
import { verifyEquityPrices } from "./refresh/verify-equity-prices";
import { refreshFundamentals } from "./refresh/fundamentals";
import { refreshEvents } from "./refresh/events";
import { refreshSentiment } from "./refresh/sentiment";
import { refreshAggregates } from "./refresh/aggregate";
import { refreshDossiers } from "./refresh/dossier";

export type WarehouseRefreshResult = {
  universeSize: number;
  market: Awaited<ReturnType<typeof refreshMarket>>;
  cryptoMarket: Awaited<ReturnType<typeof refreshCryptoMarket>>;
  verify: Awaited<ReturnType<typeof verifyEquityPrices>>;
  fundamentals: Awaited<ReturnType<typeof refreshFundamentals>>;
  events: Awaited<ReturnType<typeof refreshEvents>>;
  sentiment: Awaited<ReturnType<typeof refreshSentiment>>;
  aggregates: Awaited<ReturnType<typeof refreshAggregates>>;
  dossiers: Awaited<ReturnType<typeof refreshDossiers>>;
};

/**
 * Top-level warehouse refresh. The only caller is the nightly cron.
 *
 * Steps run sequentially (not parallel) so we don't slam Yahoo with
 * 4 cron steps × 4 workers = 16 concurrent requests. Each step has
 * its own internal concurrency cap.
 *
 * Routing:
 *   - equity / etf / other → Yahoo (refreshMarket)
 *   - crypto              → Alpha Vantage (refreshCryptoMarket)
 *
 *   Yahoo's quote() resolves naked crypto symbols (BTC, LINK, ATOM, SPK)
 *   to equity namesakes (Bitgreen, Interlink, Atomera, Spark Energy).
 *   That's the bug we're fixing — crypto must go through AV's
 *   DIGITAL_CURRENCY endpoints. Splitting the universe up-front means
 *   Yahoo never sees a crypto ticker.
 *
 *   The downstream tables (fundamentals, events, sentiment) still see
 *   the full universe; their Yahoo calls fail for crypto, which they
 *   already tolerate as a `null` result.
 */
export async function refreshWarehouse(): Promise<WarehouseRefreshResult> {
  const classified = await getClassifiedUniverse();
  const cryptoTickers = classified
    .filter((t) => t.assetClass === "crypto")
    .map((t) => t.ticker);
  const nonCryptoTickers = classified
    .filter((t) => t.assetClass !== "crypto")
    .map((t) => t.ticker);
  const fullUniverse = classified.map((t) => t.ticker);

  // Equity / ETF path — Yahoo
  const market = await refreshMarket(nonCryptoTickers);
  // Crypto path — Alpha Vantage (DIGITAL_CURRENCY_DAILY + CURRENCY_EXCHANGE_RATE)
  const cryptoMarket = await refreshCryptoMarket(cryptoTickers);
  // Cross-verify Yahoo equity closes vs Alpha Vantage GLOBAL_QUOTE.
  // Updates the rows refreshMarket() just wrote with verify_source +
  // verify_close + verify_delta_pct so the UI can show a "verified
  // across N sources" badge and we can detect data-quality drift.
  const verify = await verifyEquityPrices(nonCryptoTickers);

  // Fundamentals / events / sentiment still get the full universe; the
  // crypto rows will largely be misses (no fundamentals on coins) and
  // those readers already return null on miss.
  const fundamentals = await refreshFundamentals(fullUniverse);
  const events = await refreshEvents(fullUniverse);
  const sentiment = await refreshSentiment(fullUniverse);
  const aggregates = await refreshAggregates();

  // Dossiers run LAST: they read the warehouse tables we just filled
  // and compose a heuristic (no-AI) brief per ticker. Pure-code, no
  // external calls — effectively free.
  const dossiers = await refreshDossiers(fullUniverse);

  return {
    universeSize: fullUniverse.length,
    market,
    cryptoMarket,
    verify,
    fundamentals,
    events,
    sentiment,
    aggregates,
    dossiers,
  };
}
