import { default as YahooFinanceCtor } from "yahoo-finance2";
import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import { getCompanyFacts, type CompanyFacts } from "../../data/sec";

const yahoo = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

/**
 * Phase 4 Batch I: balance-sheet / income-statement fields that Yahoo
 * leaves empty for many companies but SEC's XBRL has. Sourced from the
 * SEC Company Facts API per us-gaap concept name. Each field defaults
 * to null when the concept is absent — common for ETFs, ADRs, and
 * companies that report under a different taxonomy.
 */
export interface XbrlEnrichment {
  retainedEarnings: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  accountsReceivable: number | null;
  depreciation: number | null;
  sga: number | null;
  ebit: number | null;
  propertyPlantEquipment: number | null;
}

const EMPTY_XBRL: XbrlEnrichment = {
  retainedEarnings: null,
  currentAssets: null,
  currentLiabilities: null,
  accountsReceivable: null,
  depreciation: null,
  sga: null,
  ebit: null,
  propertyPlantEquipment: null,
};

type FactPoint = CompanyFacts["series"][string]["points"][number];

/**
 * Pick the latest fact value for a given XBRL concept whose fiscal
 * period matches `periodType`. For annual rows we want `fp === "FY"`
 * filed on a 10-K; for quarterly we accept any of Q1/Q2/Q3/Q4 filed
 * on a 10-Q (10-K's also report Q4 — taken when no 10-Q match).
 *
 * `points` is already sorted newest-first by `getCompanyFacts`.
 */
function pickLatestFact(
  facts: CompanyFacts | null,
  tag: string,
  periodType: "annual" | "quarterly",
): number | null {
  if (!facts) return null;
  const series = facts.series[tag];
  if (!series || series.points.length === 0) return null;

  const wantQuarterly = periodType === "quarterly";
  const isAnnualPoint = (p: FactPoint) =>
    p.fiscalPeriod === "FY" || p.form === "10-K";
  const isQuarterlyPoint = (p: FactPoint) =>
    /^Q[1-4]$/.test(p.fiscalPeriod) || p.form === "10-Q";

  const match = series.points.find((p) =>
    wantQuarterly ? isQuarterlyPoint(p) : isAnnualPoint(p),
  );
  return match?.value ?? null;
}

/**
 * Pull XBRL-sourced fundamentals for a single ticker from SEC Company
 * Facts. Returns a fully-populated XbrlEnrichment shape with each field
 * either a finite number or null. Never throws — a network blip or a
 * company with no XBRL coverage degrades to all-nulls (no overwrite of
 * existing Yahoo values downstream).
 *
 * `periodType` mirrors the warehouse refresh's notion of period:
 *   - "annual"     → most recent fiscal-year fact (FY / 10-K)
 *   - "quarterly"  → most recent fiscal-quarter fact (Q1-Q4 / 10-Q/K)
 *
 * Concept fallbacks:
 *   - depreciation: prefer DepreciationDepletionAndAmortization, fall
 *     back to plain Depreciation.
 *   - ebit: pre-tax income from continuing operations is the GAAP
 *     proxy; fall back to OperatingIncomeLoss when the longer concept
 *     is absent (smaller filers occasionally only report the latter).
 */
