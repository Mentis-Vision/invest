import { log, errorInfo } from "../log";

/**
 * Alpha Vantage — supplementary market data source.
 *
 * Why we use it (alongside Yahoo as primary):
 *   - Cross-verification: when Yahoo and AV agree on a price within ε,
 *     mark the datum "verified across 2 sources." Catches Yahoo's
 *     equity-namesake collisions (BTC → Bitgreen, LINK → Interlink, etc.).
 *   - Crypto coverage: AV's DIGITAL_CURRENCY_DAILY actually returns the
 *     crypto, not an equity ticker that happens to share the symbol.
 *   - News: NEWS_SENTIMENT supplements Finnhub when configured, gives a
 *     second sentiment source for cross-check.
 *   - Earnings transcripts (premium): if the user's tier supports it,
 *     unlocks a data dimension Yahoo + SEC don't provide.
 *
 * Rate-limit discipline:
 *   - Free tier: ~25 requests/day, 5 req/min. Tight.
 *   - Premium tiers: 75-1200 req/min depending on plan.
 *   - We back off on 429 / 'Note' field appearing in the response (which
 *     AV uses for soft rate-limit signals instead of HTTP 429).
 *   - Every public function returns null on failure so callers degrade
 *     gracefully.
 */

const BASE = "https://www.alphavantage.co/query";

function key(): string | null {
  return process.env.ALPHA_VANTAGE_API_KEY ?? null;
}

export function alphaVantageConfigured(): boolean {
  return !!key();
}

/**
 * Internal fetch helper. Handles AV's two failure modes:
 *   1. Hard error: HTTP non-2xx → throws caught upstream
 *   2. Soft error: 200 OK but the JSON body has 'Note' or 'Information'
 *      field instead of the expected data — typically rate limiting.
 *      We treat as failure (return null).
 */
async function fetchAV<T>(
  params: Record<string, string>,
  context: string
): Promise<T | null> {
  const k = key();
  if (!k) return null;
  const url = new URL(BASE);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("apikey", k);
  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 300 }, // 5-min Vercel fetch cache
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      log.warn("alpha-vantage", "non-2xx", {
        context,
        status: res.status,
      });
      return null;
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (
      typeof data?.Note === "string" ||
      typeof data?.Information === "string"
    ) {
      log.warn("alpha-vantage", "soft-failure (rate limit?)", {
        context,
        note:
          (data.Note as string | undefined)?.slice(0, 200) ??
          (data.Information as string | undefined)?.slice(0, 200),
      });
      return null;
    }
    return data as T;
  } catch (err) {
    log.warn("alpha-vantage", "fetch failed", {
      context,
      ...errorInfo(err),
    });
    return null;
  }
}

// ─── EQUITY ─────────────────────────────────────────────────────────────

export type AVQuote = {
  symbol: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  latestTradingDay: string | null;
};

/**
 * GLOBAL_QUOTE — fast snapshot of one ticker. Used for cross-verification
 * against Yahoo's quote. ~1 req per ticker.
 */
export async function getEquityQuote(
  ticker: string
): Promise<AVQuote | null> {
  const data = await fetchAV<{ "Global Quote"?: Record<string, string> }>(
    { function: "GLOBAL_QUOTE", symbol: ticker.toUpperCase() },
    `quote:${ticker}`
  );
  const q = data?.["Global Quote"];
  if (!q || Object.keys(q).length === 0) return null;
  const num = (s: string | undefined): number | null => {
    if (!s) return null;
    const v = Number(s.replace(/%$/, ""));
    return Number.isFinite(v) ? v : null;
  };
  const price = num(q["05. price"]);
  if (price == null) return null;
  return {
    symbol: q["01. symbol"] ?? ticker.toUpperCase(),
    price,
    open: num(q["02. open"]),
    high: num(q["03. high"]),
    low: num(q["04. low"]),
    volume: num(q["06. volume"]),
    previousClose: num(q["08. previous close"]),
    change: num(q["09. change"]),
    changePercent: num(q["10. change percent"]),
    latestTradingDay: q["07. latest trading day"] ?? null,
  };
}

