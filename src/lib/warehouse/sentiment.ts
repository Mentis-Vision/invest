import { pool } from "../db";
import { log, errorInfo } from "../log";
import type { TickerSentimentRow, WarehouseSource } from "./types";

export async function getTickerSentiment(
  ticker: string
): Promise<TickerSentimentRow | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM "ticker_sentiment_daily"
       WHERE ticker = $1
       ORDER BY captured_at DESC
       LIMIT 1`,
      [ticker.toUpperCase()]
    );
    if (rows.length === 0) return null;
    return mapRow(rows[0] as Record<string, unknown>);
  } catch (err) {
    log.warn("warehouse.sentiment", "getTickerSentiment failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

function mapRow(r: Record<string, unknown>): TickerSentimentRow {
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  const iso = (v: unknown): string =>
    v instanceof Date ? v.toISOString() : String(v);
  const dateOnly = (v: unknown): string =>
    v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

  let headlines: TickerSentimentRow["topHeadlines"] = null;
  if (Array.isArray(r.top_headlines)) {
    headlines = (r.top_headlines as unknown[])
      .filter((h): h is Record<string, unknown> => h !== null && typeof h === "object")
      .map((h) => ({
        title: String(h.title ?? ""),
        url: h.url ? String(h.url) : null,
        source: h.source ? String(h.source) : null,
        publishedAt: h.publishedAt ? String(h.publishedAt) : null,
      }));
  }

  return {
    ticker: String(r.ticker),
    capturedAt: dateOnly(r.captured_at),
    asOf: iso(r.as_of),
    source: (String(r.source) as WarehouseSource) ?? "finnhub",
    newsCount: Number(r.news_count ?? 0),
    bullishPct: num(r.bullish_pct),
    bearishPct: num(r.bearish_pct),
    neutralPct: num(r.neutral_pct),
    buzzRatio: num(r.buzz_ratio),
    companyNewsScore: num(r.company_news_score),
    sectorAvgScore: num(r.sector_avg_score),
    topHeadlines: headlines,
  };
}
