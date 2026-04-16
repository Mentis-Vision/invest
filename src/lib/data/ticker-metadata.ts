import { default as YahooFinanceCtor } from "yahoo-finance2";
import { pool } from "../db";
import { log, errorInfo } from "../log";
import {
  classifyAsset,
  isKnownCrypto,
  type AssetClass,
} from "../asset-class";

/**
 * Ticker metadata cache (sector + industry + name).
 *
 * Plaid/SnapTrade holdings don't ship sector data, which is a meaningful gap
 * for portfolio-review ("am I overweight tech?"). This module looks up once
 * per ticker via Yahoo quoteSummary.assetProfile and caches to Postgres with
 * a 30-day refresh window.
 *
 * Falls back gracefully when Yahoo is unreachable — we just return nulls and
 * let the caller render "Unclassified".
 */

const yahoo = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

const REFRESH_DAYS = 30;

export type TickerMetadata = {
  ticker: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  assetClass: AssetClass;
};

/**
 * In-memory memoization per-process so that bulk syncs (e.g. a user with
 * 30 holdings) don't hit Postgres 30 times for identical tickers.
 */
const memo = new Map<string, TickerMetadata>();

export async function getTickerMetadata(ticker: string): Promise<TickerMetadata> {
  const upper = ticker.toUpperCase();
  if (memo.has(upper)) return memo.get(upper)!;

  // 1. Postgres cache
  try {
    const { rows } = await pool.query(
      `SELECT ticker, name, sector, industry, "assetClass", "updatedAt"
       FROM "ticker_metadata" WHERE ticker = $1`,
      [upper]
    );
    if (rows.length > 0) {
      const r = rows[0] as {
        ticker: string;
        name: string | null;
        sector: string | null;
        industry: string | null;
        assetClass: string | null;
        updatedAt: Date;
      };
      const ageDays =
        (Date.now() - new Date(r.updatedAt).getTime()) / 86400000;
      if (ageDays < REFRESH_DAYS) {
        const cached: TickerMetadata = {
          ticker: r.ticker,
          name: r.name,
          sector: r.sector,
          industry: r.industry,
          assetClass:
            (r.assetClass as AssetClass | null) ??
            (isKnownCrypto(r.ticker) ? "crypto" : "equity"),
        };
        memo.set(upper, cached);
        return cached;
      }
    }
  } catch (err) {
    log.warn("ticker-metadata", "cache read failed", {
      ticker: upper,
      ...errorInfo(err),
    });
  }

  // 2a. Shortcut for known crypto — don't pound Yahoo on every BTC/ETH lookup.
  // Yahoo DOES return crypto (e.g. "BTC-USD") but the API pattern differs
  // and sector/industry are null anyway.
  if (isKnownCrypto(upper)) {
    const metadata: TickerMetadata = {
      ticker: upper,
      name: upper,
      sector: null,
      industry: null,
      assetClass: "crypto",
    };
    pool
      .query(
        `INSERT INTO "ticker_metadata" (ticker, name, sector, industry, "assetClass", "updatedAt")
         VALUES ($1, $2, NULL, NULL, 'crypto', NOW())
         ON CONFLICT (ticker) DO UPDATE SET
           "assetClass" = 'crypto',
           "updatedAt" = NOW()`,
        [upper, upper]
      )
      .catch(() => {});
    memo.set(upper, metadata);
    return metadata;
  }

  // 2b. Yahoo lookup for everything else
  try {
    const s = (await yahoo.quoteSummary(upper, {
      modules: ["assetProfile", "price"],
    })) as unknown as {
      assetProfile?: { sector?: string; industry?: string };
      price?: {
        longName?: string;
        shortName?: string;
        quoteType?: string;
        typeDisp?: string;
      };
    };

    const assetClass = classifyAsset(upper, {
      quoteType: s.price?.quoteType ?? null,
      typeDisp: s.price?.typeDisp ?? null,
    });

    const metadata: TickerMetadata = {
      ticker: upper,
      name: s.price?.longName ?? s.price?.shortName ?? null,
      sector: s.assetProfile?.sector ?? null,
      industry: s.assetProfile?.industry ?? null,
      assetClass: assetClass === "unknown" ? "equity" : assetClass,
    };

    pool
      .query(
        `INSERT INTO "ticker_metadata" (ticker, name, sector, industry, "assetClass", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (ticker) DO UPDATE SET
           name = EXCLUDED.name,
           sector = EXCLUDED.sector,
           industry = EXCLUDED.industry,
           "assetClass" = EXCLUDED."assetClass",
           "updatedAt" = NOW()`,
        [
          upper,
          metadata.name,
          metadata.sector,
          metadata.industry,
          metadata.assetClass,
        ]
      )
      .catch(() => {});

    memo.set(upper, metadata);
    return metadata;
  } catch (err) {
    log.warn("ticker-metadata", "yahoo lookup failed", {
      ticker: upper,
      ...errorInfo(err),
    });
    // Fall back: guess from ticker alone (known-crypto list already handled).
    const fallbackClass = classifyAsset(upper);
    const empty: TickerMetadata = {
      ticker: upper,
      name: null,
      sector: null,
      industry: null,
      assetClass: fallbackClass === "unknown" ? "equity" : fallbackClass,
    };
    memo.set(upper, empty);
    return empty;
  }
}

/**
 * Batch lookup — concurrency-capped so we don't slam Yahoo on a portfolio
 * with 50 tickers.
 */
export async function getTickerMetadataBatch(
  tickers: string[],
  concurrency = 4
): Promise<Map<string, TickerMetadata>> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))];
  const result = new Map<string, TickerMetadata>();

  // Simple worker-pool: N promises chew through the queue.
  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const idx = cursor++;
      const t = unique[idx];
      const md = await getTickerMetadata(t);
      result.set(t, md);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, unique.length) },
    () => worker()
  );
  await Promise.all(workers);
  return result;
}
