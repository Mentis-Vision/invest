import type {
  DecisionEngineInput,
  MarketRegime,
  ScoreComponent,
} from "./types";
import { clampScore, isFiniteNumber, pctChange, scoreDirection } from "./utils";

export const DECISION_ENGINE_WEIGHTS = {
  businessQuality: 0.20,
  valuation: 0.20,
  technicalTrend: 0.20,
  growthEarnings: 0.15,
  sentimentNews: 0.10,
  macroFit: 0.10,
  insiderEvents: 0.05,
} as const;

type ComponentDraft = {
  score: number;
  rationale: string;
  dataPoints: string[];
  missingData: string[];
};

export function computeDecisionScores(input: DecisionEngineInput): {
  scoreComponents: ScoreComponent[];
  dataQualityScore: number;
  grossScore: number;
  riskPenalty: number;
  tradeQualityScore: number;
  missingData: string[];
} {
  const dataQuality = computeDataQuality(input);
  const components: ScoreComponent[] = [
    toComponent(
      "Business Quality",
      businessQualityScore(input),
      DECISION_ENGINE_WEIGHTS.businessQuality
    ),
    toComponent(
      "Valuation",
      valuationScore(input),
      DECISION_ENGINE_WEIGHTS.valuation
    ),
    toComponent(
      "Technical Trend",
      technicalTrendScore(input),
      DECISION_ENGINE_WEIGHTS.technicalTrend
    ),
    toComponent(
      "Growth / Earnings",
      growthEarningsScore(input),
      DECISION_ENGINE_WEIGHTS.growthEarnings
    ),
    toComponent(
      "Sentiment / News",
      sentimentNewsScore(input),
      DECISION_ENGINE_WEIGHTS.sentimentNews
    ),
    toComponent(
      "Macro Fit",
      macroFitScore(input),
      DECISION_ENGINE_WEIGHTS.macroFit
    ),
    toComponent(
      "Insider / Events",
      insiderEventsScore(input),
      DECISION_ENGINE_WEIGHTS.insiderEvents
    ),
  ];

  const grossScore = clampScore(
    components.reduce((sum, c) => sum + c.score * c.weight, 0)
  );
  const dataQualityPenalty =
    dataQuality.score >= 80 ? 0 : Math.round((80 - dataQuality.score) * 0.35);
  const riskPenalty = clampScore(dataQualityPenalty);
  const tradeQualityScore = clampScore(grossScore - riskPenalty);
  const missingData = [
    ...dataQuality.missingData,
    ...components.flatMap((c) => c.missingData),
  ];

  return {
    scoreComponents: components,
    dataQualityScore: dataQuality.score,
    grossScore,
    riskPenalty,
    tradeQualityScore,
    missingData,
  };
}

function toComponent(
  name: string,
  draft: ComponentDraft,
  weight: number
): ScoreComponent {
  const score = clampScore(draft.score);
  return {
    name,
    score,
    weight,
    direction: scoreDirection(score),
    rationale: draft.rationale,
    dataPoints: draft.dataPoints,
    missingData: draft.missingData,
  };
}

function computeDataQuality(input: DecisionEngineInput): {
  score: number;
  missingData: string[];
} {
  let score = 100;
  const missingData: string[] = [];

  if (!isFiniteNumber(input.snapshot.price) || input.snapshot.price <= 0) {
    score -= 40;
    missingData.push("Current price is missing or invalid.");
  }
  if (!isFiniteNumber(input.snapshot.marketCap)) {
    score -= 20;
    missingData.push("Market capitalization is missing.");
  }
  const technicalMissing = [
    ["50-day moving average", input.snapshot.fiftyDayAvg],
    ["200-day moving average", input.snapshot.twoHundredDayAvg],
    ["52-week high", input.snapshot.fiftyTwoWeekHigh],
    ["52-week low", input.snapshot.fiftyTwoWeekLow],
  ].filter(([, value]) => !isFiniteNumber(value));
  if (technicalMissing.length > 0) {
    score -= 15;
    missingData.push(
      `Range/trend fields missing: ${technicalMissing
        .map(([label]) => label)
        .join(", ")}.`
    );
  }
  if (!input.fundamentals) {
    score -= 15;
    missingData.push("Recent fundamentals are missing.");
  }
  if (!isFiniteNumber(input.snapshot.avgVolume)) {
    score -= 10;
    missingData.push("Average volume is missing.");
  }
  const drift = input.warehouse?.verifyDeltaPct;
  if (isFiniteNumber(drift)) {
    const abs = Math.abs(drift);
    if (abs > 5) score -= 20;
    else if (abs >= 1) score -= 10;
  }

  return { score: clampScore(score), missingData };
}

