import { pool } from "../db";
import { log, errorInfo } from "../log";
import type { SystemAggregateRow } from "./types";

/**
 * Upsert a single system-aggregate metric for today.
 * Idempotent — same (date, metric_name, dimension) overwrites.
 */
export async function upsertSystemMetric(input: {
  metricName: string;
  dimension?: string | null;
  valueNumeric?: number | null;
  valueJson?: unknown;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO "system_aggregate_daily"
         (captured_at, metric_name, dimension, value_numeric, value_json)
       VALUES (CURRENT_DATE, $1, $2, $3, $4::jsonb)
       ON CONFLICT (captured_at, metric_name, COALESCE(dimension, ''))
       DO UPDATE SET
         value_numeric = EXCLUDED.value_numeric,
         value_json = EXCLUDED.value_json,
         as_of = NOW()`,
      [
        input.metricName,
        input.dimension ?? null,
        input.valueNumeric ?? null,
        input.valueJson !== undefined ? JSON.stringify(input.valueJson) : null,
      ]
    );
  } catch (err) {
    log.warn("warehouse.aggregate", "upsertSystemMetric failed", {
      metric: input.metricName,
      ...errorInfo(err),
    });
  }
}

/**
 * Read recent rows for a metric. Used by the admin metrics endpoint.
 */
export async function getMetricHistory(
  metricName: string,
  opts?: { days?: number; dimension?: string | null }
): Promise<SystemAggregateRow[]> {
  const days = opts?.days ?? 30;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM "system_aggregate_daily"
       WHERE metric_name = $1
         AND captured_at > CURRENT_DATE - ($2 || ' days')::interval
         AND ($3::text IS NULL OR dimension = $3)
       ORDER BY captured_at ASC, dimension ASC NULLS FIRST`,
      [metricName, String(days), opts?.dimension ?? null]
    );
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  } catch (err) {
    log.warn("warehouse.aggregate", "getMetricHistory failed", {
      metric: metricName,
      ...errorInfo(err),
    });
    return [];
  }
}

function mapRow(r: Record<string, unknown>): SystemAggregateRow {
  const iso = (v: unknown): string =>
    v instanceof Date ? v.toISOString() : String(v);
  const dateOnly = (v: unknown): string =>
    v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
  return {
    capturedAt: dateOnly(r.captured_at),
    metricName: String(r.metric_name),
    dimension: r.dimension === null ? null : String(r.dimension),
    valueNumeric:
      r.value_numeric === null || r.value_numeric === undefined
        ? null
        : Number(r.value_numeric),
    valueJson: r.value_json,
    asOf: iso(r.as_of),
  };
}
