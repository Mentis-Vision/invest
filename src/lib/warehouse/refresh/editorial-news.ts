import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import {
  EDITORIAL_PROVIDERS,
  fetchProviderItems,
  type EditorialItem,
} from "../../data/editorial-feeds";
import { getPolygonNews, polygonConfigured } from "../../data/polygon";
import { getTickerUniverse } from "../universe";

/**
 * Nightly pull of every configured editorial feed.
 *
 * Flow:
 *   1. Build a ticker universe from the holdings table (ticker-only,
 *      no userId — same privacy boundary as getTickerUniverse()).
 *   2. Fetch every provider in parallel, each capped at 25 items.
 *   3. Extract ticker mentions against the universe.
 *   4. Upsert into market_news_daily keyed by item id (URL hash).
 *   5. Prune anything older than 30 days so the table stays small.
 *
 * Sequential-per-provider inside the parallel wave because some
 * publishers 429 when hit repeatedly; but waves-of-11 is fine.
 */

export type EditorialRefreshResult = {
  providers: number;
  fetched: number;
  upserted: number;
  pruned: number;
  failed: Array<{ provider: string; error: string }>;
  /** Polygon per-ticker ingestion stats (silent no-op when key missing). */
  polygon: {
    enabled: boolean;
    tickersScanned: number;
    fetched: number;
    upserted: number;
  };
};

