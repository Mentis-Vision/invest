import assert from "node:assert/strict";
import {
  clampScore,
  runDecisionEngineForInput,
  type DecisionEngineInput,
  type DecisionAction,
} from "../src/lib/decision-engine";

function actionRank(action: DecisionAction): number {
  const order: DecisionAction[] = [
    "AVOID",
    "REDUCE_REVIEW",
    "HOLD_WATCH",
    "BUY_CANDIDATE",
    "HIGH_CONVICTION_CANDIDATE",
  ];
  if (action === "INSUFFICIENT_DATA") return -1;
  return order.indexOf(action);
}

type DecisionInputOverrides = Omit<
  Partial<DecisionEngineInput>,
  | "snapshot"
  | "warehouse"
  | "fundamentals"
  | "sentiment"
  | "macro"
  | "portfolio"
  | "events"
> & {
  snapshot?: Partial<DecisionEngineInput["snapshot"]>;
  warehouse?: Partial<NonNullable<DecisionEngineInput["warehouse"]>> | null;
  fundamentals?:
    | Partial<NonNullable<DecisionEngineInput["fundamentals"]>>
    | null;
  sentiment?: Partial<NonNullable<DecisionEngineInput["sentiment"]>> | null;
  macro?: Partial<NonNullable<DecisionEngineInput["macro"]>>;
  portfolio?: Partial<NonNullable<DecisionEngineInput["portfolio"]>>;
  events?: Partial<NonNullable<DecisionEngineInput["events"]>>;
};

function baseInput(overrides: DecisionInputOverrides = {}): DecisionEngineInput {
  const input: DecisionEngineInput = {
    ticker: "ACME",
    asOf: "2026-04-29T00:00:00.000Z",
    riskProfile: "balanced",
    snapshot: {
      price: 100,
      marketCap: 50_000_000_000,
      peRatio: 24,
      forwardPE: 20,
      eps: 5,
      dividendYield: 0.01,
      fiftyTwoWeekHigh: 125,
      fiftyTwoWeekLow: 75,
      fiftyDayAvg: 104,
      twoHundredDayAvg: 90,
      volume: 2_000_000,
      avgVolume: 1_800_000,
      beta: 1.1,
      sector: "Technology",
      industry: "Software",
      analystTarget: 145,
      recommendationKey: "buy",
    },
    warehouse: {
      verifyDeltaPct: 0.2,
      verifyClose: 100.2,
      verifySource: "alpha_vantage",
      rsi14: 58,
      macd: 1.2,
      macdSignal: 0.8,
      vwap20d: 99,
      relStrengthSpy30d: 4,
      shortInterestPct: 0.02,
      priceToBook: 4,
      priceToSales: 5,
      evToEbitda: 18,
      analystCount: 22,
      analystRating: "buy",
    },
    fundamentals: {
      revenue: 10_000_000_000,
      grossMargin: 0.62,
      operatingMargin: 0.24,
      netMargin: 0.18,
      roe: 0.22,
      debtToEquity: 0.6,
      freeCashFlow: 1_200_000_000,
      netIncome: 1_000_000_000,
      periodEnding: "2026-03-31",
    },
    sentiment: {
      bullishPct: 0.58,
      bearishPct: 0.18,
      buzzRatio: 1.1,
      companyNewsScore: 0.3,
      sectorAvgScore: 0.1,
      newsCount: 12,
    },
    macro: {
      regime: "RISK_ON",
      vix: 16,
      tenYearYield: 4.2,
      twoYearYield: 4.0,
      fedFunds: 4.25,
      cpiTrend: "falling",
      unemploymentTrend: "flat",
    },
    portfolio: {
      portfolioKnown: true,
      totalValue: 100_000,
      currentTickerValue: 2_000,
      currentTickerPct: 2,
      sectorExposurePct: 15,
    },
    events: {
      earningsSoon: false,
      recentMaterialFiling: false,
      recentInsiderOfficerBuy: false,
      recentInsiderClusterSell: false,
      majorNegativeHeadline: false,
    },
  };

  const macro: DecisionEngineInput["macro"] = overrides.macro
    ? {
        ...input.macro!,
        ...overrides.macro,
        regime: overrides.macro.regime ?? input.macro!.regime,
      }
    : input.macro;
  const portfolio: DecisionEngineInput["portfolio"] = overrides.portfolio
    ? {
        portfolioKnown:
          overrides.portfolio.portfolioKnown ??
          input.portfolio!.portfolioKnown,
        totalValue: overrides.portfolio.totalValue ?? input.portfolio!.totalValue,
        currentTickerValue:
          overrides.portfolio.currentTickerValue ??
          input.portfolio!.currentTickerValue,
        currentTickerPct:
          overrides.portfolio.currentTickerPct ??
          input.portfolio!.currentTickerPct,
        sectorExposurePct:
          overrides.portfolio.sectorExposurePct ??
          input.portfolio!.sectorExposurePct,
      }
    : input.portfolio;
  const warehouse =
    overrides.warehouse === null
      ? null
      : { ...input.warehouse!, ...(overrides.warehouse ?? {}) };
  const fundamentals =
    overrides.fundamentals === null
      ? null
      : { ...input.fundamentals!, ...(overrides.fundamentals ?? {}) };
  const sentiment =
    overrides.sentiment === null
      ? null
      : { ...input.sentiment!, ...(overrides.sentiment ?? {}) };

  return {
    ticker: overrides.ticker ?? input.ticker,
    asOf: overrides.asOf ?? input.asOf,
    riskProfile: overrides.riskProfile ?? input.riskProfile,
    snapshot: { ...input.snapshot, ...overrides.snapshot },
    warehouse,
    fundamentals,
    sentiment,
    macro,
    portfolio,
    events: { ...input.events, ...overrides.events },
  };
}

