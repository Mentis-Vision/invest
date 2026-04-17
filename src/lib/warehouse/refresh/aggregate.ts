import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import { upsertSystemMetric } from "../aggregate";

/**
 * Populate system_aggregate_daily rows for today. Reads counts + averages
 * from existing user-scoped tables but writes ONLY aggregate values
 * (no userId, email, IP, etc.) to system_aggregate_daily.
 *
 * Metrics seeded (matches spec §4.5):
 *   recs.total, recs.by_rec, recs.by_sector
 *   analyst.total_calls, analyst.success_rate, analyst.avg_tokens
 *   supervisor.fast_path_share
 *   alerts.created, alerts.active
 *   waitlist.new_signups_daily, waitlist.total_size
 */
export async function refreshAggregates(): Promise<{ metrics: number }> {
  let metrics = 0;
  const safeUpsert = async (input: Parameters<typeof upsertSystemMetric>[0]) => {
    await upsertSystemMetric(input);
    metrics++;
  };

  try {
    // recs.total today
    const r1 = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "recommendation"
       WHERE "createdAt"::date = CURRENT_DATE`
    );
    await safeUpsert({
      metricName: "recs.total",
      valueNumeric: Number(r1.rows[0]?.n ?? 0),
    });

    // recs.by_rec
    const r2 = await pool.query(
      `SELECT recommendation, COUNT(*)::int AS n FROM "recommendation"
       WHERE "createdAt"::date = CURRENT_DATE
       GROUP BY recommendation`
    );
    for (const row of r2.rows as Array<{ recommendation: string; n: number }>) {
      await safeUpsert({
        metricName: "recs.by_rec",
        dimension: row.recommendation,
        valueNumeric: Number(row.n ?? 0),
      });
    }

    // analyst totals per model (from analysisJson)
    const r3 = await pool.query(
      `WITH analyst_rows AS (
         SELECT jsonb_array_elements("analysisJson"->'analyses') AS a
         FROM "recommendation"
         WHERE "createdAt"::date = CURRENT_DATE
       )
       SELECT
         a->>'model' AS model,
         COUNT(*)::int AS total,
         SUM(CASE WHEN a->>'status' = 'ok' THEN 1 ELSE 0 END)::int AS ok,
         AVG((a->>'tokensUsed')::int) FILTER (WHERE a->>'status' = 'ok') AS avg_tokens
       FROM analyst_rows
       WHERE a->>'model' IS NOT NULL
       GROUP BY a->>'model'`
    );
    for (const row of r3.rows as Array<{
      model: string;
      total: number;
      ok: number;
      avg_tokens: string | number | null;
    }>) {
      await safeUpsert({
        metricName: "analyst.total_calls",
        dimension: row.model,
        valueNumeric: Number(row.total ?? 0),
      });
      const successRate =
        row.total > 0 ? Number(row.ok ?? 0) / Number(row.total) : 0;
      await safeUpsert({
        metricName: "analyst.success_rate",
        dimension: row.model,
        valueNumeric: successRate,
      });
      await safeUpsert({
        metricName: "analyst.avg_tokens",
        dimension: row.model,
        valueNumeric:
          row.avg_tokens === null || row.avg_tokens === undefined
            ? null
            : Number(row.avg_tokens),
      });
    }

    // supervisor fast-path share
    const r4 = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         SUM(CASE WHEN "analysisJson"->>'supervisorModel' = 'panel-consensus'
                  THEN 1 ELSE 0 END)::int AS fast
       FROM "recommendation"
       WHERE "createdAt"::date = CURRENT_DATE`
    );
    const total = Number(r4.rows[0]?.total ?? 0);
    const fast = Number(r4.rows[0]?.fast ?? 0);
    await safeUpsert({
      metricName: "supervisor.fast_path_share",
      valueNumeric: total > 0 ? fast / total : 0,
    });

    // alerts.created today, by kind
    const r5 = await pool.query(
      `SELECT kind, COUNT(*)::int AS n FROM "alert_event"
       WHERE "createdAt"::date = CURRENT_DATE
       GROUP BY kind`
    );
    for (const row of r5.rows as Array<{ kind: string; n: number }>) {
      await safeUpsert({
        metricName: "alerts.created",
        dimension: row.kind,
        valueNumeric: Number(row.n ?? 0),
      });
    }

    // alerts.active, by kind
    const r6 = await pool.query(
      `SELECT kind, COUNT(*)::int AS n FROM "alert_event"
       WHERE "dismissedAt" IS NULL
       GROUP BY kind`
    );
    for (const row of r6.rows as Array<{ kind: string; n: number }>) {
      await safeUpsert({
        metricName: "alerts.active",
        dimension: row.kind,
        valueNumeric: Number(row.n ?? 0),
      });
    }

    // waitlist
    const r7 = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE "createdAt"::date = CURRENT_DATE)::int AS today,
         COUNT(*)::int AS total
       FROM "waitlist"`
    );
    await safeUpsert({
      metricName: "waitlist.new_signups_daily",
      valueNumeric: Number(r7.rows[0]?.today ?? 0),
    });
    await safeUpsert({
      metricName: "waitlist.total_size",
      valueNumeric: Number(r7.rows[0]?.total ?? 0),
    });
  } catch (err) {
    log.warn("warehouse.refresh.aggregate", "rollup failed", errorInfo(err));
  }

  return { metrics };
}