function addPoint(
  dataPoints: string[],
  label: string,
  value: number | string | null | undefined,
  suffix = ""
) {
  if (value === null || value === undefined || value === "") return;
  if (typeof value === "number" && !Number.isFinite(value)) return;
  dataPoints.push(`${label}: ${value}${suffix}`);
}

function markMissing(
  missingData: string[],
  label: string,
  value: unknown
): boolean {
  const missing =
    value === null ||
    value === undefined ||
    (typeof value === "number" && !Number.isFinite(value));
  if (missing) missingData.push(label);
  return missing;
}

function businessQualityScore(input: DecisionEngineInput): ComponentDraft {
  const f = input.fundamentals;
  const dataPoints: string[] = [];
  const missingData: string[] = [];
  if (!f) {
    return {
      score: 50,
      rationale: "Fundamentals are unavailable, so business quality stays neutral.",
      dataPoints,
      missingData: ["Revenue, margins, ROE, debt, free cash flow, and net income."],
    };
  }

  let score = 50;
  if (!markMissing(missingData, "Gross margin.", f.grossMargin)) {
    addPoint(dataPoints, "Gross margin", pct(f.grossMargin));
    if (f.grossMargin! >= 0.6) score += 12;
    else if (f.grossMargin! >= 0.4) score += 8;
    else if (f.grossMargin! >= 0.25) score += 3;
    else if (f.grossMargin! < 0) score -= 12;
    else if (f.grossMargin! < 0.15) score -= 8;
  }
  if (!markMissing(missingData, "Operating margin.", f.operatingMargin)) {
    addPoint(dataPoints, "Operating margin", pct(f.operatingMargin));
    if (f.operatingMargin! >= 0.25) score += 10;
    else if (f.operatingMargin! >= 0.1) score += 5;
    else if (f.operatingMargin! < 0) score -= 12;
    else if (f.operatingMargin! < 0.05) score -= 6;
  }
  if (!markMissing(missingData, "Net margin.", f.netMargin)) {
    addPoint(dataPoints, "Net margin", pct(f.netMargin));
    if (f.netMargin! >= 0.2) score += 8;
    else if (f.netMargin! >= 0.08) score += 4;
    else if (f.netMargin! < 0) score -= 12;
    else if (f.netMargin! < 0.03) score -= 5;
  }
  if (!markMissing(missingData, "Return on equity.", f.roe)) {
    addPoint(dataPoints, "ROE", pct(f.roe));
    if (f.roe! >= 0.2) score += 10;
    else if (f.roe! >= 0.1) score += 5;
    else if (f.roe! < 0) score -= 10;
    else if (f.roe! < 0.05) score -= 5;
  }
  if (!markMissing(missingData, "Debt to equity.", f.debtToEquity)) {
    addPoint(dataPoints, "Debt/equity", f.debtToEquity?.toFixed(2));
    if (f.debtToEquity! <= 0.5) score += 8;
    else if (f.debtToEquity! <= 1.5) score += 2;
    else if (f.debtToEquity! > 3) score -= 12;
    else if (f.debtToEquity! > 2) score -= 8;
  }
  if (!markMissing(missingData, "Free cash flow.", f.freeCashFlow)) {
    addPoint(dataPoints, "Free cash flow", compactMoney(f.freeCashFlow));
    score += f.freeCashFlow! > 0 ? 10 : -14;
  }
  if (!markMissing(missingData, "Net income.", f.netIncome)) {
    addPoint(dataPoints, "Net income", compactMoney(f.netIncome));
    score += f.netIncome! > 0 ? 8 : -12;
  }
  if (!markMissing(missingData, "Revenue.", f.revenue)) {
    addPoint(dataPoints, "Revenue", compactMoney(f.revenue));
    score += f.revenue! > 0 ? 5 : -5;
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    rationale:
      finalScore >= 65
        ? "Profitability, cash flow, and balance sheet signals support business quality."
        : finalScore <= 40
          ? "Weak profitability, cash flow, or leverage signals reduce business quality."
          : "Business quality is mixed or only partly supported by available data.",
    dataPoints,
    missingData,
  };
}

