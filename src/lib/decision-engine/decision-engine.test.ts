import { describe, expect, it } from "vitest";
import {
  clampScore,
  runDecisionEngineForInput,
  type DecisionAction,
  type DecisionEngineInput,
} from ".";

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

  return {
    ticker: overrides.ticker ?? input.ticker,
    asOf: overrides.asOf ?? input.asOf,
    riskProfile: overrides.riskProfile ?? input.riskProfile,
    snapshot: { ...input.snapshot, ...overrides.snapshot },
    warehouse:
      overrides.warehouse === null
        ? null
        : { ...input.warehouse!, ...(overrides.warehouse ?? {}) },
    fundamentals:
      overrides.fundamentals === null
        ? null
        : { ...input.fundamentals!, ...(overrides.fundamentals ?? {}) },
    sentiment:
      overrides.sentiment === null
        ? null
        : { ...input.sentiment!, ...(overrides.sentiment ?? {}) },
    macro: overrides.macro
      ? {
          ...input.macro!,
          ...overrides.macro,
          regime: overrides.macro.regime ?? input.macro!.regime,
        }
      : input.macro,
    portfolio: overrides.portfolio
      ? {
          portfolioKnown:
            overrides.portfolio.portfolioKnown ??
            input.portfolio!.portfolioKnown,
          totalValue:
            overrides.portfolio.totalValue ?? input.portfolio!.totalValue,
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
      : input.portfolio,
    events: { ...input.events, ...overrides.events },
  };
}

describe("decision engine smoke coverage", () => {
  it("clamps score output", () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(105)).toBe(100);
  });

  it("returns insufficient data when price is missing", () => {
    const output = runDecisionEngineForInput(
      baseInput({ snapshot: { price: null } })
    );

    expect(output.action).toBe("INSUFFICIENT_DATA");
  });

  it("blocks when source drift is above 5%", () => {
    const output = runDecisionEngineForInput(
      baseInput({ warehouse: { verifyDeltaPct: 6 } })
    );

    expect(
      output.riskGates.some(
        (gate) => gate.id === "data_source_drift_block" && gate.triggered
      )
    ).toBe(true);
  });

  it("caps high-beta names in risk-off regimes", () => {
    const output = runDecisionEngineForInput(
      baseInput({
        snapshot: { beta: 1.8 },
        macro: { regime: "HIGH_VOLATILITY_RISK_OFF", vix: 34 },
      })
    );

    expect(actionRank(output.action)).toBeLessThanOrEqual(
      actionRank("HOLD_WATCH")
    );
  });

  it("warns on concentration thresholds", () => {
    const warning = runDecisionEngineForInput(
      baseInput({
        portfolio: { currentTickerPct: 30, currentTickerValue: 30_000 },
      })
    );
    const severe = runDecisionEngineForInput(
      baseInput({
        portfolio: { currentTickerPct: 45, currentTickerValue: 45_000 },
      })
    );

    expect(
      warning.riskGates.some(
        (gate) => gate.id === "portfolio_concentration_warn" && gate.triggered
      )
    ).toBe(true);
    expect(
      severe.riskGates.some(
        (gate) => gate.id === "portfolio_concentration_severe" && gate.triggered
      )
    ).toBe(true);
  });

  it("caps action when reward/risk is weak", () => {
    const output = runDecisionEngineForInput(
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

    expect(actionRank(output.action)).toBeLessThanOrEqual(
      actionRank("HOLD_WATCH")
    );
  });

  it("returns safe output without portfolio data", () => {
    const output = runDecisionEngineForInput(
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

    expect(output.positionSizing.portfolioKnown).toBe(false);
  });

  it("lowers confidence with sparse data", () => {
    const output = runDecisionEngineForInput(
      baseInput({
        warehouse: null,
        fundamentals: null,
        sentiment: null,
        macro: { regime: "INSUFFICIENT_DATA" },
      })
    );

    expect(output.confidence).toBe("LOW");
  });
});
