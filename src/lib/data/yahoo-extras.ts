import { default as YahooFinanceCtor } from "yahoo-finance2";
import { log, errorInfo } from "../log";

/**
 * Richer Yahoo Finance lookups used by the AI tool layer.
 * Separate from yahoo.ts so the core snapshot stays small.
 *
 * Every function returns sanitized, compact data suitable for inclusion
 * in a model's tool-result block. Keep fields concise — models don't
 * need every decimal place.
 */

const yahoo = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

export type FinancialsSummary = {
  ticker: string;
  asOf: string;
  source: "yahoo-finance";
  income?: {
    revenue: number | null;
    grossProfit: number | null;
    operatingIncome: number | null;
    netIncome: number | null;
    ebitda: number | null;
    period: string | null;
  };
  balanceSheet?: {
    totalAssets: number | null;
    totalLiabilities: number | null;
    totalEquity: number | null;
    totalDebt: number | null;
    totalCash: number | null;
    period: string | null;
  };
  cashFlow?: {
    operatingCashFlow: number | null;
    freeCashFlow: number | null;
    capex: number | null;
    period: string | null;
  };
  ratios?: {
    profitMargins: number | null;
    operatingMargins: number | null;
    returnOnEquity: number | null;
    returnOnAssets: number | null;
    debtToEquity: number | null;
    currentRatio: number | null;
    quickRatio: number | null;
  };
  notAvailable?: string;
};

export async function getFinancialsSummary(
  ticker: string
): Promise<FinancialsSummary> {
  const asOf = new Date().toISOString();
  try {
    const s = (await yahoo.quoteSummary(ticker, {
      modules: [
        "incomeStatementHistory",
        "balanceSheetHistory",
        "cashflowStatementHistory",
        "financialData",
        "defaultKeyStatistics",
      ],
    })) as unknown as {
      incomeStatementHistory?: {
        incomeStatementHistory?: Array<Record<string, unknown>>;
      };
      balanceSheetHistory?: {
        balanceSheetStatements?: Array<Record<string, unknown>>;
      };
      cashflowStatementHistory?: {
        cashflowStatements?: Array<Record<string, unknown>>;
      };
      financialData?: Record<string, unknown>;
      defaultKeyStatistics?: Record<string, unknown>;
    };

    const num = (v: unknown): number | null =>
      typeof v === "number" ? v : null;
    const endDate = (v: unknown): string | null => {
      if (!v) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === "string") return v.slice(0, 10);
      return null;
    };

    const income = s.incomeStatementHistory?.incomeStatementHistory?.[0];
    const balance = s.balanceSheetHistory?.balanceSheetStatements?.[0];
    const cash = s.cashflowStatementHistory?.cashflowStatements?.[0];
    const fd = s.financialData ?? {};

    return {
      ticker,
      asOf,
      source: "yahoo-finance",
      income: income
        ? {
            revenue: num(income.totalRevenue),
            grossProfit: num(income.grossProfit),
            operatingIncome: num(income.operatingIncome),
            netIncome: num(income.netIncome),
            ebitda: num(fd.ebitda),
            period: endDate(income.endDate),
          }
        : undefined,
      balanceSheet: balance
        ? {
            totalAssets: num(balance.totalAssets),
            totalLiabilities: num(balance.totalLiab),
            totalEquity: num(balance.totalStockholderEquity),
            totalDebt: num(fd.totalDebt),
            totalCash: num(fd.totalCash),
            period: endDate(balance.endDate),
          }
        : undefined,
      cashFlow: cash
        ? {
            operatingCashFlow:
              num(fd.operatingCashflow) ?? num(cash.totalCashFromOperatingActivities),
            freeCashFlow: num(fd.freeCashflow),
            capex: num(cash.capitalExpenditures),
            period: endDate(cash.endDate),
          }
        : undefined,
      ratios: {
        profitMargins: num(fd.profitMargins),
        operatingMargins: num(fd.operatingMargins),
        returnOnEquity: num(fd.returnOnEquity),
        returnOnAssets: num(fd.returnOnAssets),
        debtToEquity: num(fd.debtToEquity),
        currentRatio: num(fd.currentRatio),
        quickRatio: num(fd.quickRatio),
      },
      notAvailable:
        !income && !balance && !cash
          ? "No financial statement data returned for this ticker."
          : undefined,
    };
  } catch (err) {
    log.warn("yahoo-extras", "financials failed", {
      ticker,
      ...errorInfo(err),
    });
    return {
      ticker,
      asOf,
      source: "yahoo-finance",
      notAvailable: "Financial data unavailable.",
    };
  }
}