function valuationScore(input: DecisionEngineInput): ComponentDraft {
  const dataPoints: string[] = [];
  const missingData: string[] = [];
  const s = input.snapshot;
  const w = input.warehouse;
  const pe = s.peRatio;
  const forwardPE = s.forwardPE;
  const ps = w?.priceToSales ?? null;
  const pb = w?.priceToBook ?? null;
  const evEbitda = w?.evToEbitda ?? null;
  const dividendYield = s.dividendYield;
  const analystTarget = s.analystTarget;
  const price = s.price;

  const valuationInputs = [pe, forwardPE, ps, pb, evEbitda, dividendYield];
  if (valuationInputs.every((v) => !isFiniteNumber(v))) {
    return {
      score: 50,
      rationale: "Valuation data is unavailable, so valuation stays neutral.",
      dataPoints,
      missingData: [
        "Trailing P/E, forward P/E, price/sales, price/book, EV/EBITDA, and dividend yield.",
      ],
    };
  }

  let score = 50;
  if (!markMissing(missingData, "Trailing P/E.", pe)) {
    addPoint(dataPoints, "Trailing P/E", pe?.toFixed(2));
    score += multipleScore(pe!, [15, 25, 40, 60], [10, 7, 0, -8, -15]);
  }
  if (!markMissing(missingData, "Forward P/E.", forwardPE)) {
    addPoint(dataPoints, "Forward P/E", forwardPE?.toFixed(2));
    score += multipleScore(forwardPE!, [15, 25, 40, 60], [10, 7, 0, -8, -15]);
  }
  if (!markMissing(missingData, "Price/sales.", ps)) {
    addPoint(dataPoints, "Price/sales", ps?.toFixed(2));
    score += multipleScore(ps!, [3, 8, 15, 25], [8, 2, -3, -10, -15]);
  }
  if (!markMissing(missingData, "Price/book.", pb)) {
    addPoint(dataPoints, "Price/book", pb?.toFixed(2));
    score += multipleScore(pb!, [3, 6, 10, 15], [5, 2, -3, -8, -12]);
  }
  if (!markMissing(missingData, "EV/EBITDA.", evEbitda)) {
    addPoint(dataPoints, "EV/EBITDA", evEbitda?.toFixed(2));
    score += multipleScore(evEbitda!, [12, 20, 30, 45], [8, 3, -3, -10, -15]);
  }
  if (!markMissing(missingData, "Dividend yield.", dividendYield)) {
    addPoint(dataPoints, "Dividend yield", pct(dividendYield));
    if (dividendYield! >= 0.015 && dividendYield! <= 0.06) score += 3;
    if (dividendYield! > 0.09) score -= 4;
  }
  if (
    isFiniteNumber(analystTarget) &&
    isFiniteNumber(price) &&
    price > 0
  ) {
    const upside = ((analystTarget - price) / price) * 100;
    addPoint(dataPoints, "Analyst target upside", `${upside.toFixed(1)}%`);
    if (upside >= 25) score += 8;
    else if (upside >= 10) score += 5;
    else if (upside <= -15) score -= 8;
    else if (upside <= -5) score -= 4;
  } else {
    missingData.push("Analyst target versus current price.");
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    rationale:
      finalScore >= 65
        ? "Valuation appears reasonable relative to the available multiples and target context."
        : finalScore <= 40
          ? "Valuation appears stretched or has limited target support."
          : "Valuation is balanced or incomplete.",
    dataPoints,
    missingData,
  };
}