export type AVCompanyOverview = {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  peRatio: number | null;
  pegRatio: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  eps: number | null;
  profitMargin: number | null;
  operatingMargin: number | null;
  returnOnAssets: number | null;
  returnOnEquity: number | null;
  revenueTtm: number | null;
  grossProfitTtm: number | null;
  ebitda: number | null;
  high52w: number | null;
  low52w: number | null;
  ma50: number | null;
  ma200: number | null;
  beta: number | null;
  sharesOutstanding: number | null;
  analystTargetPrice: number | null;
};

/**
 * OVERVIEW — company fundamentals snapshot. Useful as cross-check for
 * Yahoo's quoteSummary numbers (P/E, market cap, etc.). One call returns
 * ~50 fields.
 */
export async function getCompanyOverview(
  ticker: string
): Promise<AVCompanyOverview | null> {
  const data = await fetchAV<Record<string, string>>(
    { function: "OVERVIEW", symbol: ticker.toUpperCase() },
    `overview:${ticker}`
  );
  if (!data || !data.Symbol) return null;
  const num = (s: string | undefined): number | null => {
    if (!s || s === "None" || s === "-") return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  };
  return {
    symbol: data.Symbol,
    name: data.Name ?? null,
    sector: data.Sector ?? null,
    industry: data.Industry ?? null,
    marketCap: num(data.MarketCapitalization),
    peRatio: num(data.PERatio),
    pegRatio: num(data.PEGRatio),
    bookValue: num(data.BookValue),
    dividendYield: num(data.DividendYield),
    eps: num(data.EPS),
    profitMargin: num(data.ProfitMargin),
    operatingMargin: num(data.OperatingMarginTTM),
    returnOnAssets: num(data.ReturnOnAssetsTTM),
    returnOnEquity: num(data.ReturnOnEquityTTM),
    revenueTtm: num(data.RevenueTTM),
    grossProfitTtm: num(data.GrossProfitTTM),
    ebitda: num(data.EBITDA),
    high52w: num(data["52WeekHigh"]),
    low52w: num(data["52WeekLow"]),
    ma50: num(data["50DayMovingAverage"]),
    ma200: num(data["200DayMovingAverage"]),
    beta: num(data.Beta),
    sharesOutstanding: num(data.SharesOutstanding),
    analystTargetPrice: num(data.AnalystTargetPrice),
  };
}

// ─── CRYPTO ─────────────────────────────────────────────────────────────

export type AVCryptoQuote = {
  symbol: string;
  fiatCurrency: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * DIGITAL_CURRENCY_DAILY — daily OHLCV for a crypto symbol.
 * Returns the most recent day's bar.
 *
 * IMPORTANT: AV's crypto symbols are 3-4 letter coin codes (BTC, ETH,
 * LINK, ATOM). Pass the COIN symbol, not Yahoo's BTC-USD format.
 *
 * Fixes the bug where Yahoo resolved "BTC" → Bitgreen (a $33 stock) and
 * "LINK" → Interlink Electronics ($3 stock) instead of the actual
 * cryptocurrencies.
 */
export async function getCryptoDaily(
  symbol: string,
  fiatCurrency: string = "USD"
): Promise<AVCryptoQuote | null> {
  const data = await fetchAV<{
    "Time Series (Digital Currency Daily)"?: Record<
      string,
      Record<string, string>
    >;
  }>(
    {
      function: "DIGITAL_CURRENCY_DAILY",
      symbol: symbol.toUpperCase(),
      market: fiatCurrency.toUpperCase(),
    },
    `crypto:${symbol}`
  );
  const series = data?.["Time Series (Digital Currency Daily)"];
  if (!series) return null;
  const dates = Object.keys(series).sort().reverse();
  if (dates.length === 0) return null;
  const latestDate = dates[0];
  const bar = series[latestDate];
  const num = (s: string | undefined): number => Number(s ?? 0);
  return {
    symbol: symbol.toUpperCase(),
    fiatCurrency: fiatCurrency.toUpperCase(),
    date: latestDate,
    open: num(bar["1. open"]),
    high: num(bar["2. high"]),
    low: num(bar["3. low"]),
    close: num(bar["4. close"]),
    volume: num(bar["5. volume"]),
  };
}