export async function refreshEditorialNews(): Promise<EditorialRefreshResult> {
  // Build the ticker universe for mention-extraction.
  //
  // Three sources unioned:
  //   1. Every ticker anyone currently holds.
  //   2. Every ticker researched in the last 60 days (catches "pre-
  //      purchase" interest so CNBC coverage of AAPL matches even if
  //      nobody has connected a brokerage yet holding it).
  //   3. A small set of mega-caps (AAPL, MSFT, NVDA, TSLA, META, GOOGL,
  //      AMZN, etc.) so the dashboard has SOMETHING to surface on day 1
  //      — otherwise demo/empty-brokerage users see a permanently
  //      empty 'In the news' strip.
  //
  // String array only; no userId crosses this boundary.
  const MEGA_CAPS = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "META", "AMZN", "TSLA",
    "AVGO", "BRK.B", "JPM", "V", "MA", "WMT", "XOM", "UNH", "JNJ",
    "PG", "HD", "LLY", "CVX", "ABBV", "MRK", "COST", "PEP", "KO",
    "BAC", "NFLX", "AMD", "ADBE", "CRM", "ORCL", "PLTR", "PYPL",
    "DIS", "INTC", "BA", "F", "GM", "SPY", "QQQ", "DIA", "IWM",
    "VTI", "VOO", "BTC", "ETH", "COIN", "MSTR", "RIOT", "MARA",
  ];
  const universeSet = new Set<string>(MEGA_CAPS);
  try {
    const { rows } = await pool.query(
      `SELECT ticker FROM "holding" WHERE ticker IS NOT NULL
       UNION
       SELECT DISTINCT ticker FROM "recommendation"
        WHERE "createdAt" > NOW() - INTERVAL '60 days'`
    );
    for (const r of rows as Array<{ ticker: string }>) {
      universeSet.add(r.ticker.toUpperCase());
    }
  } catch (err) {
    log.warn("editorial-refresh", "universe lookup failed", errorInfo(err));
  }
  const universe = universeSet;

  const failed: EditorialRefreshResult["failed"] = [];
  let fetched = 0;
  let upserted = 0;

  const allItems: EditorialItem[] = [];
  await Promise.all(
    EDITORIAL_PROVIDERS.map(async (p) => {
      try {
        const items = await fetchProviderItems(p, universe, 25);
        fetched += items.length;
        allItems.push(...items);
      } catch (err) {
        failed.push({
          provider: p.id,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    })
  );

  for (const item of allItems) {
    try {
      await pool.query(
        `INSERT INTO "market_news_daily"
           (id, "publishedAt", provider_id, provider_name,
            category, title, url, summary, tickers_mentioned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           "publishedAt" = EXCLUDED."publishedAt",
           title = EXCLUDED.title,
           summary = EXCLUDED.summary,
           tickers_mentioned = EXCLUDED.tickers_mentioned,
           as_of = NOW()`,
        [
          item.id,
          item.publishedAt,
          item.providerId,
          item.providerName,
          item.category,
          item.title.slice(0, 500),
          item.url.slice(0, 2000),
          item.summary?.slice(0, 4000) ?? null,
          item.tickersMentioned,
        ]
      );
      upserted++;
    } catch (err) {
      log.warn("editorial-refresh", "upsert failed", {
        id: item.id,
        provider: item.providerId,
        ...errorInfo(err),
      });
    }
  }

  // ── Polygon per-ticker sweep ───────────────────────────────────────
  //
  // Pull last 7 days of Polygon news for every ticker in the warehouse
  // universe (held tickers + seed list — see AGENTS.md rule #9 for why
  // getTickerUniverse() is the only sanctioned path). Sequential with a
  // 200ms delay between calls so Polygon's free-tier 5 req/min cap
  // doesn't 429 us out of the sweep.
  //
  // Silent no-op when POLYGON_API_KEY isn't configured — the editorial
  // RSS feeds above already filled the table; we layer Polygon on top
  // when available.
  const polygonStats = {
    enabled: polygonConfigured(),
    tickersScanned: 0,
    fetched: 0,
    upserted: 0,
  };

  if (polygonStats.enabled) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString();
    let universe: string[] = [];
    try {
      universe = await getTickerUniverse();
    } catch (err) {
      log.warn("editorial-refresh", "polygon universe failed", errorInfo(err));
    }
    polygonStats.tickersScanned = universe.length;

    for (const ticker of universe) {
      try {
        const items = await getPolygonNews(ticker, 10, sevenDaysAgo);
        polygonStats.fetched += items.length;
        for (const item of items) {
          if (!item.url || !item.title) continue;
          // Polygon supplies its own stable ID. Prefix with "polygon:"
          // so the namespace can't collide with editorial-RSS hashIds.
          const id = `polygon:${item.id || hashFallback(item.url)}`;
          try {
            await pool.query(
              `INSERT INTO "market_news_daily"
                 (id, "publishedAt", provider_id, provider_name,
                  category, title, url, summary, tickers_mentioned)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (id) DO UPDATE SET
                 "publishedAt" = EXCLUDED."publishedAt",
                 title = EXCLUDED.title,
                 summary = EXCLUDED.summary,
                 tickers_mentioned = EXCLUDED.tickers_mentioned,
                 as_of = NOW()`,
              [
                id,
                item.publishedAt,
                "polygon",
                item.publisher,
                "news",
                item.title.slice(0, 500),
                item.url.slice(0, 2000),
                item.description?.slice(0, 4000) ?? null,
                item.tickers ?? [ticker],
              ]
            );
            polygonStats.upserted++;
          } catch (err) {
            log.warn("editorial-refresh", "polygon upsert failed", {
              ticker,
              id,
              ...errorInfo(err),
            });
          }
        }
      } catch (err) {
        log.warn("editorial-refresh", "polygon fetch failed", {
          ticker,
          ...errorInfo(err),
        });
      }
      // Pace the loop. 200ms × N tickers stays well inside the warm
      // cron window even for ~600 ticker universes.
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Prune old news so the table doesn't accumulate forever. 30 days
  // covers the "what's been in the news about my portfolio this
  // month?" use case; older than that is archival and we don't need it.
  let pruned = 0;
  try {
    const res = await pool.query(
      `DELETE FROM "market_news_daily"
        WHERE "publishedAt" < NOW() - INTERVAL '30 days'`
    );
    pruned = res.rowCount ?? 0;
  } catch (err) {
    log.warn("editorial-refresh", "prune failed", errorInfo(err));
  }

  return {
    providers: EDITORIAL_PROVIDERS.length,
    fetched,
    upserted,
    pruned,
    failed,
    polygon: polygonStats,
  };
}

/** djb2 fallback when Polygon doesn't return an ID — stable hash of url. */
function hashFallback(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