function technicalTrendScore(input: DecisionEngineInput): ComponentDraft {
  const dataPoints: string[] = [];
  const missingData: string[] = [];
  const price = input.snapshot.price;
  const ma50 = input.snapshot.fiftyDayAvg;
  const ma200 = input.snapshot.twoHundredDayAvg;
  const rsi = input.warehouse?.rsi14 ?? null;
  const macd = input.warehouse?.macd ?? null;
  const macdSignal = input.warehouse?.macdSignal ?? null;
  const vwap = input.warehouse?.vwap20d ?? null;
  const relStrength = input.warehouse?.relStrengthSpy30d ?? null;
  const volume = input.snapshot.volume;
  const avgVolume = input.snapshot.avgVolume;
  let score = 50;

  if (!markMissing(missingData, "Price.", price)) {
    addPoint(dataPoints, "Price", `$${price?.toFixed(2)}`);
  }
  if (isFiniteNumber(price) && isFiniteNumber(ma200) && ma200 > 0) {
    const gap = pctChange(ma200, price) ?? 0;
    addPoint(dataPoints, "Price vs 200-day MA", `${gap.toFixed(1)}%`);
    score += price > ma200 ? 15 : -18;
    if (gap > 15) score += 5;
  } else {
    missingData.push("Price versus 200-day moving average.");
  }
  if (isFiniteNumber(price) && isFiniteNumber(ma50) && ma50 > 0) {
    const gap = pctChange(ma50, price) ?? 0;
    addPoint(dataPoints, "Price vs 50-day MA", `${gap.toFixed(1)}%`);
    score += price > ma50 ? 6 : -5;
  } else {
    missingData.push("Price versus 50-day moving average.");
  }
  if (isFiniteNumber(ma50) && isFiniteNumber(ma200) && ma200 > 0) {
    addPoint(
      dataPoints,
      "50-day MA vs 200-day MA",
      `${(((ma50 - ma200) / ma200) * 100).toFixed(1)}%`
    );
    score += ma50 > ma200 ? 10 : -10;
  } else {
    missingData.push("50-day versus 200-day moving average.");
  }
  if (!markMissing(missingData, "RSI 14-day.", rsi)) {
    addPoint(dataPoints, "RSI 14-day", rsi?.toFixed(1));
    if (rsi! >= 40 && rsi! <= 70) score += 8;
    else if (rsi! > 80) score -= 10;
    else if (rsi! < 30) score -= 10;
    else if (rsi! < 40) score -= 4;
    else if (rsi! > 70) score += 1;
  }
  if (isFiniteNumber(macd) && isFiniteNumber(macdSignal)) {
    addPoint(dataPoints, "MACD minus signal", (macd - macdSignal).toFixed(4));
    score += macd > macdSignal ? 6 : -6;
  } else {
    missingData.push("MACD and signal.");
  }
  if (isFiniteNumber(price) && isFiniteNumber(vwap)) {
    addPoint(
      dataPoints,
      "Price vs 20-day VWAP",
      `${(((price - vwap) / vwap) * 100).toFixed(1)}%`
    );
    score += price >= vwap ? 4 : -4;
  } else {
    missingData.push("20-day VWAP.");
  }
  if (!markMissing(missingData, "Relative strength versus SPY.", relStrength)) {
    addPoint(dataPoints, "Relative strength vs SPY 30d", `${relStrength?.toFixed(1)}%`);
    score += relStrength! > 0 ? 8 : -8;
    if (relStrength! > 5) score += 4;
  }
  if (
    isFiniteNumber(volume) &&
    isFiniteNumber(avgVolume) &&
    avgVolume > 0
  ) {
    const ratio = volume / avgVolume;
    addPoint(dataPoints, "Volume vs average", `${ratio.toFixed(2)}x`);
    if (ratio >= 1.2) score += 4;
    else if (ratio < 0.6) score -= 3;
  } else {
    missingData.push("Volume versus average volume.");
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    rationale:
      finalScore >= 65
        ? "Trend, momentum, and relative-strength signals are constructive."
        : finalScore <= 40
          ? "Trend or momentum signals are defensive."
          : "Trend evidence is mixed or incomplete.",
    dataPoints,
    missingData,
  };
}

