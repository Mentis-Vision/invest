import { default as YahooFinanceCtor } from "yahoo-finance2";
import { pool } from "../db";
import { log, errorInfo } from "../log";

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
      `SELECT ticker, name, sector, industry, "updatedAt"
       FROM "ticker_metadata" WHERE ticker = $1`,
      [upper]
    );
    if (rows.length > 0) {
      const r = rows[0] as {
        ticker: string;
        name: string | null;
        sector: string | null;
        industry: string | null;
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

  // 2. Yahoo lookup
  try {
    const s = (await yahoo.quoteSummary(upper, {
      modules: ["assetProfile", "price"],
    })) as unknown as {
      assetProfile?: { sector?: string; industry?: string };
      price?: { longName?: string; shortName?: string };
    };
    const metadata: TickerMetadata = {
      ticker: upper,
      name: s.price?.longName ?? s.price?.shortName ?? null,
      sector: s.assetProfile?.sector ?? null,
      industry: s.assetProfile?.industry ?? null,
    };

    // Write-back to cache. Ignore errors — the in-memory + Yahoo path is enough.
    pool
      .query(
        `INSERT INTO "ticker_metadata" (ticker, name, sector, industry, "updatedAt")
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (ticker) DO UPDATE SET
           name = EXCLUDED.name,
           sector = EXCLUDED.sector,
           industry = EXCLUDED.industry,
           "updatedAt" = NOW()`,
        [upper, metadata.name, metadata.sector, metadata.industry]
      )
      .catch(() => {});

    memo.set(upper, metadata);
    return metadata;
  } catch (err) {
    log.warn("ticker-metadata", "yahoo lookup failed", {
      ticker: upper,
      ...errorInfo(err),
    });
    const empty: TickerMetadata = {
      ticker: upper,
      name: null,
      sector: null,
      industry: null,
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
