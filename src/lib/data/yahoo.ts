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
