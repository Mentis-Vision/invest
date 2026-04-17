import { pool } from "../db";
import { log, errorInfo } from "../log";
import type { TickerMarketRow, WarehouseSource } from "./types";

/**
 * Read the most-recent daily row for a ticker.
 * Returns null if we've never captured it — caller should decide whether
 * to trigger warmTickerMarket or fall back to live Yahoo.
 */
export async function getTickerMarket(
  ticker: string
): Promise<TickerMarketRow | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM "ticker_market_daily"
       WHERE ticker = $1
       ORDER BY captured_at DESC
       LIMIT 1`,
      [ticker.toUpperCase()]
    );
    if (rows.length === 0) return null;
    return mapRow(rows[0] as Record<string, unknown>);
  } catch (err) {
    log.warn("warehouse.market", "getTickerMarket failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

/**
 * Batch read — used by portfolio review + dashboard.
 * Returns a Map keyed by ticker (uppercase). Tickers with no row are absent.
 */
export async function getTickerMarketBatch(
  tickers: string[]
): Promise<Map<string, TickerMarketRow>> {
  const out = new Map<string, TickerMarketRow>();
  if (tickers.length === 0) return out;
  const upper = tickers.map((t) => t.toUpperCase());
  try {
    // For each ticker, grab only its latest row using DISTINCT ON.
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (ticker) *
       FROM "ticker_market_daily"
       WHERE ticker = ANY($1)
       ORDER BY ticker, captured_at DESC`,
      [upper]
    );
    for (const r of rows) {
      const row = mapRow(r as Record<string, unknown>);
      out.set(row.ticker, row);
    }
  } catch (err) {
    log.warn("warehouse.market", "getTickerMarketBatch failed", {
      count: tickers.length,
      ...errorInfo(err),
    });
  }
  return out;
}

/**
 * Convert a raw row into the typed shape. Snake_case → camelCase.
 * Numeric columns come back as strings from pg when NUMERIC — coerce.
 */
function mapRow(r: Record<string, unknown>): TickerMarketRow {
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : null;
  const iso = (v: unknown): string =>
    v instanceof Date ? v.toISOString() : String(v);

  return {
    ticker: String(r.ticker),
    capturedAt:
      r.captured_at instanceof Date
        ? r.captured_at.toISOString().slice(0, 10)
        : String(r.captured_at).slice(0, 10),
    asOf: iso(r.as_of),
    source: (String(r.source) as WarehouseSource) ?? "yahoo",
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    close: num(r.close),
    volume: r.volume === null ? null : Number(r.volume),
    changePct: num(r.change_pct),
    ma50: num(r.ma_50),
    ma200: num(r.ma_200),
    bollingerUpper: num(r.bollinger_upper),
    bollingerLower: num(r.bollinger_lower),
    vwap20d: num(r.vwap_20d),
    high52w: num(r.high_52w),
    low52w: num(r.low_52w),
    beta: num(r.beta),
    marketCap: r.market_cap === null ? null : Number(r.market_cap),
    peTrailing: num(r.pe_trailing),
    peForward: num(r.pe_forward),
    priceToBook: num(r.price_to_book),
    priceToSales: num(r.price_to_sales),
    evToEbitda: num(r.ev_to_ebitda),
    dividendYield: num(r.dividend_yield),
    epsTtm: num(r.eps_ttm),
    rsi14: num(r.rsi_14),
    macd: num(r.macd),
    macdSignal: num(r.macd_signal),
    relStrengthSpy30d: num(r.rel_strength_spy_30d),
    analystTargetMean: num(r.analyst_target_mean),
    analystCount: r.analyst_count === null ? null : Number(r.analyst_count),
    analystRating: str(r.analyst_rating),
    shortInterestPct: num(r.short_interest_pct),
    verifySource: str(r.verify_source),
    verifyClose: num(r.verify_close),
    verifyDeltaPct: num(r.verify_delta_pct),
  };
}
