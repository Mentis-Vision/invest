// src/lib/dashboard/metrics/revision-breadth-loader.ts
//
// Loader for the REV6 analyst-revision-breadth chip.
//
// Single-ticker pull pulls the Finnhub monthly recommendation
// history and runs computeRev6. We surface the result as a chip
// on stale_rec_held / catalyst_prep_imminent items.
//
// Per-page-load in-memory cache: the queue-builder calls this once
// per held ticker, but the same dashboard render kicks the loader
// twice in some flows (queue + drill). The Map dedupes within one
// process tick, then becomes irrelevant when the function returns.
//
// We deliberately DON'T persist this in `ticker_market_daily` —
// that table is a strict price/return warehouse, not an analyst-
// signals warehouse. If we add a `ticker_analyst_daily` table
// later, this loader would migrate to read it.

import { getAnalystRecommendationHistory } from "../../data/finnhub";
import {
  computeRev6,
  type RevisionBreadth,
  type AnalystRecommendation,
} from "./revision-breadth";
import { log, errorInfo } from "../../log";

interface CacheEntry {
  fetchedAt: number;
  breadth: RevisionBreadth | null;
}
const LOADER_TTL_MS = 30 * 60 * 1000; // 30m
const cache = new Map<string, CacheEntry>();

/**
 * Returns the trailing-6-month revision breadth for a single ticker
 * or null when (a) Finnhub returns nothing or (b) we have fewer
 * than 2 months of data (need at least one delta to score).
 */
export async function getRevisionBreadth(
  ticker: string,
): Promise<RevisionBreadth | null> {
  const upper = ticker.toUpperCase();
  const cached = cache.get(upper);
  if (cached && Date.now() - cached.fetchedAt < LOADER_TTL_MS) {
    return cached.breadth;
  }
  try {
    const history = await getAnalystRecommendationHistory(upper);
    if (history.length === 0) {
      cache.set(upper, { fetchedAt: Date.now(), breadth: null });
      return null;
    }
    const result = computeRev6(history as AnalystRecommendation[], 6);
    if (result.observations === 0) {
      cache.set(upper, { fetchedAt: Date.now(), breadth: null });
      return null;
    }
    cache.set(upper, { fetchedAt: Date.now(), breadth: result });
    return result;
  } catch (err) {
    log.warn("dashboard.revision-breadth", "getRevisionBreadth failed", {
      ticker: upper,
      ...errorInfo(err),
    });
    cache.set(upper, { fetchedAt: Date.now(), breadth: null });
    return null;
  }
}

/** Test seam — drops the in-memory cache between tests. */
export function __resetRev6CacheForTest(): void {
  cache.clear();
}
