import { pool } from "../db";
import { errorInfo, log } from "../log";
import type { StockSnapshot } from "../data/yahoo";
import {
  getRecentEvents,
  getTickerFundamentals,
  getTickerMarket,
  getTickerSentiment,
  getUpcomingEvents,
} from "../warehouse";
import { classifyMarketRegime } from "./regime";
import type {
  DecisionEngineInput,
  MarketRegime,
  RiskProfile,
} from "./types";
import { isFiniteNumber } from "./utils";

export function normalizeRiskProfile(value: unknown): RiskProfile {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "low" || normalized === "conservative") {
    return "conservative";
  }
  if (normalized === "high" || normalized === "aggressive") {
    return "aggressive";
  }
  return "balanced";
}

export async function buildDecisionEngineInput(args: {
  userId: string;
  ticker: string;
  snapshot: StockSnapshot;
  macroRaw?: unknown;
  riskProfileHint?: string | null;
}): Promise<DecisionEngineInput> {
  const ticker = args.ticker.toUpperCase();
  const [market, fundamentals, sentiment, upcomingEvents, recentEvents, portfolio] =
    await Promise.all([
      getTickerMarket(ticker),
      getTickerFundamentals(ticker),
      getTickerSentiment(ticker),
      getUpcomingEvents(ticker, { windowDays: 14 }).catch(() => []),
      getRecentEvents(ticker, { windowDays: 30 }).catch(() => []),
      getPortfolioContext(args.userId, ticker, args.snapshot.sector),
    ]);

  const macroParsed = parseMacro(args.macroRaw);
  const regime =
    macroParsed.regime ??
    classifyMarketRegime({
      vix: macroParsed.vix,
      tenYearYield: macroParsed.tenYearYield,
      twoYearYield: macroParsed.twoYearYield,
      fedFunds: macroParsed.fedFunds,
      cpiTrend: macroParsed.cpiTrend,
      unemploymentTrend: macroParsed.unemploymentTrend,
    });

  const earningsSoon = upcomingEvents.some((event) => {
    if (event.eventType !== "earnings") return false;
    const days = daysUntil(event.eventDate);
    return days != null && days >= 0 && days <= 7;
  });
  const recentMaterialFiling = recentEvents.some((event) =>
    ["filing_8k", "filing_10q", "filing_10k"].includes(event.eventType)
  );
  const majorNegativeHeadline =
    (sentiment?.newsCount ?? 0) >= 3 &&
    isFiniteNumber(sentiment?.companyNewsScore) &&
    sentiment.companyNewsScore <= -0.6;

  return {
    ticker,
    asOf: args.snapshot.asOf,
    riskProfile: normalizeRiskProfile(args.riskProfileHint),
    snapshot: {
      price: finiteOrNull(args.snapshot.price),
      marketCap: finiteOrNull(market?.marketCap ?? args.snapshot.marketCap),
      peRatio: finiteOrNull(market?.peTrailing ?? args.snapshot.peRatio),
      forwardPE: finiteOrNull(market?.peForward ?? args.snapshot.forwardPE),
      eps: finiteOrNull(market?.epsTtm ?? args.snapshot.eps),
      dividendYield: finiteOrNull(
        market?.dividendYield ?? args.snapshot.dividendYield
      ),
      fiftyTwoWeekHigh: finiteOrNull(
        market?.high52w ?? args.snapshot.fiftyTwoWeekHigh
      ),
      fiftyTwoWeekLow: finiteOrNull(
        market?.low52w ?? args.snapshot.fiftyTwoWeekLow
      ),
      fiftyDayAvg: finiteOrNull(market?.ma50 ?? args.snapshot.fiftyDayAvg),
      twoHundredDayAvg: finiteOrNull(
        market?.ma200 ?? args.snapshot.twoHundredDayAvg
      ),
      volume: finiteOrNull(args.snapshot.volume),
      avgVolume: finiteOrNull(args.snapshot.avgVolume),
      beta: finiteOrNull(market?.beta ?? args.snapshot.beta),
      sector: args.snapshot.sector,
      industry: args.snapshot.industry,
      analystTarget: finiteOrNull(
        market?.analystTargetMean ?? args.snapshot.analystTarget
      ),
      recommendationKey:
        market?.analystRating ?? args.snapshot.recommendationKey ?? null,
    },
    warehouse: market
      ? {
          verifyDeltaPct: finiteOrNull(market.verifyDeltaPct),
          verifyClose: finiteOrNull(market.verifyClose),
          verifySource: market.verifySource,
          rsi14: finiteOrNull(market.rsi14),
          macd: finiteOrNull(market.macd),
          macdSignal: finiteOrNull(market.macdSignal),
          vwap20d: finiteOrNull(market.vwap20d),
          relStrengthSpy30d: finiteOrNull(market.relStrengthSpy30d),
          shortInterestPct: finiteOrNull(market.shortInterestPct),
          priceToBook: finiteOrNull(market.priceToBook),
          priceToSales: finiteOrNull(market.priceToSales),
          evToEbitda: finiteOrNull(market.evToEbitda),
          analystCount: finiteOrNull(market.analystCount),
          analystRating: market.analystRating,
        }
      : null,
    fundamentals: fundamentals
      ? {
          revenue: finiteOrNull(fundamentals.revenue),
          grossMargin: finiteOrNull(fundamentals.grossMargin),
          operatingMargin: finiteOrNull(fundamentals.operatingMargin),
          netMargin: finiteOrNull(fundamentals.netMargin),
          roe: finiteOrNull(fundamentals.roe),
          debtToEquity: finiteOrNull(fundamentals.debtToEquity),
          freeCashFlow: finiteOrNull(fundamentals.freeCashFlow),
          netIncome: finiteOrNull(fundamentals.netIncome),
          periodEnding: fundamentals.periodEnding,
        }
      : null,
    sentiment: sentiment
      ? {
          bullishPct: finiteOrNull(sentiment.bullishPct),
          bearishPct: finiteOrNull(sentiment.bearishPct),
          buzzRatio: finiteOrNull(sentiment.buzzRatio),
          companyNewsScore: finiteOrNull(sentiment.companyNewsScore),
          sectorAvgScore: finiteOrNull(sentiment.sectorAvgScore),
          newsCount: sentiment.newsCount,
        }
      : null,
    macro: {
      regime,
      vix: macroParsed.vix,
      tenYearYield: macroParsed.tenYearYield,
      twoYearYield: macroParsed.twoYearYield,
      fedFunds: macroParsed.fedFunds,
      cpiTrend: macroParsed.cpiTrend,
      unemploymentTrend: macroParsed.unemploymentTrend,
    },
    portfolio,
    events: {
      earningsSoon,
      recentMaterialFiling,
      recentInsiderOfficerBuy: false,
      recentInsiderClusterSell: false,
      majorNegativeHeadline,
    },
  };
}

