import { pool } from "../db";
import { log, errorInfo } from "../log";

/**
 * Typed reader for market_news_daily. App surfaces read from here;
 * NEVER fetch RSS feeds on demand from a request handler — the cron
 * populates the table nightly and the table is what we read.
 */

export type MarketNewsRow = {
  id: string;
  publishedAt: string; // ISO
  providerId: string;
  providerName: string;
  category: "news" | "analysis" | "thinker" | "regulatory";
  title: string;
  url: string;
  summary: string | null;
  tickersMentioned: string[];
};

function mapRow(r: Record<string, unknown>): MarketNewsRow {
  return {
    id: String(r.id),
    publishedAt:
      r.publishedAt instanceof Date
        ? r.publishedAt.toISOString()
        : String(r.publishedAt),
    providerId: String(r.provider_id),
    providerName: String(r.provider_name),
    category: String(r.category) as MarketNewsRow["category"],
    title: String(r.title),
    url: String(r.url),
    summary: r.summary == null ? null : String(r.summary),
    tickersMentioned: Array.isArray(r.tickers_mentioned)
      ? (r.tickers_mentioned as string[])
      : [],
  };
}

/**
 * Recent items across all providers, optionally filtered by category.
 * Keeps the UI surface lean — 5–8 items typical.
 */
export async function getRecentMarketNews(options?: {
  category?: MarketNewsRow["category"];
  limit?: number;
  maxAgeDays?: number;
}): Promise<MarketNewsRow[]> {
  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
  const maxAge = options?.maxAgeDays ?? 7;
  try {
    const { rows } = options?.category
      ? await pool.query(
          `SELECT * FROM "market_news_daily"
            WHERE category = $1
              AND "publishedAt" > NOW() - ($2 || ' days')::interval
            ORDER BY "publishedAt" DESC
            LIMIT $3`,
          [options.category, String(maxAge), limit]
        )
      : await pool.query(
          `SELECT * FROM "market_news_daily"
            WHERE "publishedAt" > NOW() - ($1 || ' days')::interval
            ORDER BY "publishedAt" DESC
            LIMIT $2`,
          [String(maxAge), limit]
        );
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  } catch (err) {
    log.warn("market-news", "getRecent failed", errorInfo(err));
    return [];
  }
}

/**
 * Items that mention any of a list of tickers. Used for "portfolio in
 * the news" on the dashboard — pass the user's holdings, get back the
 * union of articles touching them.
 *
 * Also used for per-ticker "Coverage" on the ticker drill.
 */
export async function getMentionsForTickers(
  tickers: string[],
  options?: { limit?: number; maxAgeDays?: number }
): Promise<MarketNewsRow[]> {
  if (tickers.length === 0) return [];
  const limit = Math.min(Math.max(options?.limit ?? 15, 1), 50);
  const maxAge = options?.maxAgeDays ?? 14;
  const upper = tickers.map((t) => t.toUpperCase());
  try {
    const { rows } = await pool.query(
      `SELECT * FROM "market_news_daily"
        WHERE tickers_mentioned && $1
          AND "publishedAt" > NOW() - ($2 || ' days')::interval
        ORDER BY "publishedAt" DESC
        LIMIT $3`,
      [upper, String(maxAge), limit]
    );
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  } catch (err) {
    log.warn("market-news", "getMentionsForTickers failed", errorInfo(err));
    return [];
  }
}

/**
 * Coverage-count per ticker — how many DIFFERENT outlets mentioned
 * each ticker in the window. Cross-source consensus: when WSJ + CNBC
 * + Reuters all cover the same story, it's signal. One outlet = noise.
 */
export async function getCoverageCounts(
  tickers: string[],
  options?: { maxAgeDays?: number }
): Promise<Record<string, number>> {
  if (tickers.length === 0) return {};
  const maxAge = options?.maxAgeDays ?? 7;
  const upper = tickers.map((t) => t.toUpperCase());
  try {
    const { rows } = await pool.query(
      `SELECT UNNEST(tickers_mentioned) AS ticker,
              COUNT(DISTINCT provider_id)::int AS outlet_count
         FROM "market_news_daily"
        WHERE tickers_mentioned && $1
          AND "publishedAt" > NOW() - ($2 || ' days')::interval
        GROUP BY ticker`,
      [upper, String(maxAge)]
    );
    const out: Record<string, number> = {};
    for (const r of rows as Array<{ ticker: string; outlet_count: number }>) {
      out[r.ticker] = Number(r.outlet_count);
    }
    return out;
  } catch (err) {
    log.warn("market-news", "getCoverageCounts failed", errorInfo(err));
    return {};
  }
}
