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
/**
 * Produce a compact "PRESS COVERAGE" section for the AI research data
 * block. Calls getMentionsForTickers + getCoverageCounts and renders:
 *
 *   [PRESS] COVERAGE (N headlines in last 14d across M outlets):
 *   - 2026-04-17 WSJ: "Apple stock falls on supply-chain concerns"
 *     Summary: Apple shares dropped 3% after...
 *   - 2026-04-16 CNBC: "Tim Cook comments on AI strategy"
 *     ...
 *
 * Returns empty string when there's no coverage — the data block skips
 * the section entirely (keeps the prompt lean on quiet tickers).
 *
 * AI prompts already instruct "News is qualitative context only — do
 * not cite as a numeric claim." The section tag [PRESS] makes that
 * provenance auditable.
 */
export async function formatEditorialNewsForAI(
  ticker: string,
  options?: { limit?: number; includeSummaries?: boolean }
): Promise<string> {
  const limit = options?.limit ?? 6;
  const includeSummaries = options?.includeSummaries ?? true;
  const [items, coverage] = await Promise.all([
    getMentionsForTickers([ticker], { limit, maxAgeDays: 14 }),
    getCoverageCounts([ticker], { maxAgeDays: 7 }),
  ]);
  if (items.length === 0) return "";

  const outletCount = coverage[ticker.toUpperCase()] ?? 0;
  const consensusNote =
    outletCount >= 3
      ? ` — ${outletCount} outlets in the last 7d (broad coverage)`
      : outletCount >= 1
        ? ` — ${outletCount} outlet${outletCount === 1 ? "" : "s"} in the last 7d`
        : "";

  const lines: string[] = [
    "",
    `[PRESS] COVERAGE (${items.length} headlines in last 14d${consensusNote}):`,
  ];
  for (const item of items) {
    const date = item.publishedAt.slice(0, 10);
    const headline = item.title.slice(0, 180);
    lines.push(`- ${date} ${item.providerName}: "${headline}"`);
    if (includeSummaries && item.summary) {
      // Summary is often truncated already; cap aggressively to keep
      // prompts lean. The model doesn't need prose for context, just a
      // one-sentence hint.
      const trimmed = item.summary
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220);
      if (trimmed.length > 30) {
        lines.push(`  ${trimmed}${item.summary.length > 220 ? "…" : ""}`);
      }
    }
  }
  return lines.join("\n");
}

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
