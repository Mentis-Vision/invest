import { getTickerUniverse } from "./universe";
import { refreshMarket } from "./refresh/market";
import { refreshFundamentals } from "./refresh/fundamentals";
import { refreshEvents } from "./refresh/events";
import { refreshSentiment } from "./refresh/sentiment";
import { refreshAggregates } from "./refresh/aggregate";
import { refreshDossiers } from "./refresh/dossier";

export type WarehouseRefreshResult = {
  universeSize: number;
  market: Awaited<ReturnType<typeof refreshMarket>>;
  fundamentals: Awaited<ReturnType<typeof refreshFundamentals>>;
  events: Awaited<ReturnType<typeof refreshEvents>>;
  sentiment: Awaited<ReturnType<typeof refreshSentiment>>;
  aggregates: Awaited<ReturnType<typeof refreshAggregates>>;
  dossiers: Awaited<ReturnType<typeof refreshDossiers>>;
};

/**
 * Top-level warehouse refresh. The only caller is the nightly cron.
 *
 * Steps run sequentially (not parallel) so we don't slam Yahoo with
 * 4 cron steps × 4 workers = 16 concurrent requests. Each step has
 * its own internal concurrency cap.
 */
export async function refreshWarehouse(): Promise<WarehouseRefreshResult> {
  const universe = await getTickerUniverse();

  const market = await refreshMarket(universe);
  const fundamentals = await refreshFundamentals(universe);
  const events = await refreshEvents(universe);
  const sentiment = await refreshSentiment(universe);
  const aggregates = await refreshAggregates();

  // Dossiers run LAST: they read the four warehouse tables we just filled
  // and compose a heuristic (no-AI) brief per ticker. Pure-code, no
  // external calls — effectively free.
  const dossiers = await refreshDossiers(universe);

  return {
    universeSize: universe.length,
    market,
    fundamentals,
    events,
    sentiment,
    aggregates,
    dossiers,
  };
}
