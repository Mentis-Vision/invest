import { pool } from "../db";
import { log, errorInfo } from "../log";

export type BacktestStatus =
  | "NOT_ENOUGH_DATA"
  | "READY"
  | "COMPLETED";

export type BacktestResult = {
  status: BacktestStatus;
  ticker: string;
  startDate: string | null;
  endDate: string | null;
  observations: number;
  note: string;
  limitations: string[];
};

const LIMITATIONS = [
  "No guarantee of future results.",
  "May exclude slippage.",
  "May exclude taxes.",
  "May exclude dividends.",
  "May exclude corporate actions.",
  "Not investment advice.",
];

export async function prepareDecisionEngineBacktest(args: {
  ticker: string;
  startDate?: string;
  endDate?: string;
}): Promise<BacktestResult> {
  const ticker = args.ticker.toUpperCase();
  try {
    const { rows } = await pool.query<{
      observations: number;
      start_date: Date | string | null;
      end_date: Date | string | null;
    }>(
      `SELECT COUNT(*)::int AS observations,
              MIN(captured_at) AS start_date,
              MAX(captured_at) AS end_date
         FROM "ticker_market_daily"
        WHERE ticker = $1
          AND ($2::date IS NULL OR captured_at >= $2::date)
          AND ($3::date IS NULL OR captured_at <= $3::date)`,
      [ticker, args.startDate ?? null, args.endDate ?? null]
    );
    const row = rows[0];
    const observations = Number(row?.observations ?? 0);
    const startDate = dateOnly(row?.start_date);
    const endDate = dateOnly(row?.end_date);

    if (observations < 120) {
      return {
        status: "NOT_ENOUGH_DATA",
        ticker,
        startDate,
        endDate,
        observations,
        note:
          "Not enough warehouse history exists to prepare a meaningful deterministic backtest scaffold.",
        limitations: LIMITATIONS,
      };
    }

    return {
      status: "READY",
      ticker,
      startDate,
      endDate,
      observations,
      note:
        "Warehouse history is sufficient to build a future backtest, but no marketing-facing hypothetical performance is produced.",
      limitations: LIMITATIONS,
    };
  } catch (err) {
    log.warn("decision-engine.backtest", "prepare failed", {
      ticker,
      ...errorInfo(err),
    });
    return {
      status: "NOT_ENOUGH_DATA",
      ticker,
      startDate: null,
      endDate: null,
      observations: 0,
      note:
        "Backtest preparation could not read warehouse history for this ticker.",
      limitations: LIMITATIONS,
    };
  }
}

function dateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
