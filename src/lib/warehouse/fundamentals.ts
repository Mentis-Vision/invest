import { pool } from "../db";
import { log, errorInfo } from "../log";
import type {
  TickerFundamentalsRow,
  PeriodType,
  WarehouseSource,
} from "./types";

export async function getTickerFundamentals(
  ticker: string,
  opts?: { periodType?: PeriodType }
): Promise<TickerFundamentalsRow | null> {
  const pt = opts?.periodType ?? "quarterly";
  try {
    const { rows } = await pool.query(
      `SELECT * FROM "ticker_fundamentals"
       WHERE ticker = $1 AND period_type = $2
       ORDER BY period_ending DESC
       LIMIT 1`,
      [ticker.toUpperCase(), pt]
    );
    if (rows.length === 0) return null;
    return mapRow(rows[0] as Record<string, unknown>);
  } catch (err) {
    log.warn("warehouse.fundamentals", "getTickerFundamentals failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

function mapRow(r: Record<string, unknown>): TickerFundamentalsRow {
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  const big = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : null;
  const iso = (v: unknown): string =>
    v instanceof Date ? v.toISOString() : String(v);
  const dateOnly = (v: unknown): string =>
    v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

  return {
    ticker: String(r.ticker),
    periodEnding: dateOnly(r.period_ending),
    periodType: String(r.period_type) as PeriodType,
    filingAccession: str(r.filing_accession),
    reportedAt:
      r.reported_at === null || r.reported_at === undefined
        ? null
        : dateOnly(r.reported_at),
    asOf: iso(r.as_of),
    source: (String(r.source) as WarehouseSource) ?? "yahoo",
    revenue: big(r.revenue),
    grossProfit: big(r.gross_profit),
    operatingIncome: big(r.operating_income),
    netIncome: big(r.net_income),
    ebitda: big(r.ebitda),
    epsBasic: num(r.eps_basic),
    epsDiluted: num(r.eps_diluted),
    totalAssets: big(r.total_assets),
    totalLiabilities: big(r.total_liabilities),
    totalEquity: big(r.total_equity),
    totalDebt: big(r.total_debt),
    totalCash: big(r.total_cash),
    sharesOutstanding: big(r.shares_outstanding),
    operatingCashFlow: big(r.operating_cash_flow),
    freeCashFlow: big(r.free_cash_flow),
    capex: big(r.capex),
    grossMargin: num(r.gross_margin),
    operatingMargin: num(r.operating_margin),
    netMargin: num(r.net_margin),
    roe: num(r.roe),
    roa: num(r.roa),
    currentRatio: num(r.current_ratio),
    debtToEquity: num(r.debt_to_equity),
  };
}
