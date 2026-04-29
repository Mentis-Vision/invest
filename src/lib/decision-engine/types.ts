export type DecisionAction =
  | "HIGH_CONVICTION_CANDIDATE"
  | "BUY_CANDIDATE"
  | "HOLD_WATCH"
  | "REDUCE_REVIEW"
  | "AVOID"
  | "INSUFFICIENT_DATA";

export type DecisionConfidence = "LOW" | "MEDIUM" | "HIGH";

export type RiskProfile = "conservative" | "balanced" | "aggressive";

export type MarketRegime =
  | "RISK_ON"
  | "NEUTRAL"
  | "LATE_CYCLE_CAUTION"
  | "RATE_PRESSURE"
  | "LIQUIDITY_STRESS"
  | "RECESSION_RISK"
  | "HIGH_VOLATILITY_RISK_OFF"
  | "INSUFFICIENT_DATA";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

export type ScoreDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type ScoreComponent = {
  name: string;
  score: number;
  weight: number;
  direction: ScoreDirection;
  rationale: string;
  dataPoints: string[];
  missingData: string[];
};

export type DecisionRiskGate = {
  id: string;
  severity: "info" | "warn" | "block";
  triggered: boolean;
  title: string;
  rationale: string;
};

export type PositionSizing = {
  portfolioKnown: boolean;
  portfolioValue: number | null;
  currentPositionPct: number | null;
  suggestedMaxPositionPct: number;
  maxRiskPerTradePct: number;
  suggestedStopPrice: number | null;
  suggestedReviewPrice: number | null;
  rewardRiskRatio: number | null;
  positionSizingNote: string;
};

export type DecisionEngineInput = {
  ticker: string;
  asOf: string;
  riskProfile: RiskProfile;

  snapshot: {
    price: number | null;
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
  };

  warehouse?: {
    verifyDeltaPct?: number | null;
    verifyClose?: number | null;
    verifySource?: string | null;
    rsi14?: number | null;
    macd?: number | null;
    macdSignal?: number | null;
    vwap20d?: number | null;
    relStrengthSpy30d?: number | null;
    shortInterestPct?: number | null;
    priceToBook?: number | null;
    priceToSales?: number | null;
    evToEbitda?: number | null;
    analystCount?: number | null;
    analystRating?: string | null;
  } | null;

  fundamentals?: {
    revenue?: number | null;
    grossMargin?: number | null;
    operatingMargin?: number | null;
    netMargin?: number | null;
    roe?: number | null;
    debtToEquity?: number | null;
    freeCashFlow?: number | null;
    netIncome?: number | null;
    periodEnding?: string | null;
  } | null;

  sentiment?: {
    bullishPct?: number | null;
    bearishPct?: number | null;
    buzzRatio?: number | null;
    companyNewsScore?: number | null;
    sectorAvgScore?: number | null;
    newsCount?: number | null;
  } | null;

  macro?: {
    regime: MarketRegime;
    vix?: number | null;
    tenYearYield?: number | null;
    twoYearYield?: number | null;
    fedFunds?: number | null;
    cpiTrend?: "rising" | "falling" | "flat" | "unknown";
    unemploymentTrend?: "rising" | "falling" | "flat" | "unknown";
  };

  portfolio?: {
    portfolioKnown: boolean;
    totalValue: number | null;
    currentTickerValue: number | null;
    currentTickerPct: number | null;
    sectorExposurePct: number | null;
  };

  events?: {
    earningsSoon?: boolean;
    recentMaterialFiling?: boolean;
    recentInsiderOfficerBuy?: boolean;
    recentInsiderClusterSell?: boolean;
    majorNegativeHeadline?: boolean;
  };
};

export type DecisionEngineOutput = {
  ticker: string;
  asOf: string;
  action: DecisionAction;
  confidence: DecisionConfidence;
  tradeQualityScore: number;
  riskLevel: RiskLevel;
  marketRegime: MarketRegime;
  scoreComponents: ScoreComponent[];
  riskGates: DecisionRiskGate[];
  positionSizing: PositionSizing;
  reasons: string[];
  risks: string[];
  missingData: string[];
  whatWouldChangeThisView: string[];
  clientSummary: string;
  audit: {
    engineVersion: string;
    weights: Record<string, number>;
    riskProfile: RiskProfile;
    dataQualityScore: number;
    riskPenalty: number;
    generatedAt: string;
  };
};
