// src/lib/dashboard/metrics/skew.ts
//
// Phase 4 Batch K2 — CBOE SKEW index loader and percentile classifier.
//
// SKEW is published by CBOE as a derivative of S&P 500 option prices,
// designed to capture the *tail risk* (out-of-the-money put demand)
// the standard VIX misses. Levels above 130 indicate elevated black-
// swan hedging; below 110 indicate complacency. The 2y percentile
// rank gives the dashboard a normalized "where are we vs recent
// history?" reading rather than a raw level.
//
// Data source: Yahoo's `^SKEW` symbol via yahoo-finance2 (same library
// already wired for stock snapshots and chart history). No API key
// required. We cache a 2-year history per render via the same
// fetch-cache convention as the rest of the warehouse.
//
// Pure utility module — `classifySkew` is the exposed pure function
// that does the math. The loader piece is a thin async wrapper.

export type SkewBand = "complacent" | "elevated" | "extreme" | "neutral";

export interface SkewReading {
  /** Latest SKEW close. */
  value: number;
  /** 2-year percentile rank, 0–1 (higher = more elevated). */
  percentile2y: number;
  /** Coarse band classification. */
  band: SkewBand;
  /** ISO date of the latest reading. */
  asOf: string;
}

/**
 * Classify a SKEW level into a 4-band reading using the historical
 * series. Pure function; no I/O.
 *
 * Band thresholds (from CBOE methodology + empirical practice):
 *   < 110         complacent  (low tail-risk pricing)
 *   110 – 130     neutral     (typical baseline range)
 *   130 – 145     elevated    (raised tail demand)
 *   > 145         extreme     (significant OTM put bid)
 *
 * Returns null when `latest` is non-finite or `history` is empty.
 */
export function classifySkew(
  latest: number,
  history: number[],
  asOf: string,
): SkewReading | null {
  if (!Number.isFinite(latest)) return null;
  if (history.length === 0) return null;

  let band: SkewBand;
  if (latest < 110) band = "complacent";
  else if (latest < 130) band = "neutral";
  else if (latest < 145) band = "elevated";
  else band = "extreme";

  const sorted = history.slice().sort((a, b) => a - b);
  let count = 0;
  for (const v of sorted) {
    if (v <= latest) count++;
  }
  const percentile2y = count / sorted.length;

  return {
    value: Math.round(latest * 10) / 10,
    percentile2y: Math.round(percentile2y * 100) / 100,
    band,
    asOf,
  };
}

export type SkewFetcher = () => Promise<{ closes: number[]; lastDate: string } | null>;

/**
 * Default fetcher uses yahoo-finance2 to pull 2 years of daily ^SKEW
 * closes. Imported lazily so the module-graph stays serverless-cold
 * cheap and so unit tests can stub it via DI.
 */
async function defaultFetchSkew(): Promise<
  { closes: number[]; lastDate: string } | null
> {
  try {
    const { default: YahooFinanceCtor } = await import("yahoo-finance2");
    const yf = new YahooFinanceCtor({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
    const period1 = new Date(Date.now() - 2 * 365 * 86400000);
    const hist = (await yf.chart("^SKEW", {
      period1,
      interval: "1d",
    })) as unknown as {
      quotes?: Array<{ close?: number | null; date?: Date | string }>;
    };
    const quotes = hist.quotes ?? [];
    const closes: number[] = [];
    let lastDate = "";
    for (const q of quotes) {
      if (typeof q.close === "number" && Number.isFinite(q.close) && q.close > 0) {
        closes.push(q.close);
        if (q.date instanceof Date) lastDate = q.date.toISOString().slice(0, 10);
        else if (typeof q.date === "string") lastDate = q.date.slice(0, 10);
      }
    }
    if (closes.length === 0) return null;
    return { closes, lastDate };
  } catch {
    return null;
  }
}

/**
 * Loader entry point. Returns a SkewReading or null when Yahoo is
 * unreachable / the symbol returns no usable closes. Accepts an
 * optional fetcher override for testing.
 */
export async function getSkewReading(
  fetcher: SkewFetcher = defaultFetchSkew,
): Promise<SkewReading | null> {
  const data = await fetcher();
  if (!data) return null;
  const latest = data.closes[data.closes.length - 1];
  return classifySkew(latest, data.closes, data.lastDate);
}
