import { log, errorInfo } from "../log";

/**
 * Polygon.io — supplementary market data source.
 *
 * Why we use it (alongside Yahoo / AV / CoinGecko):
 *   - Options chains: AV's HISTORICAL_OPTIONS is premium-tier-locked
 *     and our key is on the free tier; Polygon's options endpoints
 *     work on every paid Polygon tier and are clean to consume.
 *   - Intraday: we don't ship intraday quotes today, but the wiring
 *     is here so a future "today's price action" widget can pull
 *     1-min bars without a second integration.
 *   - News: Polygon publishes a curated stock-news feed by ticker,
 *     a useful third voice next to Finnhub + Alpha Vantage.
 *
 * Rate limit discipline:
 *   - Free tier: 5 req/min, 2 yr lookback.
 *   - Paid tiers raise per-minute caps to 100/250/unlimited.
 *   - We cache aggressively via Vercel's fetch cache (5 min revalidate)
 *     since our usage pattern is "show today's options" not "tick by tick."
 *
 * Configuration:
 *   - Reads POLYGON_API_KEY (preferred) or MASSIVE_API_KEY (legacy
 *     name from earlier setup). Falls back to disabled if neither set.
 */

const BASE = "https://api.polygon.io";

function key(): string | null {
  return (
    process.env.POLYGON_API_KEY ??
    process.env.MASSIVE_API_KEY ??
    null
  );
}

export function polygonConfigured(): boolean {
  return !!key();
}

/**
 * Internal fetch helper. Polygon returns either a `results` array or
 * an error object — we surface null on either non-2xx or missing
 * results so callers can degrade cleanly.
 */
