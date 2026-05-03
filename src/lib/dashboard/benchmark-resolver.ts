// src/lib/dashboard/benchmark-resolver.ts
// Spec §6.2. Resolves benchmark keys (preset slugs or raw tickers) to
// labels + tickers, computes returns over a window, and validates
// custom user-entered tickers against warehouse coverage.

import { pool } from "../db";
import { log, errorInfo } from "../log";

export interface BenchmarkPreset {
  ticker: string;
  label: string;
  /** If set, the preset is a synthetic blend of weighted components (e.g. 60/40). */
  synthetic?: { components: { ticker: string; weight: number }[] };
}

export const BENCHMARK_PRESETS: Record<string, BenchmarkPreset> = {
  // Major indices
  sp500: { ticker: "SPY", label: "S&P 500" },
  nasdaq: { ticker: "QQQ", label: "Nasdaq" },
  dow: { ticker: "DIA", label: "Dow" },
  russell2000: { ticker: "IWM", label: "Russell 2000" },
  msci_world: { ticker: "URTH", label: "MSCI World" },
  vti: { ticker: "VTI", label: "Total US Market" },
  // Synthetic portfolios
  "60-40": {
    ticker: "60-40",
    label: "60/40 Portfolio",
    synthetic: {
      components: [
        { ticker: "SPY", weight: 0.6 },
        { ticker: "AGG", weight: 0.4 },
      ],
    },
  },
  // Sector ETFs (SPDR)
  xlk: { ticker: "XLK", label: "Tech (XLK)" },
  xlf: { ticker: "XLF", label: "Financials (XLF)" },
  xlv: { ticker: "XLV", label: "Healthcare (XLV)" },
  xle: { ticker: "XLE", label: "Energy (XLE)" },
  xly: { ticker: "XLY", label: "Cons Disc (XLY)" },
  xlp: { ticker: "XLP", label: "Cons Staples (XLP)" },
  xli: { ticker: "XLI", label: "Industrials (XLI)" },
  xlb: { ticker: "XLB", label: "Materials (XLB)" },
  xlu: { ticker: "XLU", label: "Utilities (XLU)" },
  xlre: { ticker: "XLRE", label: "Real Estate (XLRE)" },
  xlc: { ticker: "XLC", label: "Comm Services (XLC)" },
};

export const DEFAULT_BENCHMARKS = ["sp500", "nasdaq", "dow"] as const;

export function isPresetKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(BENCHMARK_PRESETS, key);
}

export function resolveBenchmarkLabel(key: string): string {
  return BENCHMARK_PRESETS[key]?.label ?? key.toUpperCase();
}

export function resolveBenchmarkTicker(key: string): string {
  return BENCHMARK_PRESETS[key]?.ticker ?? key.toUpperCase();
}

interface WarehouseRow {
  ticker: string;
  captured_at: string;
  close: number;
}

export async function resolveBenchmarkReturn(
  key: string,
  fromDate: string,
): Promise<number | null> {
  const preset = BENCHMARK_PRESETS[key];

  if (!preset?.synthetic) {
    const ticker = resolveBenchmarkTicker(key);
    return computeSingleReturn(ticker, fromDate);
  }

  const tickers = preset.synthetic.components.map((c) => c.ticker);
  const result = await pool
    .query<WarehouseRow>(
      `SELECT ticker, captured_at, close
       FROM ticker_market_daily
       WHERE ticker = ANY($1::text[])
         AND captured_at >= $2::date
         AND close IS NOT NULL
       ORDER BY captured_at ASC`,
      [tickers, fromDate],
    )
    .catch((err) => {
      log.warn("dashboard.benchmark", "synthetic query failed", {
        key,
        ...errorInfo(err),
      });
      return { rows: [] as WarehouseRow[] };
    });

  let weighted = 0;
  for (const c of preset.synthetic.components) {
    const series = result.rows.filter((r) => r.ticker === c.ticker);
    if (series.length < 2) return null;
    const first = series[0].close;
    const last = series[series.length - 1].close;
    if (!first || !last) return null;
    weighted += c.weight * ((last - first) / first);
  }
  return weighted;
}

async function computeSingleReturn(
  ticker: string,
  fromDate: string,
): Promise<number | null> {
  try {
    const result = await pool.query<WarehouseRow>(
      `SELECT ticker, captured_at, close
       FROM ticker_market_daily
       WHERE ticker = $1
         AND captured_at >= $2::date
         AND close IS NOT NULL
       ORDER BY captured_at ASC`,
      [ticker.toUpperCase(), fromDate],
    );
    if (result.rows.length < 2) return null;
    const first = result.rows[0].close;
    const last = result.rows[result.rows.length - 1].close;
    if (!first || !last) return null;
    return (last - first) / first;
  } catch (err) {
    log.warn("dashboard.benchmark", "single return query failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

export interface CustomTickerValidation {
  valid: boolean;
  ticker: string;
  historyDays: number;
}

export async function validateCustomTicker(
  rawTicker: string,
): Promise<CustomTickerValidation> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker || ticker.length > 20 || !/^[A-Z0-9.\-]+$/.test(ticker)) {
    return { valid: false, ticker, historyDays: 0 };
  }
  try {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM ticker_market_daily
       WHERE ticker = $1
         AND close IS NOT NULL
         AND captured_at >= CURRENT_DATE - INTERVAL '90 days'`,
      [ticker],
    );
    const historyDays = Number(result.rows[0]?.count ?? 0);
    return { valid: historyDays >= 30, ticker, historyDays };
  } catch (err) {
    log.warn("dashboard.benchmark", "validate failed", {
      ticker,
      ...errorInfo(err),
    });
    return { valid: false, ticker, historyDays: 0 };
  }
}