/**
 * CURRENCY_EXCHANGE_RATE — realtime crypto-to-fiat rate. Lighter than
 * DIGITAL_CURRENCY_DAILY (one number, not a 365-day series). Use this
 * for spot price; fall back to daily for OHLCV.
 */
export async function getCryptoSpot(
  symbol: string,
  fiatCurrency: string = "USD"
): Promise<{ symbol: string; price: number; lastRefreshed: string } | null> {
  const data = await fetchAV<{
    "Realtime Currency Exchange Rate"?: Record<string, string>;
  }>(
    {
      function: "CURRENCY_EXCHANGE_RATE",
      from_currency: symbol.toUpperCase(),
      to_currency: fiatCurrency.toUpperCase(),
    },
    `crypto-spot:${symbol}`
  );
  const r = data?.["Realtime Currency Exchange Rate"];
  if (!r) return null;
  const price = Number(r["5. Exchange Rate"]);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    symbol: symbol.toUpperCase(),
    price,
    lastRefreshed: r["6. Last Refreshed"] ?? "",
  };
}

// ─── NEWS ───────────────────────────────────────────────────────────────

export type AVNewsItem = {
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  summary: string | null;
  /** Per-article overall sentiment label */
  overallSentimentLabel: string | null;
  /** Per-article sentiment score, -1..1 */
  overallSentimentScore: number | null;
  /** Sentiment specifically toward the queried ticker */
  tickerSentiment: number | null;
};

/**
 * NEWS_SENTIMENT — news + per-article sentiment scoring.
 * Supplements Finnhub. Useful when Finnhub is unconfigured or when we
 * want a second sentiment voice for cross-check.
 */
export async function getNewsSentiment(
  ticker: string,
  limit: number = 10
): Promise<AVNewsItem[]> {
  const data = await fetchAV<{
    feed?: Array<{
      title?: string;
      url?: string;
      time_published?: string;
      source?: string;
      summary?: string;
      overall_sentiment_label?: string;
      overall_sentiment_score?: number;
      ticker_sentiment?: Array<{
        ticker?: string;
        ticker_sentiment_score?: string;
      }>;
    }>;
  }>(
    {
      function: "NEWS_SENTIMENT",
      tickers: ticker.toUpperCase(),
      limit: String(Math.min(Math.max(limit, 1), 50)),
      sort: "LATEST",
    },
    `news:${ticker}`
  );
  const feed = data?.feed ?? [];
  return feed.slice(0, limit).map((item) => {
    const ts = (item.ticker_sentiment ?? []).find(
      (t) => t.ticker?.toUpperCase() === ticker.toUpperCase()
    );
    return {
      title: item.title ?? "",
      url: item.url ?? "",
      // AV format: 20260417T143000 → ISO
      publishedAt: parseAvTimestamp(item.time_published),
      source: item.source ?? "",
      summary: item.summary ?? null,
      overallSentimentLabel: item.overall_sentiment_label ?? null,
      overallSentimentScore:
        typeof item.overall_sentiment_score === "number"
          ? item.overall_sentiment_score
          : null,
      tickerSentiment:
        ts && typeof ts.ticker_sentiment_score === "string"
          ? Number(ts.ticker_sentiment_score)
          : null,
    };
  });
}

function parseAvTimestamp(raw: string | undefined): string {
  if (!raw || raw.length < 8) return "";
  // AV uses YYYYMMDDTHHMMSS
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  const time =
    raw.length >= 15
      ? `${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`
      : "00:00:00Z";
  return `${y}-${m}-${d}T${time}`;
}

