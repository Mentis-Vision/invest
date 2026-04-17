/**
 * Typed shapes for rows in the warehouse tables.
 * These are the ONLY shapes app code should see — never raw query rows.
 *
 * Nullable fields are typed as `number | null` (or `string | null`) because
 * upstream data is often partial (Yahoo doesn't return EPS for every ticker,
 * Finnhub isn't always configured, etc.). Readers must handle null.
 *
 * PRIVACY INVARIANT: None of these types contain a userId field. Adding one
 * would be an audit violation.
 */

export type WarehouseSource =
  | "yahoo"
  | "coingecko"
  | "sec"
  | "fred"
  | "finnhub"
  | "alpha_vantage"
  | "computed"
  | "multi";

export type TickerEventType =
  | "earnings"
  | "dividend_ex"
  | "dividend_pay"
  | "split"
  | "filing_8k"
  | "filing_10q"
  | "filing_10k"
  | "guidance"
  | "conference"
  | "other";

export type PeriodType = "quarterly" | "annual";

export type TickerMarketRow = {
  ticker: string;
  capturedAt: string; // ISO date
  asOf: string;
  source: WarehouseSource;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  changePct: number | null;
  ma50: number | null;
  ma200: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  vwap20d: number | null;
  high52w: number | null;
  low52w: number | null;
  beta: number | null;
  marketCap: number | null;
  peTrailing: number | null;
  peForward: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;
  dividendYield: number | null;
  epsTtm: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  relStrengthSpy30d: number | null;
  analystTargetMean: number | null;
  analystCount: number | null;
  analystRating: string | null;
  shortInterestPct: number | null;
  // Cross-source verification (Alpha Vantage GLOBAL_QUOTE).
  // verifySource is the secondary source name; verifyClose is its closing
  // price; verifyDeltaPct is signed (av - yahoo)/yahoo * 100. All null
  // if AV wasn't configured or couldn't price the ticker.
  verifySource: string | null;
  verifyClose: number | null;
  verifyDeltaPct: number | null;
};

export type TickerFundamentalsRow = {
  ticker: string;
  periodEnding: string; // ISO date
  periodType: PeriodType;
  filingAccession: string | null;
  reportedAt: string | null;
  asOf: string;
  source: WarehouseSource;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  ebitda: number | null;
  epsBasic: number | null;
  epsDiluted: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  sharesOutstanding: number | null;
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
  capex: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  roa: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
};

export type TickerEventRow = {
  id: string;
  ticker: string;
  eventType: TickerEventType;
  eventDate: string; // ISO date
  eventTime: string | null; // ISO timestamp
  details: Record<string, unknown>;
  source: WarehouseSource;
  asOf: string;
};

export type TickerSentimentRow = {
  ticker: string;
  capturedAt: string; // ISO date
  asOf: string;
  source: WarehouseSource;
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

export type SystemAggregateRow = {
  capturedAt: string; // ISO date
  metricName: string;
  dimension: string | null;
  valueNumeric: number | null;
  valueJson: unknown;
  asOf: string;
};
