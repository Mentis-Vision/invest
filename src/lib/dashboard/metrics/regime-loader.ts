// src/lib/dashboard/metrics/regime-loader.ts
//
// Composes the inputs to classifyRegime() from real data sources:
//   * VIXCLS    (FRED) — daily VIX close
//   * VIX9DCLS  (FRED) — daily VIX9D close, when published. CBOE
//                        sometimes lags the FRED feed for this short-
//                        dated index, so a null here is normal and the
//                        classifier still produces a label from the
//                        VIX level alone.
//   * daysToFOMC          — local hardcoded calendar (regime.ts)
//   * putCallRatio        — null in v1. Polygon doesn't expose an
//                          aggregate equity P/C ratio on the tier we
//                          have today; CBOE publishes a daily CSV but
//                          scraping is fragile. Stubbed null until we
//                          either upgrade the Polygon tier or wire a
//                          dedicated CSV reader. Documented inline.
//
// The loader is per-render but lightly memoized at the module level
// keyed by today's UTC date — every user on a given day shares the
// same regime, and the FRED endpoints already have a server-side
// cache via Next's `revalidate: 3600` on `fetch`. The local memo is
// just there to avoid re-fetching for each tile mount within a
// single render pass.
//
// Returns a fully-formed `RegimeSnapshot` even when every fetch
// fails — the tile renders "—" for a label of NEUTRAL with empty
// reasons, matching the empty-state pattern used by RiskTile.

import { getLatestSeriesValue } from "../../data/fred";
import { log, errorInfo } from "../../log";
import {
  classifyRegime,
  daysToNextFOMC,
  type RegimeClassification,
  type RegimeSignals,
} from "./regime";

export interface RegimeSnapshot {
  signals: RegimeSignals;
  classification: RegimeClassification;
  /** Date of the underlying VIX observation, when available. */
  asOf: string | null;
}

const memo = new Map<string, Promise<RegimeSnapshot>>();

function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/**
 * Polygon doesn't surface an aggregate equity put/call ratio on our
 * current tier, and CBOE's daily CSV (cboe.com/us/options/market_statistics)
 * is fragile to scrape. Wire a real source here when we either:
 *   1) Upgrade Polygon to a tier that exposes /v3/snapshot/options, or
 *   2) Add a dedicated CBOE-CSV reader with proper rate-limit + caching.
 *
 * Returning null is the documented "not yet wired" state — the
 * classifier ignores it and still produces a label from VIX + FOMC.
 */
async function getPutCallRatio(): Promise<number | null> {
  return null;
}

async function fetchRegimeSnapshot(): Promise<RegimeSnapshot> {
  const [vixObs, vix9dObs, putCall] = await Promise.all([
    getLatestSeriesValue("VIXCLS").catch((err) => {
      log.warn("dashboard.regime", "VIXCLS fetch failed", { ...errorInfo(err) });
      return null;
    }),
    getLatestSeriesValue("VIX9DCLS").catch((err) => {
      // VIX9DCLS is sometimes missing from FRED for a few days at a
      // time — log at debug, not warn, so it doesn't pollute prod.
      log.debug("dashboard.regime", "VIX9DCLS fetch failed", { ...errorInfo(err) });
      return null;
    }),
    getPutCallRatio(),
  ]);

  const vixLevel = vixObs?.value ?? null;
  const vix9d = vix9dObs?.value ?? null;
  const vixTermRatio =
    vixLevel !== null &&
    vix9d !== null &&
    Number.isFinite(vixLevel) &&
    Number.isFinite(vix9d) &&
    vixLevel > 0
      ? vix9d / vixLevel
      : null;

  const signals: RegimeSignals = {
    vixLevel,
    vixTermRatio,
    daysToFOMC: daysToNextFOMC(),
    putCallRatio: putCall,
  };

  const classification = classifyRegime(signals);
  return {
    signals,
    classification,
    asOf: vixObs?.date ?? null,
  };
}

/**
 * Fetches today's regime snapshot. Memoized per UTC date so the
 * cron-warmed FRED responses get amortized across all dashboard
 * renders for the day. Errors never throw — the snapshot returned
 * always has a valid `classification`, falling back to NEUTRAL with
 * empty reasons when every signal is null.
 */
export async function getMarketRegime(): Promise<RegimeSnapshot> {
  const key = todayKey();
  let p = memo.get(key);
  if (!p) {
    p = fetchRegimeSnapshot();
    memo.set(key, p);
    // If the underlying fetch rejects (shouldn't, since each leg has
    // its own catch), drop the cache entry so the next request
    // retries cleanly rather than serving a permanent rejection.
    p.catch(() => memo.delete(key));
  }
  return p;
}