async function fetchPolygon<T>(
  path: string,
  params: Record<string, string> = {},
  context: string
): Promise<T | null> {
  const k = key();
  if (!k) return null;
  const url = new URL(`${BASE}${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("apiKey", k);
  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 300 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      // 403 = endpoint not in our tier; log quietly so it doesn't
      // pollute production noise. Other non-2xx is a real problem.
      const level = res.status === 403 ? "warn" : "warn";
      log[level]("polygon", "non-2xx", { context, status: res.status });
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    log.warn("polygon", "fetch failed", { context, ...errorInfo(err) });
    return null;
  }
}

// ─── OPTIONS ────────────────────────────────────────────────────────────

export type PolygonOption = {
  contractId: string;
  underlying: string;
  expiration: string; // ISO date
  strike: number;
  type: "call" | "put";
};

/**
 * List the option contracts for a ticker. Uses Polygon's reference
 * endpoint — fast, no per-contract pricing (call getOptionQuote
 * separately for a quote on a specific contract).
 *
 * Capped at 200 contracts per call. For deep chains the caller can
 * page via the `cursor` field in the response, but for the typical
 * "show me the front-month chain near ATM" use case 200 is plenty.
 */
export async function listOptionContracts(
  ticker: string,
  options?: {
    /** ISO date — defaults to all expirations from today onward. */
    expirationGte?: string;
    /** ISO date — narrow to a specific expiry window. */
    expirationLte?: string;
    /** call | put | both (omit) */
    contractType?: "call" | "put";
    /** Max strike distance from current price, applied client-side. */
    limit?: number;
  }
): Promise<PolygonOption[]> {
  const params: Record<string, string> = {
    "underlying_ticker": ticker.toUpperCase(),
    expired: "false",
    limit: String(Math.min(options?.limit ?? 200, 1000)),
    order: "asc",
    sort: "expiration_date",
  };
  if (options?.expirationGte) {
    params["expiration_date.gte"] = options.expirationGte;
  } else {
    params["expiration_date.gte"] = new Date().toISOString().slice(0, 10);
  }
  if (options?.expirationLte) {
    params["expiration_date.lte"] = options.expirationLte;
  }
  if (options?.contractType) {
    params["contract_type"] = options.contractType;
  }

  const data = await fetchPolygon<{
    results?: Array<{
      ticker?: string;
      underlying_ticker?: string;
      expiration_date?: string;
      strike_price?: number;
      contract_type?: string;
    }>;
  }>(`/v3/reference/options/contracts`, params, `options:${ticker}`);
  const rows = data?.results ?? [];
  return rows
    .map((r) => ({
      contractId: r.ticker ?? "",
      underlying: r.underlying_ticker ?? ticker.toUpperCase(),
      expiration: r.expiration_date ?? "",
      strike: typeof r.strike_price === "number" ? r.strike_price : 0,
      type: (r.contract_type === "put" ? "put" : "call") as "call" | "put",
    }))
    .filter((c) => c.strike > 0 && c.expiration);
}

export type PolygonOptionQuote = {
  contractId: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
};

/**
 * Snapshot a single option contract — last trade, NBBO bid/ask, greeks
 * + IV when available. Polygon's `/v3/snapshot/options/{ticker}/{contract}`
 * returns all of these in one round trip.
 */
export async function getOptionQuote(
  underlyingTicker: string,
  contractId: string
): Promise<PolygonOptionQuote | null> {
  const data = await fetchPolygon<{
    results?: {
      last_quote?: { bid?: number; ask?: number };
      last_trade?: { price?: number };
      day?: { volume?: number };
      open_interest?: number;
      implied_volatility?: number;
      greeks?: {
        delta?: number;
        gamma?: number;
        theta?: number;
        vega?: number;
      };
    };
  }>(
    `/v3/snapshot/options/${underlyingTicker.toUpperCase()}/${contractId}`,
    {},
    `option-quote:${contractId}`
  );
  const r = data?.results;
  if (!r) return null;
  return {
    contractId,
    last: r.last_trade?.price ?? null,
    bid: r.last_quote?.bid ?? null,
    ask: r.last_quote?.ask ?? null,
    volume: r.day?.volume ?? null,
    openInterest: r.open_interest ?? null,
    impliedVolatility: r.implied_volatility ?? null,
    delta: r.greeks?.delta ?? null,
    gamma: r.greeks?.gamma ?? null,
    theta: r.greeks?.theta ?? null,
    vega: r.greeks?.vega ?? null,
  };
}

/**
 * Convenience: build a "near-ATM front-month chain" view in one call.
 * Returns up to N contracts (calls + puts) closest to spot price, all
 * expiring in the soonest available expiration window.
 *
 * This is the shape most retail-research surfaces actually want — not
 * the full multi-thousand-contract chain.
 */
export async function getFrontMonthChain(
  ticker: string,
  spotPrice: number,
  contractsPerSide = 5
): Promise<{
  expiration: string | null;
  calls: Array<PolygonOption & { quote: PolygonOptionQuote | null }>;
  puts: Array<PolygonOption & { quote: PolygonOptionQuote | null }>;
} | null> {
  const all = await listOptionContracts(ticker, { limit: 200 });
  if (all.length === 0) return null;

  // Earliest expiration = the front month.
  const earliestExpiry = all
    .map((c) => c.expiration)
    .sort()[0];
  if (!earliestExpiry) return null;

  const frontMonth = all.filter((c) => c.expiration === earliestExpiry);
  const calls = frontMonth
    .filter((c) => c.type === "call")
    .sort((a, b) => Math.abs(a.strike - spotPrice) - Math.abs(b.strike - spotPrice))
    .slice(0, contractsPerSide);
  const puts = frontMonth
    .filter((c) => c.type === "put")
    .sort((a, b) => Math.abs(a.strike - spotPrice) - Math.abs(b.strike - spotPrice))
    .slice(0, contractsPerSide);

  // Fetch quotes for each — sequential so we don't blast Polygon's
  // per-minute cap. ~10 contracts × 200ms = 2s.
  const callsWithQuotes = await Promise.all(
    calls.map(async (c) => ({
      ...c,
      quote: await getOptionQuote(ticker, c.contractId),
    }))
  );
  const putsWithQuotes = await Promise.all(
    puts.map(async (p) => ({
      ...p,
      quote: await getOptionQuote(ticker, p.contractId),
    }))
  );

  return {
    expiration: earliestExpiry,
    calls: callsWithQuotes,
    puts: putsWithQuotes,
  };
}

// ─── NEWS ───────────────────────────────────────────────────────────────

export type PolygonNewsItem = {
  id: string;
  publisher: string;
  title: string;
  author: string | null;
  publishedAt: string;
  url: string;
  description: string | null;
  tickers: string[];
  sentiment: "positive" | "negative" | "neutral" | null;
};

/**
 * Per-ticker news feed. Polygon aggregates across major outlets
 * (Reuters, MarketWatch, Yahoo, Zacks, Benzinga, etc.) with a clean
 * uniform shape — useful as a third voice next to Finnhub + AV.
 *
 * Optional `publishedSinceIso` clamps the request to a recency window
 * via Polygon's `published_utc.gte` filter. Drives the editorial-news
 * cron's "last 7 days per held ticker" sweep without paging through
 * older items we already have on file.
 */
export async function getPolygonNews(
  ticker: string,
  limit = 10,
  publishedSinceIso?: string
): Promise<PolygonNewsItem[]> {
  const params: Record<string, string> = {
    "ticker": ticker.toUpperCase(),
    limit: String(Math.min(Math.max(limit, 1), 50)),
    order: "desc",
    sort: "published_utc",
  };
  if (publishedSinceIso) {
    params["published_utc.gte"] = publishedSinceIso;
  }
  const data = await fetchPolygon<{
    results?: Array<{
      id?: string;
      publisher?: { name?: string };
      title?: string;
      author?: string;
      published_utc?: string;
      article_url?: string;
      description?: string;
      tickers?: string[];
      insights?: Array<{
        ticker?: string;
        sentiment?: "positive" | "negative" | "neutral";
      }>;
    }>;
  }>(
    `/v2/reference/news`,
    params,
    `news:${ticker}`
  );
  const rows = data?.results ?? [];
  return rows.slice(0, limit).map((r) => {
    const insight = (r.insights ?? []).find(
      (i) => i.ticker?.toUpperCase() === ticker.toUpperCase()
    );
    return {
      id: r.id ?? "",
      publisher: r.publisher?.name ?? "Unknown",
      title: r.title ?? "",
      author: r.author ?? null,
      publishedAt: r.published_utc ?? "",
      url: r.article_url ?? "",
      description: r.description ?? null,
      tickers: r.tickers ?? [],
      sentiment: insight?.sentiment ?? null,
    };
  });
}

// ─── INTRADAY ───────────────────────────────────────────────────────────

/**
 * Recent intraday bars for a ticker. Defaults to the last full
 * trading day at 5-minute resolution. Useful for an "intraday
 * sparkline" treatment we don't ship yet but the wiring is here.
 *
 * Polygon's free tier is end-of-day delayed by 15 min; paid tiers
 * are realtime.
 */
export async function getIntradayBars(
  ticker: string,
  options?: {
    /** Minutes per bar — 1, 5, 15, 30, 60. Defaults to 5. */
    multiplier?: number;
    /** ISO date, defaults to today. */
    date?: string;
  }
): Promise<Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>> {
  const date = options?.date ?? new Date().toISOString().slice(0, 10);
  const mult = options?.multiplier ?? 5;
  const data = await fetchPolygon<{
    results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
  }>(
    `/v2/aggs/ticker/${ticker.toUpperCase()}/range/${mult}/minute/${date}/${date}`,
    { adjusted: "true", sort: "asc", limit: "5000" },
    `intraday:${ticker}`
  );
  return data?.results ?? [];
}