// ─── EARNINGS TRANSCRIPTS (PREMIUM) ─────────────────────────────────────

export type AVEarningsTranscript = {
  symbol: string;
  quarter: string;
  speakers: Array<{ speaker: string; title: string | null; content: string }>;
};

/**
 * EARNINGS_CALL_TRANSCRIPT — premium endpoint. Pulls the most-recent
 * earnings call transcript for a ticker. Returns null if the user's tier
 * doesn't include this endpoint (free tier doesn't).
 */
export async function getEarningsTranscript(
  ticker: string,
  quarter: string = "latest"
): Promise<AVEarningsTranscript | null> {
  const data = await fetchAV<{
    symbol?: string;
    quarter?: string;
    transcript?: Array<{
      speaker?: string;
      title?: string;
      content?: string;
    }>;
  }>(
    {
      function: "EARNINGS_CALL_TRANSCRIPT",
      symbol: ticker.toUpperCase(),
      quarter,
    },
    `transcript:${ticker}`
  );
  if (!data?.transcript || data.transcript.length === 0) return null;
  return {
    symbol: data.symbol ?? ticker.toUpperCase(),
    quarter: data.quarter ?? quarter,
    speakers: data.transcript.map((s) => ({
      speaker: s.speaker ?? "Unknown",
      title: s.title ?? null,
      content: s.content ?? "",
    })),
  };
}

// ─── OPTIONS (PREMIUM) ──────────────────────────────────────────────────

export type AVOption = {
  contractId: string;
  symbol: string;
  expiration: string;
  strike: number;
  type: "call" | "put";
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
  rho: number | null;
};

/**
 * HISTORICAL_OPTIONS — premium endpoint. Returns the option chain for a
 * ticker on a given date (defaults to today). Returns empty array if the
 * tier doesn't include it.
 *
 * Note: even on premium, the response is large. We cap at 200 contracts
 * by ATM proximity to keep the response sane for downstream callers.
 */
export async function getOptionsChain(
  ticker: string,
  spotPrice?: number,
  date?: string
): Promise<AVOption[]> {
  const params: Record<string, string> = {
    function: "HISTORICAL_OPTIONS",
    symbol: ticker.toUpperCase(),
  };
  if (date) params.date = date;
  const data = await fetchAV<{
    data?: Array<{
      contractID?: string;
      symbol?: string;
      expiration?: string;
      strike?: string;
      type?: string;
      last?: string;
      bid?: string;
      ask?: string;
      volume?: string;
      open_interest?: string;
      implied_volatility?: string;
      delta?: string;
      gamma?: string;
      theta?: string;
      vega?: string;
      rho?: string;
    }>;
  }>(params, `options:${ticker}`);
  const contracts = data?.data ?? [];
  if (contracts.length === 0) return [];
  const num = (s: string | undefined): number | null => {
    if (!s) return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  };
  const enriched: AVOption[] = contracts
    .map((c) => ({
      contractId: c.contractID ?? "",
      symbol: c.symbol ?? ticker.toUpperCase(),
      expiration: c.expiration ?? "",
      strike: num(c.strike) ?? 0,
      type: (c.type === "put" ? "put" : "call") as "call" | "put",
      last: num(c.last),
      bid: num(c.bid),
      ask: num(c.ask),
      volume: num(c.volume),
      openInterest: num(c.open_interest),
      impliedVolatility: num(c.implied_volatility),
      delta: num(c.delta),
      gamma: num(c.gamma),
      theta: num(c.theta),
      vega: num(c.vega),
      rho: num(c.rho),
    }))
    .filter((c) => c.strike > 0);
  // Cap at 200 contracts by ATM proximity if a spot price was given
  if (spotPrice && enriched.length > 200) {
    enriched.sort(
      (a, b) =>
        Math.abs(a.strike - spotPrice) - Math.abs(b.strike - spotPrice)
    );
    return enriched.slice(0, 200);
  }
  return enriched.slice(0, 200);
}
