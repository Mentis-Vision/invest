import { pool } from "../db";
import { log, errorInfo } from "../log";
import type {
  TickerEventRow,
  TickerEventType,
  WarehouseSource,
} from "./types";

export async function getUpcomingEvents(
  ticker: string,
  opts?: { windowDays?: number; types?: TickerEventType[] }
): Promise<TickerEventRow[]> {
  const window = opts?.windowDays ?? 90;
  return queryEvents(ticker, {
    fromDate: new Date(),
    throughDate: new Date(Date.now() + window * 86400000),
    types: opts?.types,
    sortAsc: true,
  });
}

export async function getRecentEvents(
  ticker: string,
  opts?: { windowDays?: number; types?: TickerEventType[] }
): Promise<TickerEventRow[]> {
  const window = opts?.windowDays ?? 180;
  return queryEvents(ticker, {
    fromDate: new Date(Date.now() - window * 86400000),
    throughDate: new Date(),
    types: opts?.types,
    sortAsc: false,
  });
}

async function queryEvents(
  ticker: string,
  opts: {
    fromDate: Date;
    throughDate: Date;
    types?: TickerEventType[];
    sortAsc: boolean;
  }
): Promise<TickerEventRow[]> {
  try {
    const typeFilter = opts.types && opts.types.length > 0 ? opts.types : null;
    const { rows } = await pool.query(
      `SELECT * FROM "ticker_events"
       WHERE ticker = $1
         AND event_date >= $2::date
         AND event_date <= $3::date
         AND ($4::text[] IS NULL OR event_type = ANY($4))
       ORDER BY event_date ${opts.sortAsc ? "ASC" : "DESC"}
       LIMIT 50`,
      [
        ticker.toUpperCase(),
        opts.fromDate.toISOString().slice(0, 10),
        opts.throughDate.toISOString().slice(0, 10),
        typeFilter,
      ]
    );
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  } catch (err) {
    log.warn("warehouse.events", "queryEvents failed", {
      ticker,
      ...errorInfo(err),
    });
    return [];
  }
}

function mapRow(r: Record<string, unknown>): TickerEventRow {
  const iso = (v: unknown): string =>
    v instanceof Date ? v.toISOString() : String(v);
  const dateOnly = (v: unknown): string =>
    v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
  const details = (v: unknown): Record<string, unknown> => {
    if (v && typeof v === "object") return v as Record<string, unknown>;
    return {};
  };
  return {
    id: String(r.id),
    ticker: String(r.ticker),
    eventType: String(r.event_type) as TickerEventType,
    eventDate: dateOnly(r.event_date),
    eventTime:
      r.event_time === null || r.event_time === undefined
        ? null
        : iso(r.event_time),
    details: details(r.details),
    source: (String(r.source) as WarehouseSource) ?? "yahoo",
    asOf: iso(r.as_of),
  };
}
