import { getTickerMarket } from "./market";
import { getTickerFundamentals } from "./fundamentals";
import { getUpcomingEvents, getRecentEvents } from "./events";
import { getTickerSentiment } from "./sentiment";
import { buildDossier, type TickerDossier } from "./dossier";

/**
 * Public dossier loader for unauthenticated marketing pages
 * (/stocks/[ticker], /embed/[ticker]).
 *
 * Reuses the warehouse readers + heuristic dossier builder. Zero AI
 * cost per page load — everything here is SQL against slowly-changing
 * warehouse tables populated by the nightly cron.
 *
 * No userId anywhere. No PII. No holding table access. Safe to expose
 * publicly — warehouse tables are already designed to be ticker-keyed
 * and userless (see rule 8 in AGENTS.md).
 *
 * Returns null when the warehouse has no market row for the ticker —
 * callers should treat that as a 404 / "no data yet" state.
 */
export async function getPublicDossier(
  ticker: string
): Promise<TickerDossier | null> {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9.\-]{1,10}$/.test(normalized)) {
    return null;
  }

  const [market, fundamentals, upcomingEvents, recentEvents, sentiment] =
    await Promise.all([
      getTickerMarket(normalized),
      getTickerFundamentals(normalized),
      getUpcomingEvents(normalized, { windowDays: 30 }),
      getRecentEvents(normalized, { windowDays: 14 }),
      getTickerSentiment(normalized),
    ]);

  // No market row at all → warehouse hasn't primed this ticker yet.
  // Return null so the page can render a clean "no data yet" state
  // instead of a half-broken dossier.
  if (!market) return null;

  return buildDossier(normalized, {
    market,
    fundamentals,
    upcomingEvents,
    recentEvents,
    sentiment,
  });
}
