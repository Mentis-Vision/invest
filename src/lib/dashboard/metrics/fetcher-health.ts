// src/lib/dashboard/metrics/fetcher-health.ts
//
// Tracks live-fetcher fallback events. Each fetcher reports its health
// status here; the weekly digest cron and the e2e-smoke runner read
// recent failures to decide whether to surface a "data feed degraded"
// notification.
//
// In-memory only. Resets on cold start. That's intentional — we only
// want to know about *sustained* failures, not one-off transient
// hiccups. The weekly digest checks: "has this fetcher fallen back
// at least once in the last 24h AND is the most recent attempt also
// a fallback?" If so, surface it.

import { log } from "../../log";

export type FetcherSource = "fama-french" | "damodaran" | "fomc";

export interface FetcherEvent {
  source: FetcherSource;
  outcome: "live" | "fallback" | "error";
  at: string; // ISO timestamp
  detail?: string;
}

const events = new Map<FetcherSource, FetcherEvent[]>();
const MAX_EVENTS_PER_SOURCE = 50;

export function recordFetcherEvent(
  source: FetcherSource,
  outcome: "live" | "fallback" | "error",
  detail?: string,
): void {
  const event: FetcherEvent = {
    source,
    outcome,
    at: new Date().toISOString(),
    detail,
  };
  const existing = events.get(source) ?? [];
  existing.push(event);
  if (existing.length > MAX_EVENTS_PER_SOURCE) {
    existing.splice(0, existing.length - MAX_EVENTS_PER_SOURCE);
  }
  events.set(source, existing);

  if (outcome !== "live") {
    log.warn("dashboard.fetcher-health", `${source} outcome=${outcome}`, {
      detail,
    });
  }
}

export interface FetcherHealthSnapshot {
  source: FetcherSource;
  lastEvent: FetcherEvent | null;
  totalFallbacks24h: number;
  totalErrors24h: number;
  /** True if last event is fallback/error AND any fallback in last 24h. */
  degraded: boolean;
}

export function getFetcherHealth(): FetcherHealthSnapshot[] {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const sources: FetcherSource[] = ["fama-french", "damodaran", "fomc"];
  return sources.map((source) => {
    const stream = events.get(source) ?? [];
    const last = stream[stream.length - 1] ?? null;
    const recent = stream.filter((e) => new Date(e.at).getTime() >= since);
    const fallbacks = recent.filter((e) => e.outcome === "fallback").length;
    const errors = recent.filter((e) => e.outcome === "error").length;
    const degraded =
      last !== null &&
      last.outcome !== "live" &&
      (fallbacks > 0 || errors > 0);
    return {
      source,
      lastEvent: last,
      totalFallbacks24h: fallbacks,
      totalErrors24h: errors,
      degraded,
    };
  });
}

/** Test-only — reset all tracking. */
export function _resetFetcherHealthForTest(): void {
  events.clear();
}
