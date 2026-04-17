import {
  getTickerMarket,
  getTickerFundamentals,
  getUpcomingEvents,
  getRecentEvents,
  getTickerSentiment,
} from "../index";
import { buildDossier, writeDossier } from "../dossier";
import { log, errorInfo } from "../../log";

/**
 * Nightly dossier refresh. For each held ticker, read the freshly-populated
 * warehouse rows, run them through the heuristic builder, persist the
 * result to ticker_dossier. Zero AI, zero external fetches — every byte
 * comes from our own Postgres.
 *
 * Sequencing: this step runs AFTER market/fundamentals/events/sentiment
 * refresh inside the cron orchestrator so the reads see today's data.
 */

export type DossierRefreshResult = {
  attempted: number;
  written: number;
  skipped: number;
  failed: Array<{ ticker: string; error: string }>;
};

export async function refreshDossiers(
  tickers: string[]
): Promise<DossierRefreshResult> {
  const attempted = tickers.length;
  let written = 0;
  let skipped = 0;
  const failed: DossierRefreshResult["failed"] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const ticker = tickers[idx].toUpperCase();
      try {
        const [market, fundamentals, upcoming, recent, sentiment] =
          await Promise.all([
            getTickerMarket(ticker),
            getTickerFundamentals(ticker),
            getUpcomingEvents(ticker, { windowDays: 60 }),
            getRecentEvents(ticker, { windowDays: 90 }),
            getTickerSentiment(ticker),
          ]);

        // If we have no warehouse data at all, skip — the dossier would
        // be a single "no data yet" line; better to leave yesterday's
        // if it exists than to overwrite with vacuum.
        if (!market && !fundamentals && recent.length === 0) {
          skipped++;
          continue;
        }

        const dossier = buildDossier(ticker, {
          market,
          fundamentals,
          upcomingEvents: upcoming,
          recentEvents: recent,
          sentiment,
        });
        await writeDossier(dossier);
        written++;
      } catch (err) {
        failed.push({
          ticker,
          error: err instanceof Error ? err.message : "unknown",
        });
        log.warn("warehouse.refresh.dossier", "ticker failed", {
          ticker,
          ...errorInfo(err),
        });
      }
    }
  }

  // Higher concurrency than the data-fetch steps — all reads are local
  // Postgres, no external rate-limit concerns.
  const workers = Array.from(
    { length: Math.min(6, tickers.length) },
    () => worker()
  );
  await Promise.all(workers);

  return { attempted, written, skipped, failed };
}
