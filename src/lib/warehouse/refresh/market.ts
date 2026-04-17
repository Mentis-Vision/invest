import { default as YahooFinanceCtor } from "yahoo-finance2";
import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  computeRsi14,
  computeMacd,
  computeBollinger,
  sma,
  vwap20d,
  relStrength,
} from "../indicators";

/**
 * Refresh ticker_market_daily for a list of tickers.
 * Per ticker: one quote() + one chart() call (250d history for indicators).
 * Writes one row per ticker per call, keyed (ticker, captured_at).
 *
 * SPY is fetched once up-front to compute relative-strength vs SPY.
 */

const yahoo = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

export type MarketRefreshResult = {
  attempted: number;
  written: number;
  skipped: number;
  failed: Array<{ ticker: string; error: string }>;
};

export async function refreshMarket(
  tickers: string[]
): Promise<MarketRefreshResult> {
  const attempted = tickers.length;
  let written = 0;
  let skipped = 0;
  const failed: MarketRefreshResult["failed"] = [];

  // Get SPY history once for relative-strength computation.
  const spyCloses = await fetchCloseHistory("SPY", 60).catch(() => null);

  // Concurrency cap so we don't slam Yahoo.
  let cursor = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const ticker = tickers[idx].toUpperCase();
      try {
        const row = await buildMarketRow(ticker, spyCloses);
        if (!row) {
          skipped++;
          continue;
        }
        await writeRow(row);
        written++;
      } catch (err) {
        failed.push({
          ticker,
          error: err instanceof Error ? err.message : "unknown",
        });
        log.warn("warehouse.refresh.market", "ticker failed", {
          ticker,
          ...errorInfo(err),
        });
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(4, tickers.length) },
    () => worker()
  );
  await Promise.all(workers);

  return { attempted, written, skipped, failed };
}

type MarketWriteRow = {
  ticker: string;
  source: "yahoo";
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  change_pct: number | null;
  ma_50: number | null;
  ma_200: number | null;
  bollinger_upper: number | null;
  bollinger_lower: number | null;
  vwap_20d: number | null;
  high_52w: number | null;
  low_52w: number | null;
  beta: number | null;
  market_cap: number | null;
  pe_trailing: number | null;
  pe_forward: number | null;
  price_to_book: number | null;
  price_to_sales: number | null;
  ev_to_ebitda: number | null;
  dividend_yield: number | null;
  eps_ttm: number | null;
  rsi_14: number | null;
  macd: number | null;
  macd_signal: number | null;
  rel_strength_spy_30d: number | null;
  analyst_target_mean: number | null;
  analyst_count: number | null;
  analyst_rating: string | null;
};

async function buildMarketRow(
  ticker: string,
  spyCloses: number[] | null
): Promise<MarketWriteRow | null> {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : null;

  // Live quote for headline fields
  const q = (await yahoo.quote(ticker)) as Record<string, unknown>;
  const close = num(q.regularMarketPrice);
  if (close === null || close <= 0) return null; // Yahoo didn't recognize it

  // Summary for valuation / analyst
  let summary: Record<string, unknown> | null = null;
  try {
    const s = await yahoo.quoteSummary(ticker, {
      modules: ["summaryDetail", "financialData", "defaultKeyStatistics"],
    });
    summary = s as unknown as Record<string, unknown>;
  } catch {
    summary = null;
  }

  const summaryDetail = summary?.summaryDetail as Record<string, unknown> | undefined;
  const financialData = summary?.financialData as
    | Record<string, unknown>
    | undefined;
  const keyStats = summary?.defaultKeyStatistics as
    | Record<string, unknown>
    | undefined;

  // 250d close/volume history for technicals
  const closes: number[] = [];
  const volumes: number[] = [];
  try {
    const hist = (await yahoo.chart(ticker, {
      period1: new Date(Date.now() - 250 * 86400000),
      interval: "1d",
    })) as unknown as {
      quotes?: Array<{ close?: number | null; volume?: number | null }>;
    };
    for (const b of hist.quotes ?? []) {
      if (typeof b.close === "number" && Number.isFinite(b.close)) {
        closes.push(b.close);
        volumes.push(typeof b.volume === "number" ? b.volume : 0);
      }
    }
  } catch {
    /* indicators will stay null — not a fatal error */
  }

  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const rsi = computeRsi14(closes);
  const macdVals = computeMacd(closes);
  const bb = computeBollinger(closes);
  const vwap = vwap20d(closes, volumes);
  const relStrength30d =
    spyCloses && closes.length > 0
      ? relStrength(closes, spyCloses, 30)
      : null;

  return {
    ticker,
    source: "yahoo",
    open: num(q.regularMarketOpen),
    high: num(q.regularMarketDayHigh),
    low: num(q.regularMarketDayLow),
    close,
    volume: num(q.regularMarketVolume),
    change_pct: num(q.regularMarketChangePercent),
    ma_50: ma50,
    ma_200: ma200,
    bollinger_upper: bb.upper,
    bollinger_lower: bb.lower,
    vwap_20d: vwap,
    high_52w: num(q.fiftyTwoWeekHigh),
    low_52w: num(q.fiftyTwoWeekLow),
    beta: num(summaryDetail?.beta),
    market_cap: num(q.marketCap),
    pe_trailing: num(q.trailingPE),
    pe_forward: num(q.forwardPE),
    price_to_book: num(keyStats?.priceToBook),
    price_to_sales: num(summaryDetail?.priceToSalesTrailing12Months),
    ev_to_ebitda: num(keyStats?.enterpriseToEbitda),
    dividend_yield: num(q.trailingAnnualDividendYield),
    eps_ttm: num(q.epsTrailingTwelveMonths),
    rsi_14: rsi,
    macd: macdVals.macd,
    macd_signal: macdVals.signal,
    rel_strength_spy_30d: relStrength30d,
    analyst_target_mean: num(financialData?.targetMeanPrice),
    analyst_count: num(financialData?.numberOfAnalystOpinions),
    analyst_rating: str(financialData?.recommendationKey),
  };
}