async function getPortfolioContext(
  userId: string,
  ticker: string,
  sector: string | null
): Promise<DecisionEngineInput["portfolio"]> {
  try {
    const { rows } = await pool.query<{
      ticker: string;
      sector: string | null;
      value: number | string | null;
    }>(
      `SELECT ticker,
              sector,
              COALESCE("lastValue", shares * COALESCE("lastPrice", "avgPrice", 0))::float AS value
         FROM "holding"
        WHERE "userId" = $1`,
      [userId]
    );
    if (rows.length === 0) return unknownPortfolio();

    let totalValue = 0;
    let currentTickerValue = 0;
    let sectorValue = 0;
    for (const row of rows) {
      const value = Number(row.value ?? 0);
      if (!Number.isFinite(value) || value <= 0) continue;
      totalValue += value;
      if (row.ticker.toUpperCase() === ticker) currentTickerValue += value;
      if (sector && row.sector === sector) sectorValue += value;
    }

    if (totalValue <= 0) return unknownPortfolio();
    return {
      portfolioKnown: true,
      totalValue,
      currentTickerValue,
      currentTickerPct: (currentTickerValue / totalValue) * 100,
      sectorExposurePct:
        sector && sectorValue > 0 ? (sectorValue / totalValue) * 100 : null,
    };
  } catch (err) {
    log.warn("decision-engine", "portfolio context unavailable", {
      ticker,
      ...errorInfo(err),
    });
    return unknownPortfolio();
  }
}

function unknownPortfolio(): NonNullable<DecisionEngineInput["portfolio"]> {
  return {
    portfolioKnown: false,
    totalValue: null,
    currentTickerValue: null,
    currentTickerPct: null,
    sectorExposurePct: null,
  };
}

function parseMacro(raw: unknown): {
  regime: MarketRegime | null;
  vix: number | null;
  tenYearYield: number | null;
  twoYearYield: number | null;
  fedFunds: number | null;
  cpiTrend: "rising" | "falling" | "flat" | "unknown";
  unemploymentTrend: "rising" | "falling" | "flat" | "unknown";
} {
  if (!Array.isArray(raw)) {
    return {
      regime: null,
      vix: null,
      tenYearYield: null,
      twoYearYield: null,
      fedFunds: null,
      cpiTrend: "unknown",
      unemploymentTrend: "unknown",
    };
  }

  const findValue = (needle: string): number | null => {
    const row = raw.find(
      (item) =>
        item &&
        typeof item === "object" &&
        String((item as Record<string, unknown>).indicator ?? "")
          .toLowerCase()
          .includes(needle)
    ) as Record<string, unknown> | undefined;
    if (!row) return null;
    return parseNumber(row.value);
  };

  const trend = (
    needle: string
  ): "rising" | "falling" | "flat" | "unknown" => {
    const row = raw.find(
      (item) =>
        item &&
        typeof item === "object" &&
        String((item as Record<string, unknown>).indicator ?? "")
          .toLowerCase()
          .includes(needle)
    ) as Record<string, unknown> | undefined;
    if (!row) return "unknown";
    const deltaLabel = String(row.deltaLabel ?? "");
    const match = deltaLabel.match(/([+-]?\d+(?:\.\d+)?)/);
    if (match) {
      const delta = Number(match[1]);
      if (delta > 0.1) return "rising";
      if (delta < -0.1) return "falling";
      return "flat";
    }
    const series = row.trend12mo;
    if (Array.isArray(series) && series.length >= 2) {
      const first = parseNumber((series[0] as Record<string, unknown>).value);
      const last = parseNumber(
        (series[series.length - 1] as Record<string, unknown>).value
      );
      if (first != null && last != null) {
        const delta = last - first;
        if (delta > 0.1) return "rising";
        if (delta < -0.1) return "falling";
        return "flat";
      }
    }
    return "unknown";
  };

  return {
    regime: null,
    vix: findValue("vix"),
    tenYearYield: findValue("10-year"),
    twoYearYield: findValue("2-year"),
    fedFunds: findValue("fed funds"),
    cpiTrend: trend("cpi"),
    unemploymentTrend: trend("unemployment"),
  };
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[%,$]/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function daysUntil(dateOnly: string): number | null {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  return Math.floor((d.getTime() - today.getTime()) / 86_400_000);
}
