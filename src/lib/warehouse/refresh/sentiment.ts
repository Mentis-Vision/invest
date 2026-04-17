import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  finnhubConfigured,
  getTickerNews,
  getTickerSentiment,
} from "../../data/finnhub";

export type SentimentRefreshResult = {
  attempted: number;
  written: number;
  skipped: number;
  reason?: string;
};

/**
 * Write one sentiment row per ticker per day. When FINNHUB_API_KEY is
 * unset, we write rows anyway with news_count=0 and null scores so
 * downstream readers get a consistent shape.
 */
export async function refreshSentiment(
  tickers: string[]
): Promise<SentimentRefreshResult> {
  const attempted = tickers.length;
  let written = 0;
  let skipped = 0;

  if (!finnhubConfigured()) {
    // Still write empty rows for continuity.
    for (const ticker of tickers) {
      try {
        await writeRow({
          ticker: ticker.toUpperCase(),
          source: "finnhub",
          newsCount: 0,
          bullishPct: null,
          bearishPct: null,
          neutralPct: null,
          buzzRatio: null,
          companyNewsScore: null,
          sectorAvgScore: null,
          topHeadlines: null,
        });
        written++;
      } catch {
        skipped++;
      }
    }
    return {
      attempted,
      written,
      skipped,
      reason: "finnhub_not_configured",
    };
  }

  let cursor = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const ticker = tickers[idx].toUpperCase();
      try {
        const [news, sentiment] = await Promise.all([
          getTickerNews(ticker, 7, 5),
          getTickerSentiment(ticker),
        ]);
        await writeRow({
          ticker,
          source: "finnhub",
          newsCount: news.items.length,
          bullishPct: sentiment.sentiment?.bullishPercent ?? null,
          bearishPct: sentiment.sentiment?.bearishPercent ?? null,
          neutralPct: null, // Finnhub doesn't split neutral
          buzzRatio: sentiment.buzz?.buzz ?? null,
          companyNewsScore: sentiment.companyNewsScore ?? null,
          sectorAvgScore: sentiment.sectorAverageNewsScore ?? null,
          topHeadlines: news.items.slice(0, 5).map((n) => ({
            title: n.headline,
            url: n.url, // NOTE: NewsHeadline.url (plan erroneously said .link)
            source: n.source,
            publishedAt: n.datetime,
          })),
        });
        written++;
      } catch (err) {
        skipped++;
        log.warn("warehouse.refresh.sentiment", "ticker failed", {
          ticker,
          ...errorInfo(err),
        });
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(3, tickers.length) },
    () => worker()
  );
  await Promise.all(workers);

  return { attempted, written, skipped };
}

type WriteInput = {
  ticker: string;
  source: string;
  newsCount: number;
  bullishPct: number | null;
  bearishPct: number | null;
  neutralPct: number | null;
  buzzRatio: number | null;
  companyNewsScore: number | null;
  sectorAvgScore: number | null;
  topHeadlines:
    | Array<{
        title: string;
        url: string | null;
        source: string | null;
        publishedAt: string | null;
      }>
    | null;
};

async function writeRow(w: WriteInput): Promise<void> {
  await pool.query(
    `INSERT INTO "ticker_sentiment_daily"
       (ticker, captured_at, source,
        news_count, bullish_pct, bearish_pct, neutral_pct,
        buzz_ratio, company_news_score, sector_avg_score, top_headlines)
     VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (ticker, captured_at) DO UPDATE SET
       news_count = EXCLUDED.news_count,
       bullish_pct = EXCLUDED.bullish_pct,
       bearish_pct = EXCLUDED.bearish_pct,
       neutral_pct = EXCLUDED.neutral_pct,
       buzz_ratio = EXCLUDED.buzz_ratio,
       company_news_score = EXCLUDED.company_news_score,
       sector_avg_score = EXCLUDED.sector_avg_score,
       top_headlines = EXCLUDED.top_headlines,
       as_of = NOW()`,
    [
      w.ticker,
      w.source,
      w.newsCount,
      w.bullishPct,
      w.bearishPct,
      w.neutralPct,
      w.buzzRatio,
      w.companyNewsScore,
      w.sectorAvgScore,
      w.topHeadlines ? JSON.stringify(w.topHeadlines) : null,
    ]
  );
}