async function fetchCloseHistory(
  ticker: string,
  days: number
): Promise<number[]> {
  const hist = (await yahoo.chart(ticker, {
    period1: new Date(Date.now() - days * 86400000),
    interval: "1d",
  })) as unknown as {
    quotes?: Array<{ close?: number | null }>;
  };
  return (hist.quotes ?? [])
    .map((b) => b.close)
    .filter(
      (c): c is number => typeof c === "number" && Number.isFinite(c)
    );
}

async function writeRow(r: MarketWriteRow): Promise<void> {
  await pool.query(
    `INSERT INTO "ticker_market_daily"
      (ticker, captured_at, source,
       open, high, low, close, volume, change_pct,
       ma_50, ma_200, bollinger_upper, bollinger_lower, vwap_20d,
       high_52w, low_52w, beta, market_cap,
       pe_trailing, pe_forward, price_to_book, price_to_sales,
       ev_to_ebitda, dividend_yield, eps_ttm,
       rsi_14, macd, macd_signal, rel_strength_spy_30d,
       analyst_target_mean, analyst_count, analyst_rating)
     VALUES (
       $1, CURRENT_DATE, $2,
       $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13,
       $14, $15, $16, $17,
       $18, $19, $20, $21,
       $22, $23, $24,
       $25, $26, $27, $28,
       $29, $30, $31
     )
     ON CONFLICT (ticker, captured_at) DO UPDATE SET
       open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
       close = EXCLUDED.close, volume = EXCLUDED.volume,
       change_pct = EXCLUDED.change_pct,
       ma_50 = EXCLUDED.ma_50, ma_200 = EXCLUDED.ma_200,
       bollinger_upper = EXCLUDED.bollinger_upper,
       bollinger_lower = EXCLUDED.bollinger_lower,
       vwap_20d = EXCLUDED.vwap_20d,
       high_52w = EXCLUDED.high_52w, low_52w = EXCLUDED.low_52w,
       beta = EXCLUDED.beta, market_cap = EXCLUDED.market_cap,
       pe_trailing = EXCLUDED.pe_trailing, pe_forward = EXCLUDED.pe_forward,
       price_to_book = EXCLUDED.price_to_book,
       price_to_sales = EXCLUDED.price_to_sales,
       ev_to_ebitda = EXCLUDED.ev_to_ebitda,
       dividend_yield = EXCLUDED.dividend_yield, eps_ttm = EXCLUDED.eps_ttm,
       rsi_14 = EXCLUDED.rsi_14, macd = EXCLUDED.macd,
       macd_signal = EXCLUDED.macd_signal,
       rel_strength_spy_30d = EXCLUDED.rel_strength_spy_30d,
       analyst_target_mean = EXCLUDED.analyst_target_mean,
       analyst_count = EXCLUDED.analyst_count,
       analyst_rating = EXCLUDED.analyst_rating,
       as_of = NOW()`,
    [
      r.ticker,
      r.source,
      r.open, r.high, r.low, r.close, r.volume, r.change_pct,
      r.ma_50, r.ma_200, r.bollinger_upper, r.bollinger_lower, r.vwap_20d,
      r.high_52w, r.low_52w, r.beta, r.market_cap,
      r.pe_trailing, r.pe_forward, r.price_to_book, r.price_to_sales,
      r.ev_to_ebitda, r.dividend_yield, r.eps_ttm,
      r.rsi_14, r.macd, r.macd_signal, r.rel_strength_spy_30d,
      r.analyst_target_mean, r.analyst_count, r.analyst_rating,
    ]
  );
}
