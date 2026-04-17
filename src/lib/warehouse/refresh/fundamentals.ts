import { default as YahooFinanceCtor } from "yahoo-finance2";
import { pool } from "../../db";
import { log, errorInfo } from "../../log";

const yahoo = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

export type FundamentalsRefreshResult = {
  attempted: number;
  written: number;
  skipped: number;
  failed: Array<{ ticker: string; error: string }>;
};

/**
 * For each ticker, fetch Yahoo quoteSummary's incomeStatementHistory +
 * balanceSheetHistory + cashflowStatementHistory and write the most
 * recent quarterly AND most recent annual period. Idempotent:
 * PRIMARY KEY (ticker, period_ending, period_type).
 */
export async function refreshFundamentals(
  tickers: string[]
): Promise<FundamentalsRefreshResult> {
  const attempted = tickers.length;
  let written = 0;
  let skipped = 0;
  const failed: FundamentalsRefreshResult["failed"] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const ticker = tickers[idx].toUpperCase();
      try {
        const added = await refreshOne(ticker);
        written += added;
        if (added === 0) skipped++;
      } catch (err) {
        failed.push({
          ticker,
          error: err instanceof Error ? err.message : "unknown",
        });
        log.warn("warehouse.refresh.fundamentals", "ticker failed", {
          ticker,
          ...errorInfo(err),
        });
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(3, tickers.length) },
    () => worker()
  );
  await Promise.all(workers);

  return { attempted, written, skipped, failed };
}

async function refreshOne(ticker: string): Promise<number> {
  const s = (await yahoo.quoteSummary(ticker, {
    modules: [
      "incomeStatementHistoryQuarterly",
      "incomeStatementHistory",
      "balanceSheetHistoryQuarterly",
      "balanceSheetHistory",
      "cashflowStatementHistoryQuarterly",
      "cashflowStatementHistory",
      "financialData",
      "defaultKeyStatistics",
    ],
  })) as unknown as Record<string, unknown>;

  let written = 0;
  const quarterly = pickLatest(s, "quarterly");
  const annual = pickLatest(s, "annual");
  if (quarterly) {
    await writeFundamentalsRow(ticker, "quarterly", quarterly);
    written++;
  }
  if (annual) {
    await writeFundamentalsRow(ticker, "annual", annual);
    written++;
  }
  return written;
}

type FundamentalsSnapshot = {
  periodEnding: string;
  income: Record<string, unknown>;
  balance: Record<string, unknown>;
  cash: Record<string, unknown>;
  financialData: Record<string, unknown>;
  keyStats: Record<string, unknown>;
};

function pickLatest(
  s: Record<string, unknown>,
  period: "quarterly" | "annual"
): FundamentalsSnapshot | null {
  const incomeKey =
    period === "quarterly"
      ? "incomeStatementHistoryQuarterly"
      : "incomeStatementHistory";
  const balanceKey =
    period === "quarterly"
      ? "balanceSheetHistoryQuarterly"
      : "balanceSheetHistory";
  const cashKey =
    period === "quarterly"
      ? "cashflowStatementHistoryQuarterly"
      : "cashflowStatementHistory";

  const incomeList =
    ((s[incomeKey] as Record<string, unknown>)?.incomeStatementHistory as
      | Array<Record<string, unknown>>
      | undefined) ?? [];
  const balanceList =
    ((s[balanceKey] as Record<string, unknown>)
      ?.balanceSheetStatements as Array<Record<string, unknown>> | undefined) ??
    [];
  const cashList =
    ((s[cashKey] as Record<string, unknown>)?.cashflowStatements as
      | Array<Record<string, unknown>>
      | undefined) ?? [];

  if (!incomeList.length) return null;
  const income = incomeList[0];
  const balance = balanceList[0] ?? {};
  const cash = cashList[0] ?? {};

  const endDate = endDateOf(income);
  if (!endDate) return null;

  return {
    periodEnding: endDate,
    income,
    balance,
    cash,
    financialData: (s.financialData as Record<string, unknown>) ?? {},
    keyStats: (s.defaultKeyStatistics as Record<string, unknown>) ?? {},
  };
}

function endDateOf(obj: Record<string, unknown>): string | null {
  const v = obj.endDate;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.slice(0, 10);
  return null;
}