assert.equal(clampScore(-5), 0);
assert.equal(clampScore(105), 100);

const missingPrice = runDecisionEngineForInput(
  baseInput({ snapshot: { price: null } })
);
assert.equal(missingPrice.action, "INSUFFICIENT_DATA");

const sourceDrift = runDecisionEngineForInput(
  baseInput({ warehouse: { verifyDeltaPct: 6 } })
);
assert.equal(
  sourceDrift.riskGates.some(
    (gate) => gate.id === "data_source_drift_block" && gate.triggered
  ),
  true
);

const riskOffHighBeta = runDecisionEngineForInput(
  baseInput({
    snapshot: { beta: 1.8 },
    macro: { regime: "HIGH_VOLATILITY_RISK_OFF", vix: 34 },
  })
);
assert.ok(actionRank(riskOffHighBeta.action) <= actionRank("HOLD_WATCH"));

const concentrationWarn = runDecisionEngineForInput(
  baseInput({ portfolio: { currentTickerPct: 30, currentTickerValue: 30_000 } })
);
assert.equal(
  concentrationWarn.riskGates.some(
    (gate) => gate.id === "portfolio_concentration_warn" && gate.triggered
  ),
  true
);

const concentrationSevere = runDecisionEngineForInput(
  baseInput({ portfolio: { currentTickerPct: 45, currentTickerValue: 45_000 } })
);
assert.equal(
  concentrationSevere.riskGates.some(
    (gate) => gate.id === "portfolio_concentration_severe" && gate.triggered
  ),
  true
);

const weakRewardRisk = runDecisionEngineForInput(
  baseInput({
    snapshot: {
      price: 100,
      twoHundredDayAvg: 70,
      fiftyDayAvg: 105,
      analystTarget: 120,
    },
    warehouse: { vwap20d: 101 },
  })
);
assert.ok(actionRank(weakRewardRisk.action) <= actionRank("HOLD_WATCH"));

const noPortfolio = runDecisionEngineForInput(
  baseInput({
    portfolio: {
      portfolioKnown: false,
      totalValue: null,
      currentTickerValue: null,
      currentTickerPct: null,
      sectorExposurePct: null,
    },
  })
);
assert.equal(noPortfolio.positionSizing.portfolioKnown, false);

const sparse = runDecisionEngineForInput(
  baseInput({
    warehouse: null,
    fundamentals: null,
    sentiment: null,
    macro: { regime: "INSUFFICIENT_DATA" },
  })
);
assert.equal(sparse.confidence, "LOW");

console.log("decision-engine smoke checks passed");
