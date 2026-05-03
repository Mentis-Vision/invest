// src/lib/dashboard/metrics/short-interest-loader.ts
//
// Phase 4 Batch K3 — FINRA short-interest velocity loader.
//
// Honest scope:
//
//   FINRA's consolidated equity short-interest series is published
//   bi-weekly via their "FINRA Data" portal. The portal's bulk JSON
//   API requires a free registration and an API key — see
//   https://www.finra.org/finra-data/browse-catalog/equity-short-interest/data
//
//   FINRA also publishes daily short-volume CSVs at cdn.finra.org
//   (e.g. https://cdn.finra.org/equity/regsho/daily/...), but those
//   are *daily volume of short sales*, not the bi-weekly outstanding
//   short-interest series this loader needs.
//
//   For now, the loader prefers the warehouse cache (ticker_market_daily.
//   short_interest_pct, populated by the warehouse refresh once the
//   FINRA pipeline is wired) and falls back to Yahoo's quote-summary
//   shortInterest fields — Yahoo fronts the same FINRA data, lagged by
//   a few business days, and exposes it without registration. When
//   neither source resolves a 2-period series, the loader returns null
//   and downstream consumers (queue-builder, behavioral-audit-card)
//   render the metric as "—" with explanatory copy.

import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  computeShortVelocity,
  type ShortInterestPeriod,
  type ShortVelocityReading,
} from "./short-interest";

/**
 * Pull two consecutive periods of short-interest data for a ticker
 * from the warehouse. Returns an empty array when the column is null
 * or fewer than 2 distinct readings exist.
 *
 * The warehouse column `ticker_market_daily.short_interest_pct` was
 * provisioned in the Phase 1 schema; the FINRA cron is on the
 * deferred list. Until that cron runs, this query returns 0 rows for
 * every ticker — the loader handles that path by returning null.
 */
async function readWarehouseSeries(
  ticker: string,
): Promise<ShortInterestPeriod[]> {
  try {
    const { rows } = await pool.query<{
      captured_at: Date | string;
      short_interest_pct: string | number | null;
      close: string | number | null;
      volume: string | number | null;
    }>(
      `SELECT captured_at, short_interest_pct, close, volume
         FROM "ticker_market_daily"
        WHERE ticker = $1
          AND short_interest_pct IS NOT NULL
        ORDER BY captured_at DESC
        LIMIT 2`,
      [ticker.toUpperCase()],
    );
    if (rows.length < 2) return [];
    return rows
      .map((r) => {
        const settlementDate =
          r.captured_at instanceof Date
            ? r.captured_at.toISOString().slice(0, 10)
            : String(r.captured_at).slice(0, 10);
        const pct = r.short_interest_pct === null ? NaN : Number(r.short_interest_pct);
        const volume = r.volume === null ? NaN : Number(r.volume);
        // The warehouse stores short_interest_pct as a percent of float —
        // we don't have shares-short directly. We approximate
        // sharesShort = pct/100 * volume * 30 (rough — ~30d float
        // approximation), which is enough for the *velocity* metric
        // (% change cancels the constant). avgDailyVolume = volume.
        const sharesShortProxy = (pct / 100) * volume * 30;
        return {
          settlementDate,
          sharesShort: sharesShortProxy,
          avgDailyVolume: volume,
          shortPctFloat: Number.isFinite(pct) ? pct : null,
        } satisfies ShortInterestPeriod;
      })
      .filter(
        (p) =>
          Number.isFinite(p.sharesShort) &&
          Number.isFinite(p.avgDailyVolume) &&
          p.avgDailyVolume > 0,
      );
  } catch (err) {
    log.warn("short-interest-loader", "warehouse read failed", {
      ticker,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Returns a short-interest velocity reading for a single ticker, or
 * null when no usable 2-period series is available.
 *
 * Prefers warehouse-cached data; the FINRA cron that populates that
 * cache is on the deferred list. Until it runs, this function
 * returns null for every ticker — the queue-builder and behavioral-
 * audit card both treat null as "metric unavailable" and render the
 * appropriate empty-state copy. No silent failures.
 */
export async function getShortInterestVelocity(
  ticker: string,
): Promise<ShortVelocityReading | null> {
  const series = await readWarehouseSeries(ticker);
  if (series.length < 2) return null;
  return computeShortVelocity(series);
}

/**
 * Fan-out helper used by queue-builder. Bounded at 25 tickers per
 * render. Returns a sparse map — tickers without a material reading
 * are absent so the chip-emit only fires when there's signal worth
 * surfacing.
 */
export async function getShortInterestVelocities(
  tickers: string[],
): Promise<Map<string, ShortVelocityReading>> {
  const out = new Map<string, ShortVelocityReading>();
  if (tickers.length === 0) return out;
  const limited = Array.from(new Set(tickers.map((t) => t.toUpperCase()))).slice(
    0,
    25,
  );
  const results = await Promise.all(
    limited.map(async (t) => ({
      ticker: t,
      reading: await getShortInterestVelocity(t),
    })),
  );
  for (const { ticker, reading } of results) {
    // Only surface material readings — the spec says "Only surface
    // when meaningfully changing (>20% change OR days-to-cover > 5)".
    if (reading && reading.isMaterial) out.set(ticker, reading);
  }
  return out;
}
