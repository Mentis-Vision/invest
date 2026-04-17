import { default as YahooFinanceCtor } from "yahoo-finance2";

// yahoo-finance2 v3 requires instantiation. Cache one instance for the process.
// Signed errors via notices are on by default — we silence the transient
// deprecation notice to keep logs quiet.
const yahooFinance = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

export type StockSnapshot = {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  change: number;
  changePct: number;
  marketCap: number | null;
  peRatio: number | null;
  forwardPE: number | null;
  eps: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyDayAvg: number | null;
  twoHundredDayAvg: number | null;
  volume: number | null;
  avgVolume: number | null;
  beta: number | null;
  sector: string | null;
  industry: string | null;
  analystTarget: number | null;
  recommendationKey: string | null;
  asOf: string;
};

export async function getStockSnapshot(symbol: string): Promise<StockSnapshot> {
  const [quoteResult, summaryResult] = await Promise.all([
    yahooFinance.quote(symbol),
    yahooFinance.quoteSummary(symbol, {
      modules: ["summaryDetail", "assetProfile", "financialData", "defaultKeyStatistics"],
    }),
  ]);

  const q = quoteResult as unknown as Record<string, unknown>;
  type Summary = {
    summaryDetail?: { beta?: number };
    assetProfile?: { sector?: string; industry?: string };
    financialData?: { targetMeanPrice?: number; recommendationKey?: string };
  };
  const summary = summaryResult as unknown as Summary;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

  return {
    symbol: (q.symbol as string) ?? symbol,
    name: (q.longName as string) ?? (q.shortName as string) ?? symbol,
    price: num(q.regularMarketPrice) ?? 0,
    currency: (q.currency as string) ?? "USD",
    change: num(q.regularMarketChange) ?? 0,
    changePct: num(q.regularMarketChangePercent) ?? 0,
    marketCap: num(q.marketCap),
    peRatio: num(q.trailingPE),
    forwardPE: num(q.forwardPE),
    eps: num(q.epsTrailingTwelveMonths),
    dividendYield: num(q.trailingAnnualDividendYield),
    fiftyTwoWeekHigh: num(q.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(q.fiftyTwoWeekLow),
    fiftyDayAvg: num(q.fiftyDayAverage),
    twoHundredDayAvg: num(q.twoHundredDayAverage),
    volume: num(q.regularMarketVolume),
    avgVolume: num(q.averageDailyVolume3Month),
    beta: summary.summaryDetail?.beta ?? null,
    sector: summary.assetProfile?.sector ?? null,
    industry: summary.assetProfile?.industry ?? null,
    analystTarget: summary.financialData?.targetMeanPrice ?? null,
    recommendationKey: summary.financialData?.recommendationKey ?? null,
    asOf: new Date().toISOString(),
  };
}

export function formatSnapshotForAI(s: StockSnapshot): string {
  const fmt = (n: number | null, opts?: Intl.NumberFormatOptions) =>
    n === null ? "N/A" : new Intl.NumberFormat("en-US", opts).format(n);
  const pct = (n: number | null) => (n === null ? "N/A" : `${(n * 100).toFixed(2)}%`);
  const pctRaw = (n: number | null) => (n === null ? "N/A" : `${n.toFixed(2)}%`);
  const cur = (n: number | null) =>
    n === null ? "N/A" : `$${fmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const big = (n: number | null) => {
    if (n === null) return "N/A";
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    return cur(n);
  };

  return `
TICKER: ${s.symbol} (${s.name})
SECTOR: ${s.sector ?? "N/A"} / ${s.industry ?? "N/A"}
AS OF: ${s.asOf}

PRICE DATA:
- Current Price: ${cur(s.price)}
- Day Change: ${cur(s.change)} (${pctRaw(s.changePct)})
- 52-Week Range: ${cur(s.fiftyTwoWeekLow)} – ${cur(s.fiftyTwoWeekHigh)}
- 50-Day Avg: ${cur(s.fiftyDayAvg)}
- 200-Day Avg: ${cur(s.twoHundredDayAvg)}

VALUATION:
- Market Cap: ${big(s.marketCap)}
- P/E (Trailing): ${fmt(s.peRatio, { maximumFractionDigits: 2 })}
- P/E (Forward): ${fmt(s.forwardPE, { maximumFractionDigits: 2 })}
- EPS (TTM): ${cur(s.eps)}
- Dividend Yield: ${pct(s.dividendYield)}
- Beta: ${fmt(s.beta, { maximumFractionDigits: 2 })}

VOLUME:
- Today: ${fmt(s.volume)}
- 3-Month Avg: ${fmt(s.avgVolume)}

ANALYST CONSENSUS:
- Target Price: ${cur(s.analystTarget)}
- Recommendation: ${s.recommendationKey ?? "N/A"}
`.trim();
}

import {
  getTickerMarket,
  getTickerFundamentals,
  getTickerSentiment,
} from "../warehouse";

/**
 * Compose a DATA block that uses warehouse-backed fields for slowly-changing
 * signals (valuation, technicals, fundamentals, analyst consensus) plus
 * Yahoo-live for intraday sensitive fields (current price, day change).
 *
 * Tags every group with [WAREHOUSE] or [LIVE] so the zero-hallucination
 * analyst prompt rule can audit provenance of every datum.
 *
 * This is the function research handlers should call instead of
 * formatSnapshotForAI when the warehouse is populated. Falls back to live
 * fields cleanly when the warehouse hasn't seen this ticker yet.
 */
export async function formatWarehouseEnhancedDataBlock(
  snapshot: StockSnapshot
): Promise<string> {
  const ticker = snapshot.symbol.toUpperCase();
  const [market, fundamentals, sentiment] = await Promise.all([
    getTickerMarket(ticker),
    getTickerFundamentals(ticker),
    getTickerSentiment(ticker),
  ]);

  const fmt = (n: number | null | undefined, opts?: Intl.NumberFormatOptions) =>
    n == null ? "N/A" : new Intl.NumberFormat("en-US", opts).format(n);
  const cur = (n: number | null | undefined) =>
    n == null
      ? "N/A"
      : `$${fmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (n: number | null | undefined) =>
    n == null ? "N/A" : `${(n * 100).toFixed(2)}%`;
  const pctRaw = (n: number | null | undefined) =>
    n == null ? "N/A" : `${n.toFixed(2)}%`;
  const big = (n: number | null | undefined) => {
    if (n == null) return "N/A";
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    return cur(n);
  };

  const lines: string[] = [];
  lines.push(`TICKER: ${snapshot.symbol} (${snapshot.name})`);
  lines.push(`SECTOR: ${snapshot.sector ?? "N/A"} / ${snapshot.industry ?? "N/A"}`);
  lines.push(`AS OF: ${snapshot.asOf}`);
  lines.push("");
  lines.push("[LIVE] PRICE (Yahoo, request time):");
  lines.push(`- Current Price: ${cur(snapshot.price)}`);
  lines.push(`- Day Change: ${cur(snapshot.change)} (${pctRaw(snapshot.changePct)})`);
  lines.push("");

  lines.push(
    market
      ? `[WAREHOUSE] VALUATION (ticker_market_daily as of ${market.capturedAt}):`
      : "[LIVE] VALUATION (Yahoo, warehouse miss):"
  );
  lines.push(
    `- P/E (Trailing): ${fmt(market?.peTrailing ?? snapshot.peRatio, { maximumFractionDigits: 2 })}`
  );
  lines.push(
    `- P/E (Forward): ${fmt(market?.peForward ?? snapshot.forwardPE, { maximumFractionDigits: 2 })}`
  );
  lines.push(
    `- P/B: ${fmt(market?.priceToBook, { maximumFractionDigits: 2 })}`
  );
  lines.push(
    `- P/S: ${fmt(market?.priceToSales, { maximumFractionDigits: 2 })}`
  );
  lines.push(
    `- EV/EBITDA: ${fmt(market?.evToEbitda, { maximumFractionDigits: 2 })}`
  );
  lines.push(`- Market Cap: ${big(market?.marketCap ?? snapshot.marketCap)}`);
  lines.push(
    `- Dividend Yield: ${pct(market?.dividendYield ?? snapshot.dividendYield)}`
  );
  lines.push(
    `- EPS (TTM): ${cur(market?.epsTtm ?? snapshot.eps)}`
  );
  lines.push(`- Beta: ${fmt(market?.beta ?? snapshot.beta, { maximumFractionDigits: 2 })}`);
  lines.push("");

  lines.push(
    market
      ? `[WAREHOUSE] RANGE & TECHNICALS:`
      : `[LIVE] RANGE (Yahoo):`
  );
  lines.push(
    `- 52-Week Range: ${cur(market?.low52w ?? snapshot.fiftyTwoWeekLow)} – ${cur(market?.high52w ?? snapshot.fiftyTwoWeekHigh)}`
  );
  lines.push(`- 50-Day MA: ${cur(market?.ma50 ?? snapshot.fiftyDayAvg)}`);
  lines.push(`- 200-Day MA: ${cur(market?.ma200 ?? snapshot.twoHundredDayAvg)}`);
  if (market) {
    lines.push(`- RSI (14d): ${fmt(market.rsi14, { maximumFractionDigits: 2 })}`);
    lines.push(`- MACD: ${fmt(market.macd, { maximumFractionDigits: 4 })}`);
    lines.push(
      `- MACD Signal: ${fmt(market.macdSignal, { maximumFractionDigits: 4 })}`
    );
    lines.push(
      `- Bollinger Bands: ${cur(market.bollingerLower)} – ${cur(market.bollingerUpper)}`
    );
    lines.push(
      `- VWAP (20d): ${cur(market.vwap20d)}`
    );
    lines.push(
      `- Relative Strength vs SPY (30d): ${pctRaw(market.relStrengthSpy30d)}`
    );
    if (market.shortInterestPct != null) {
      lines.push(`- Short Interest: ${pct(market.shortInterestPct)}`);
    }
  }
  lines.push("");

  lines.push(
    market
      ? `[WAREHOUSE] ANALYST CONSENSUS:`
      : `[LIVE] ANALYST CONSENSUS (Yahoo):`
  );
  lines.push(
    `- Target Price: ${cur(market?.analystTargetMean ?? snapshot.analystTarget)}`
  );
  lines.push(
    `- # Covering Analysts: ${fmt(market?.analystCount)}`
  );
  lines.push(
    `- Recommendation: ${market?.analystRating ?? snapshot.recommendationKey ?? "N/A"}`
  );
  lines.push("");

  if (fundamentals) {
    lines.push(
      `[WAREHOUSE] FUNDAMENTALS (${fundamentals.periodType} ending ${fundamentals.periodEnding}):`
    );
    lines.push(`- Revenue: ${big(fundamentals.revenue)}`);
    lines.push(`- Gross Profit: ${big(fundamentals.grossProfit)}`);
    lines.push(`- Operating Income: ${big(fundamentals.operatingIncome)}`);
    lines.push(`- Net Income: ${big(fundamentals.netIncome)}`);
    lines.push(`- EBITDA: ${big(fundamentals.ebitda)}`);
    lines.push(
      `- Gross Margin: ${pct(fundamentals.grossMargin)}`
    );
    lines.push(
      `- Operating Margin: ${pct(fundamentals.operatingMargin)}`
    );
    lines.push(`- Net Margin: ${pct(fundamentals.netMargin)}`);
    lines.push(`- ROE: ${pct(fundamentals.roe)}`);
    lines.push(`- Debt / Equity: ${fmt(fundamentals.debtToEquity, { maximumFractionDigits: 2 })}`);
    lines.push(`- Free Cash Flow: ${big(fundamentals.freeCashFlow)}`);
  }

  if (sentiment && sentiment.newsCount > 0) {
    lines.push("");
    lines.push(
      `[WAREHOUSE] SENTIMENT (${sentiment.newsCount} recent headlines):`
    );
    if (sentiment.bullishPct != null) {
      lines.push(`- Bullish: ${pct(sentiment.bullishPct)}`);
    }
    if (sentiment.bearishPct != null) {
      lines.push(`- Bearish: ${pct(sentiment.bearishPct)}`);
    }
    if (sentiment.buzzRatio != null) {
      lines.push(
        `- Buzz Ratio: ${fmt(sentiment.buzzRatio, { maximumFractionDigits: 2 })} (vs weekly avg)`
      );
    }
    if (sentiment.companyNewsScore != null) {
      lines.push(
        `- Company News Score: ${fmt(sentiment.companyNewsScore, { maximumFractionDigits: 2 })} (-1 bearish ... +1 bullish)`
      );
    }
    if (sentiment.sectorAvgScore != null) {
      lines.push(
        `- Sector Avg Score: ${fmt(sentiment.sectorAvgScore, { maximumFractionDigits: 2 })}`
      );
    }
  }

  return lines.join("\n");
}