function growthEarningsScore(input: DecisionEngineInput): ComponentDraft {
  const dataPoints: string[] = [];
  const missingData: string[] = [];
  const f = input.fundamentals;
  let score = 50;

  if (!f) {
    missingData.push("Revenue, EPS, net income, free cash flow, and analyst coverage.");
  } else {
    if (!markMissing(missingData, "Revenue.", f.revenue)) {
      addPoint(dataPoints, "Revenue", compactMoney(f.revenue));
      score += f.revenue! > 0 ? 8 : -6;
    }
    if (!markMissing(missingData, "Net income.", f.netIncome)) {
      addPoint(dataPoints, "Net income", compactMoney(f.netIncome));
      score += f.netIncome! > 0 ? 8 : -10;
    }
    if (!markMissing(missingData, "Free cash flow.", f.freeCashFlow)) {
      addPoint(dataPoints, "Free cash flow", compactMoney(f.freeCashFlow));
      score += f.freeCashFlow! > 0 ? 8 : -10;
    }
  }

  const eps = input.snapshot.eps;
  if (!markMissing(missingData, "EPS.", eps)) {
    addPoint(dataPoints, "EPS", eps?.toFixed(2));
    score += eps! > 0 ? 8 : -10;
  }
  const analystCount = input.warehouse?.analystCount ?? null;
  if (!markMissing(missingData, "Analyst coverage count.", analystCount)) {
    addPoint(dataPoints, "Analyst count", analystCount?.toFixed(0));
    if (analystCount! >= 10) score += 2;
  }
  const rating = (
    input.warehouse?.analystRating ??
    input.snapshot.recommendationKey ??
    ""
  ).toLowerCase();
  if (rating) {
    addPoint(dataPoints, "Analyst rating", rating);
    if (rating.includes("buy") || rating.includes("outperform")) score += 6;
    if (rating.includes("sell") || rating.includes("underperform")) score -= 6;
  } else {
    missingData.push("Analyst rating.");
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    rationale:
      finalScore >= 65
        ? "Earnings, cash flow, and coverage context support the growth case."
        : finalScore <= 40
          ? "Earnings, cash flow, or coverage context weaken the growth case."
          : "Growth and earnings signals are mixed or incomplete.",
    dataPoints,
    missingData,
  };
}

function sentimentNewsScore(input: DecisionEngineInput): ComponentDraft {
  const s = input.sentiment;
  const dataPoints: string[] = [];
  const missingData: string[] = [];
  if (!s || !isFiniteNumber(s.newsCount) || s.newsCount <= 0) {
    return {
      score: 50,
      rationale: "Recent news sentiment is unavailable, so this secondary signal stays neutral.",
      dataPoints,
      missingData: ["Recent sentiment/news count."],
    };
  }

  let score = 50;
  addPoint(dataPoints, "News count", s.newsCount.toFixed(0));
  if (!markMissing(missingData, "Bullish sentiment percent.", s.bullishPct)) {
    addPoint(dataPoints, "Bullish sentiment", pct(s.bullishPct));
  }
  if (!markMissing(missingData, "Bearish sentiment percent.", s.bearishPct)) {
    addPoint(dataPoints, "Bearish sentiment", pct(s.bearishPct));
  }
  if (isFiniteNumber(s.bullishPct) && isFiniteNumber(s.bearishPct)) {
    score += Math.max(-12, Math.min(12, (s.bullishPct - s.bearishPct) * 30));
  }
  if (!markMissing(missingData, "Company news score.", s.companyNewsScore)) {
    addPoint(dataPoints, "Company news score", s.companyNewsScore?.toFixed(2));
    score += s.companyNewsScore! * 12;
  }
  if (isFiniteNumber(s.companyNewsScore) && isFiniteNumber(s.sectorAvgScore)) {
    addPoint(
      dataPoints,
      "Company score vs sector",
      (s.companyNewsScore - s.sectorAvgScore).toFixed(2)
    );
    score += (s.companyNewsScore - s.sectorAvgScore) * 6;
  } else {
    missingData.push("Sector average news score.");
  }
  if (!markMissing(missingData, "Buzz ratio.", s.buzzRatio)) {
    addPoint(dataPoints, "Buzz ratio", s.buzzRatio?.toFixed(2));
    if (s.buzzRatio! > 2 && (s.companyNewsScore ?? 0) < -0.25) score -= 8;
    else if (s.buzzRatio! > 1.5 && (s.companyNewsScore ?? 0) > 0.25) score += 3;
  }

  const extremeNegative =
    (s.companyNewsScore ?? 0) < -0.75 && (s.bearishPct ?? 0) > 0.55;
  const extremePositive =
    (s.companyNewsScore ?? 0) > 0.75 && (s.bullishPct ?? 0) > 0.7;
  const bounded = extremeNegative
    ? Math.min(score, 20)
    : extremePositive
      ? Math.max(score, 80)
      : Math.max(25, Math.min(75, score));

  const finalScore = clampScore(bounded);
  return {
    score: finalScore,
    rationale:
      finalScore >= 60
        ? "Recent sentiment is supportive, but remains a secondary input."
        : finalScore <= 40
          ? "Recent sentiment adds caution."
          : "Recent sentiment is neutral or mixed.",
    dataPoints,
    missingData,
  };
}

