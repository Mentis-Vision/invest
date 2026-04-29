import { pool } from "../db";
import { log, errorInfo } from "../log";
import { pctChange, roundNullable } from "./utils";

export async function computeBenchmarkComparison(args: {
  ticker: string;
  startDate: string;
  endDate: string;
  tickerStartPrice: number;
  tickerEndPrice: number;
  benchmarkTicker?: "SPY" | "QQQ";
}): Promise<{
  benchmarkTicker: string;
  benchmarkReturnPct: number | null;
  tickerReturnPct: number;
  alphaPct: number | null;
  note: string;
}> {
  const benchmarkTicker = args.benchmarkTicker ?? "SPY";
  const tickerReturnPct =
    pctChange(args.tickerStartPrice, args.tickerEndPrice) ?? 0;

  try {
    const [start, end] = await Promise.all([
      getBenchmarkClose(benchmarkTicker, args.startDate),
      getBenchmarkClose(benchmarkTicker, args.endDate),
    ]);
    const benchmarkReturnPct = pctChange(start, end);
    if (benchmarkReturnPct == null) {
      return {
        benchmarkTicker,
        benchmarkReturnPct: null,
        tickerReturnPct: roundNullable(tickerReturnPct, 2) ?? tickerReturnPct,
        alphaPct: null,
        note: `Benchmark data for ${benchmarkTicker} was not available for the full comparison window. Alpha was not calculated.`,
      };
    }

    const alphaPct = tickerReturnPct - benchmarkReturnPct;
    return {
      benchmarkTicker,
      benchmarkReturnPct: roundNullable(benchmarkReturnPct, 2),
      tickerReturnPct: roundNullable(tickerReturnPct, 2) ?? tickerReturnPct,
      alphaPct: roundNullable(alphaPct, 2),
      note:
        "Benchmark comparison is retrospective and informational only. It is not a guarantee of future performance.",
    };
  } catch (err) {
    log.warn("decision-engine.benchmark", "comparison failed", {
      ticker: args.ticker,
      benchmarkTicker,
      ...errorInfo(err),
    });
    return {
      benchmarkTicker,
      benchmarkReturnPct: null,
      tickerReturnPct: roundNullable(tickerReturnPct, 2) ?? tickerReturnPct,
      alphaPct: null,
      note: `Benchmark data for ${benchmarkTicker} was unavailable. Alpha was not calculated.`,
    };
  }
}

async function getBenchmarkClose(
  ticker: "SPY" | "QQQ",
  date: string
): Promise<number | null> {
  const { rows } = await pool.query<{ close: number | string | null }>(
    `SELECT close
       FROM "ticker_market_daily"
      WHERE ticker = $1
        AND captured_at <= $2::date
        AND close IS NOT NULL
      ORDER BY captured_at DESC
      LIMIT 1`,
    [ticker, date]
  );
  if (rows.length === 0) return null;
  const close = Number(rows[0].close);
  return Number.isFinite(close) && close > 0 ? close : null;
}