async function writeFundamentalsRow(
  ticker: string,
  periodType: "quarterly" | "annual",
  snap: FundamentalsSnapshot
): Promise<void> {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const big = num;

  const revenue = big(snap.income.totalRevenue);
  const grossProfit = big(snap.income.grossProfit);
  const operatingIncome = big(snap.income.operatingIncome);
  const netIncome = big(snap.income.netIncome);
  const ebitda = big(snap.financialData.ebitda);

  const totalAssets = big(snap.balance.totalAssets);
  const totalLiabilities = big(snap.balance.totalLiab);
  const totalEquity = big(snap.balance.totalStockholderEquity);
  const totalDebt = big(snap.financialData.totalDebt);
  const totalCash = big(snap.financialData.totalCash);
  const sharesOutstanding = big(snap.keyStats.sharesOutstanding);

  const operatingCashFlow =
    big(snap.financialData.operatingCashflow) ??
    big(snap.cash.totalCashFromOperatingActivities);
  const freeCashFlow = big(snap.financialData.freeCashflow);
  const capex = big(snap.cash.capitalExpenditures);

  // Derived ratios
  const ratio = (n: number | null, d: number | null): number | null =>
    n != null && d != null && d !== 0 ? n / d : null;
  const grossMargin = ratio(grossProfit, revenue);
  const operatingMargin = ratio(operatingIncome, revenue);
  const netMargin = ratio(netIncome, revenue);
  const roe = ratio(netIncome, totalEquity);
  const roa = ratio(netIncome, totalAssets);
  const currentRatio = num(snap.financialData.currentRatio);
  const debtToEquity = num(snap.financialData.debtToEquity);

  await pool.query(
    `INSERT INTO "ticker_fundamentals"
      (ticker, period_ending, period_type, source,
       revenue, gross_profit, operating_income, net_income, ebitda,
       eps_basic, eps_diluted,
       total_assets, total_liabilities, total_equity, total_debt, total_cash,
       shares_outstanding,
       operating_cash_flow, free_cash_flow, capex,
       gross_margin, operating_margin, net_margin, roe, roa,
       current_ratio, debt_to_equity)
     VALUES (
       $1, $2::date, $3, 'yahoo',
       $4, $5, $6, $7, $8,
       $9, $10,
       $11, $12, $13, $14, $15,
       $16,
       $17, $18, $19,
       $20, $21, $22, $23, $24,
       $25, $26
     )
     ON CONFLICT (ticker, period_ending, period_type) DO UPDATE SET
       revenue = EXCLUDED.revenue, gross_profit = EXCLUDED.gross_profit,
       operating_income = EXCLUDED.operating_income,
       net_income = EXCLUDED.net_income, ebitda = EXCLUDED.ebitda,
       eps_basic = EXCLUDED.eps_basic, eps_diluted = EXCLUDED.eps_diluted,
       total_assets = EXCLUDED.total_assets,
       total_liabilities = EXCLUDED.total_liabilities,
       total_equity = EXCLUDED.total_equity,
       total_debt = EXCLUDED.total_debt, total_cash = EXCLUDED.total_cash,
       shares_outstanding = EXCLUDED.shares_outstanding,
       operating_cash_flow = EXCLUDED.operating_cash_flow,
       free_cash_flow = EXCLUDED.free_cash_flow, capex = EXCLUDED.capex,
       gross_margin = EXCLUDED.gross_margin,
       operating_margin = EXCLUDED.operating_margin,
       net_margin = EXCLUDED.net_margin,
       roe = EXCLUDED.roe, roa = EXCLUDED.roa,
       current_ratio = EXCLUDED.current_ratio,
       debt_to_equity = EXCLUDED.debt_to_equity,
       as_of = NOW()`,
    [
      ticker, snap.periodEnding, periodType,
      revenue, grossProfit, operatingIncome, netIncome, ebitda,
      num(snap.income.basicEPS), num(snap.income.dilutedEPS),
      totalAssets, totalLiabilities, totalEquity, totalDebt, totalCash,
      sharesOutstanding,
      operatingCashFlow, freeCashFlow, capex,
      grossMargin, operatingMargin, netMargin, roe, roa,
      currentRatio, debtToEquity,
    ]
  );
}