function macroFitScore(input: DecisionEngineInput): ComponentDraft {
  const dataPoints: string[] = [];
  const missingData: string[] = [];
  const regime = input.macro?.regime ?? "INSUFFICIENT_DATA";
  const beta = input.snapshot.beta;
  let score = regimeBaseScore(regime);
  addPoint(dataPoints, "Market regime", regime);

  if (!markMissing(missingData, "Beta.", beta)) {
    addPoint(dataPoints, "Beta", beta?.toFixed(2));
    if (
      (regime === "HIGH_VOLATILITY_RISK_OFF" ||
        regime === "LIQUIDITY_STRESS") &&
      beta! > 1.5
    ) {
      score -= 12;
    }
    if (regime === "RATE_PRESSURE" && beta! > 1.4) score -= 8;
    if (regime === "RECESSION_RISK" && beta! < 0.9) score += 4;
  }

  const f = input.fundamentals;
  if (regime === "RECESSION_RISK") {
    if ((f?.freeCashFlow ?? 0) > 0) score += 6;
    if ((f?.debtToEquity ?? 9) <= 1) score += 4;
  }
  if (regime === "INSUFFICIENT_DATA") {
    missingData.push("Macro regime inputs.");
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    rationale:
      finalScore >= 60
        ? "Current macro regime is supportive for this risk profile."
        : finalScore <= 40
          ? "Current macro regime adds risk to this setup."
          : "Macro fit is mixed or cautious-neutral.",
    dataPoints,
    missingData,
  };
}

function insiderEventsScore(input: DecisionEngineInput): ComponentDraft {
  const e = input.events;
  const dataPoints: string[] = [];
  const missingData: string[] = [];
  if (!e) {
    return {
      score: 50,
      rationale: "Event context is unavailable, so this signal stays neutral.",
      dataPoints,
      missingData: ["Earnings, filings, major headlines, and insider context."],
    };
  }
  let score = 50;
  if (e.recentInsiderOfficerBuy) {
    score += 6;
    dataPoints.push("Recent officer open-market buy.");
  }
  if (e.recentInsiderClusterSell) {
    score -= 6;
    dataPoints.push("Recent clustered insider selling.");
  }
  if (e.earningsSoon) {
    score -= 5;
    dataPoints.push("Earnings soon.");
  }
  if (e.recentMaterialFiling) {
    score -= 8;
    dataPoints.push("Recent material filing.");
  }
  if (e.majorNegativeHeadline) {
    score -= 20;
    dataPoints.push("Major negative headline risk.");
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    rationale:
      finalScore >= 55
        ? "Known event context is not a major blocker."
        : finalScore <= 40
          ? "Upcoming or recent events add near-term caution."
          : "Event context is neutral to mildly cautious.",
    dataPoints,
    missingData,
  };
}

function multipleScore(
  value: number,
  thresholds: [number, number, number, number],
  scores: [number, number, number, number, number]
): number {
  if (value <= 0) return -10;
  if (value <= thresholds[0]) return scores[0];
  if (value <= thresholds[1]) return scores[1];
  if (value <= thresholds[2]) return scores[2];
  if (value <= thresholds[3]) return scores[3];
  return scores[4];
}

function regimeBaseScore(regime: MarketRegime): number {
  switch (regime) {
    case "RISK_ON":
      return 68;
    case "NEUTRAL":
      return 55;
    case "LATE_CYCLE_CAUTION":
      return 48;
    case "RATE_PRESSURE":
      return 45;
    case "LIQUIDITY_STRESS":
      return 35;
    case "RECESSION_RISK":
      return 40;
    case "HIGH_VOLATILITY_RISK_OFF":
      return 30;
    case "INSUFFICIENT_DATA":
      return 45;
  }
}

function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "N/A"
    : `${(value * 100).toFixed(1)}%`;
}

function compactMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}