export type AnalystConsensus = {
  ticker: string;
  asOf: string;
  source: "yahoo-finance";
  recommendationKey: string | null;
  recommendationMean: number | null;
  numberOfAnalystOpinions: number | null;
  targetMean: number | null;
  targetMedian: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  upgradesDowngrades?: Array<{
    firm: string;
    date: string;
    fromGrade: string | null;
    toGrade: string | null;
    action: string | null;
  }>;
};

export async function getAnalystConsensus(
  ticker: string
): Promise<AnalystConsensus> {
  const asOf = new Date().toISOString();
  try {
    const s = (await yahoo.quoteSummary(ticker, {
      modules: ["financialData", "upgradeDowngradeHistory"],
    })) as unknown as {
      financialData?: Record<string, unknown>;
      upgradeDowngradeHistory?: {
        history?: Array<Record<string, unknown>>;
      };
    };
    const fd = s.financialData ?? {};
    const num = (v: unknown): number | null =>
      typeof v === "number" ? v : null;
    const str = (v: unknown): string | null =>
      typeof v === "string" ? v : null;

    const up = s.upgradeDowngradeHistory?.history ?? [];
    const upgradesDowngrades = up.slice(0, 8).map((h) => {
      const epoch = h.epochGradeDate;
      let dateStr = "";
      if (epoch instanceof Date) dateStr = epoch.toISOString().slice(0, 10);
      else if (typeof epoch === "number")
        dateStr = new Date(epoch * 1000).toISOString().slice(0, 10);
      else if (typeof epoch === "string") dateStr = epoch.slice(0, 10);
      return {
        firm: (h.firm as string) ?? "unknown",
        date: dateStr,
        fromGrade: str(h.fromGrade),
        toGrade: str(h.toGrade),
        action: str(h.action),
      };
    });

    return {
      ticker,
      asOf,
      source: "yahoo-finance",
      recommendationKey: str(fd.recommendationKey),
      recommendationMean: num(fd.recommendationMean),
      numberOfAnalystOpinions: num(fd.numberOfAnalystOpinions),
      targetMean: num(fd.targetMeanPrice),
      targetMedian: num(fd.targetMedianPrice),
      targetHigh: num(fd.targetHighPrice),
      targetLow: num(fd.targetLowPrice),
      upgradesDowngrades,
    };
  } catch (err) {
    log.warn("yahoo-extras", "analyst consensus failed", {
      ticker,
      ...errorInfo(err),
    });
    return {
      ticker,
      asOf,
      source: "yahoo-finance",
      recommendationKey: null,
      recommendationMean: null,
      numberOfAnalystOpinions: null,
      targetMean: null,
      targetMedian: null,
      targetHigh: null,
      targetLow: null,
    };
  }
}

export type NewsItem = {
  title: string;
  publisher: string | null;
  link: string | null;
  publishedAt: string | null;
  summary: string | null;
};

export async function getRecentNews(
  ticker: string,
  limit = 8
): Promise<{ ticker: string; items: NewsItem[]; asOf: string }> {
  const asOf = new Date().toISOString();
  try {
    const res = (await yahoo.search(ticker, {
      newsCount: limit,
      quotesCount: 0,
      enableNavLinks: false,
    })) as unknown as {
      news?: Array<Record<string, unknown>>;
    };

    const items: NewsItem[] = (res.news ?? []).slice(0, limit).map((n) => {
      const ts = n.providerPublishTime;
      let publishedAt: string | null = null;
      if (ts instanceof Date) publishedAt = ts.toISOString();
      else if (typeof ts === "number")
        publishedAt = new Date(ts * 1000).toISOString();
      else if (typeof ts === "string") publishedAt = ts;
      return {
        title: (n.title as string) ?? "(no title)",
        publisher: (n.publisher as string) ?? null,
        link: (n.link as string) ?? null,
        publishedAt,
        summary: (n.summary as string) ?? null,
      };
    });

    return { ticker, items, asOf };
  } catch (err) {
    log.warn("yahoo-extras", "news failed", { ticker, ...errorInfo(err) });
    return { ticker, items: [], asOf };
  }
}