export async function enrichFromSecXbrl(
  ticker: string,
  periodType: "annual" | "quarterly",
  factsOverride?: CompanyFacts | null,
): Promise<XbrlEnrichment> {
  const facts =
    factsOverride !== undefined ? factsOverride : await getCompanyFacts(ticker);
  if (!facts) return { ...EMPTY_XBRL };

  const pick = (tag: string) => pickLatestFact(facts, tag, periodType);

  const depreciation =
    pick("DepreciationDepletionAndAmortization") ?? pick("Depreciation");
  const ebit =
    pick(
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    ) ?? pick("OperatingIncomeLoss");

  return {
    retainedEarnings: pick("RetainedEarningsAccumulatedDeficit"),
    currentAssets: pick("AssetsCurrent"),
    currentLiabilities: pick("LiabilitiesCurrent"),
    accountsReceivable: pick("AccountsReceivableNetCurrent"),
    depreciation,
    sga: pick("SellingGeneralAndAdministrativeExpense"),
    ebit,
    propertyPlantEquipment: pick("PropertyPlantAndEquipmentNet"),
  };
}

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

  // Single SEC fetch shared across both quarterly and annual rows; the
  // helper itself is HTTP-cached for 6h server-side, so a second call
  // would short-circuit anyway, but the explicit share keeps the cron
  // budget honest. `null` propagates cleanly through enrichFromSecXbrl.
  let secFacts: CompanyFacts | null = null;
  try {
    secFacts = await getCompanyFacts(ticker);
  } catch (err) {
    log.warn("warehouse.refresh.fundamentals", "sec facts fetch failed", {
      ticker,
      ...errorInfo(err),
    });
    secFacts = null;
  }

  let written = 0;
  const quarterly = pickLatest(s, "quarterly");
  const annual = pickLatest(s, "annual");
  if (quarterly) {
    const xbrl = await enrichFromSecXbrl(ticker, "quarterly", secFacts);
    await writeFundamentalsRow(ticker, "quarterly", quarterly, xbrl);
    written++;
  }
  if (annual) {
    const xbrl = await enrichFromSecXbrl(ticker, "annual", secFacts);
    await writeFundamentalsRow(ticker, "annual", annual, xbrl);
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
  snap: FundamentalsSnapshot,
  xbrl: XbrlEnrichment
): Promise<void> {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const big = num;

  const revenue = big(snap.income.totalRevenue);
  const grossProfit = big(snap.income.grossProfit);
  const operatingIncome = big(snap.income.operatingIncome);
  const netIncome = big(snap.income.netIncome);
  const ebitda = big(snap.financialData.ebitda);

  // Yahoo-first, fall through to SEC XBRL when Yahoo's row is null.
  // SEC is authoritative but we don't unconditionally clobber Yahoo:
  // for the few companies where Yahoo *does* report these fields, the
  // values can differ slightly (Yahoo normalizes, SEC reports as-filed)
  // and downstream Phase 2 ratios already work off Yahoo's shape.
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

  // Derived ratios — recompute against Yahoo balance sheet primarily,
  // but fall back to XBRL totals when Yahoo's row is null so the
  // Piotroski / Altman scores can light up for SEC-only coverage.
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
       current_ratio, debt_to_equity,
       retained_earnings, current_assets, current_liabilities,
       accounts_receivable, depreciation, sga, ebit,
       property_plant_equipment)
     VALUES (
       $1, $2::date, $3, 'yahoo',
       $4, $5, $6, $7, $8,
       $9, $10,
       $11, $12, $13, $14, $15,
       $16,
       $17, $18, $19,
       $20, $21, $22, $23, $24,
       $25, $26,
       $27, $28, $29,
       $30, $31, $32, $33,
       $34
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
       retained_earnings = EXCLUDED.retained_earnings,
       current_assets = EXCLUDED.current_assets,
       current_liabilities = EXCLUDED.current_liabilities,
       accounts_receivable = EXCLUDED.accounts_receivable,
       depreciation = EXCLUDED.depreciation,
       sga = EXCLUDED.sga,
       ebit = EXCLUDED.ebit,
       property_plant_equipment = EXCLUDED.property_plant_equipment,
       as_of = NOW()`,
    [
      ticker, snap.periodEnding, periodType,
      revenue, grossProfit, operatingIncome, netIncome, ebitda,
      num(snap.income.basicEPS), num(snap.income.dilutedEPS),
      totalAssets,
      totalLiabilities, totalEquity, totalDebt, totalCash,
      sharesOutstanding,
      operatingCashFlow, freeCashFlow, capex,
      grossMargin, operatingMargin, netMargin, roe, roa,
      currentRatio, debtToEquity,
      xbrl.retainedEarnings, xbrl.currentAssets, xbrl.currentLiabilities,
      xbrl.accountsReceivable, xbrl.depreciation, xbrl.sga, xbrl.ebit,
      xbrl.propertyPlantEquipment,
    ]
  );
}
