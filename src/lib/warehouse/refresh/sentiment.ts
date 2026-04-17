import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  finnhubConfigured,
  getTickerNews,
  getTickerSentiment,
} from "../../data/finnhub";
import {
  alphaVantageConfigured,
  getNewsSentiment,
  type AVNewsItem,
} from "../../data/alpha-vantage";

export type SentimentRefreshResult = {
  attempted: number;
  written: number;
  skipped: number;
  reason?: string;
};

/**
 * Write one sentiment row per ticker per day.
 *
 * Source strategy:
 *   - Both Finnhub + Alpha Vantage configured → "multi" (Finnhub for the
 *     structured sentiment %, AV for supplementary headlines + a second
 *     score for cross-check).
 *   - Only Finnhub → "finnhub" (existing behavior).
 *   - Only Alpha Vantage → "alpha_vantage" (compute bullish/bearish % from
 *     AV's per-article ticker_sentiment_score).
 *   - Neither → empty row, source = "finnhub" for shape continuity.
 */
export async function refreshSentiment(
  tickers: string[]
): Promise<SentimentRefreshResult> {
  const attempted = tickers.length;
  let written = 0;
  let skipped = 0;

  const fhOn = finnhubConfigured();
  const avOn = alphaVantageConfigured();

  // No source at all — write empty rows so readers get a shape.
  if (!fhOn && !avOn) {
    for (const ticker of tickers) {
      try {
        await writeRow(emptyRow(ticker.toUpperCase(), "finnhub"));
        written++;
      } catch {
        skipped++;
      }
    }
    return {
      attempted,
      written,
      skipped,
      reason: "no_sentiment_source_configured",
    };
  }

  // AV's rate limit on the free tier is tight. Drop concurrency so we
  // serialize when AV is the only configured source.
  const concurrency = !fhOn && avOn ? 1 : avOn ? 2 : 3;

  let cursor = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const ticker = tickers[idx].toUpperCase();
      try {
        const fh = fhOn ? await fetchFinnhub(ticker) : null;
        // Only fall through to AV news when Finnhub didn't give us a
        // useful result — AV calls are throttled at ~12s each on free
        // tier and we burn that budget elsewhere (verify, crypto).
        const needAv =
          avOn && (!fh || fh.newsItems.length === 0);
        const av = needAv
          ? await getNewsSentiment(ticker, 5).catch(() => [])
          : [];
        const merged = mergeSentiment(ticker, fh, av);
        await writeRow(merged);
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
    { length: Math.min(concurrency, tickers.length) },
    () => worker()
  );
  await Promise.all(workers);

  return { attempted, written, skipped };
}

type FinnhubBundle = {
  newsItems: Array<{
    title: string;
    url: string | null;
    source: string | null;
    publishedAt: string | null;
  }>;
  bullishPct: number | null;
  bearishPct: number | null;
  buzzRatio: number | null;
  companyNewsScore: number | null;
  sectorAvgScore: number | null;
};

async function fetchFinnhub(ticker: string): Promise<FinnhubBundle | null> {
  try {
    const [news, sentiment] = await Promise.all([
      getTickerNews(ticker, 7, 5),
      getTickerSentiment(ticker),
    ]);
    return {
      newsItems: news.items.slice(0, 5).map((n) => ({
        title: n.headline,
        url: n.url, // NewsHeadline.url, not .link
        source: n.source,
        publishedAt: n.datetime,
      })),
      bullishPct: sentiment.sentiment?.bullishPercent ?? null,
      bearishPct: sentiment.sentiment?.bearishPercent ?? null,
      buzzRatio: sentiment.buzz?.buzz ?? null,
      companyNewsScore: sentiment.companyNewsScore ?? null,
      sectorAvgScore: sentiment.sectorAverageNewsScore ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Convert AV per-article ticker_sentiment_score into bullish/bearish/
 * neutral fractions compatible with Finnhub's shape. AV's score is
 * roughly [-1, 1]; thresholds chosen to match AV's own published label
 * boundaries (bullish > 0.15, bearish < -0.15).
 *
 * Returns fractions 0..1 to match Finnhub's bullishPercent convention
 * (the readers downstream multiply by 100 for display).
 */
function avAggregate(items: AVNewsItem[]): {
  bullishPct: number | null;
  bearishPct: number | null;
  neutralPct: number | null;
} {
  const scored = items
    .map((i) => i.tickerSentiment)
    .filter((s): s is number => typeof s === "number");
  if (scored.length === 0) {
    return { bullishPct: null, bearishPct: null, neutralPct: null };
  }
  let bull = 0;
  let bear = 0;
  let neut = 0;
  for (const s of scored) {
    if (s > 0.15) bull++;
    else if (s < -0.15) bear++;
    else neut++;
  }
  const n = scored.length;
  return {
    bullishPct: bull / n,
    bearishPct: bear / n,
    neutralPct: neut / n,
  };
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

function emptyRow(ticker: string, source: string): WriteInput {
  return {
    ticker,
    source,
    newsCount: 0,
    bullishPct: null,
    bearishPct: null,
    neutralPct: null,
    buzzRatio: null,
    companyNewsScore: null,
    sectorAvgScore: null,
    topHeadlines: null,
  };
}

/**
 * Merge Finnhub + AV. Headlines are deduped by URL (Finnhub wins on
 * collisions). Sentiment percentages prefer Finnhub's structured numbers
 * but fall back to AV's per-article aggregate when Finnhub didn't price
 * the ticker.
 */
function mergeSentiment(
  ticker: string,
  fh: FinnhubBundle | null,
  av: AVNewsItem[]
): WriteInput {
  const headlines: WriteInput["topHeadlines"] = [];
  const seen = new Set<string>();

  for (const h of fh?.newsItems ?? []) {
    const key = h.url ?? h.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    headlines.push(h);
  }
  for (const item of av) {
    const key = item.url || item.title;
    if (!key || seen.has(key)) continue;
    if (headlines.length >= 5) break;
    seen.add(key);
    headlines.push({
      title: item.title,
      url: item.url || null,
      source: item.source || "Alpha Vantage",
      publishedAt: item.publishedAt || null,
    });
  }

  const avAgg = avAggregate(av);
  const source =
    fh && av.length > 0
      ? "multi"
      : fh
        ? "finnhub"
        : av.length > 0
          ? "alpha_vantage"
          : "finnhub";

  return {
    ticker,
    source,
    newsCount: headlines.length,
    bullishPct: fh?.bullishPct ?? avAgg.bullishPct,
    bearishPct: fh?.bearishPct ?? avAgg.bearishPct,
    neutralPct: avAgg.neutralPct, // Finnhub doesn't split neutral; AV does
    buzzRatio: fh?.buzzRatio ?? null,
    companyNewsScore: fh?.companyNewsScore ?? null,
    sectorAvgScore: fh?.sectorAvgScore ?? null,
    topHeadlines: headlines.length > 0 ? headlines : null,
  };
}

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
       source = EXCLUDED.source,
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
