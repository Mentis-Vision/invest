import { log, errorInfo } from "../log";

/**
 * Finnhub integration — news headlines + ticker sentiment aggregate.
 *
 * Free tier: 60 req/min, rolling. We use it for (a) per-ticker company
 * news headlines, and (b) aggregated news sentiment (buzz + score).
 *
 * When FINNHUB_API_KEY is unset, every helper returns a "not configured"
 * shape so routes and tools can render gracefully without the key. That
 * matches the Plaid-then-SnapTrade and Resend defer-to-wire patterns
 * used elsewhere in the repo.
 *
 * Docs: https://finnhub.io/docs/api/company-news
 *       https://finnhub.io/docs/api/news-sentiment
 */

const BASE = "https://finnhub.io/api/v1";

export function finnhubConfigured(): boolean {
  return !!process.env.FINNHUB_API_KEY;
}

function key(): string | null {
  return process.env.FINNHUB_API_KEY ?? null;
}

export type NewsHeadline = {
  id: number | string;
  datetime: string;
  headline: string;
  source: string | null;
  summary: string | null;
  url: string | null;
  image: string | null;
  category: string | null;
};

export type TickerNews = {
  ticker: string;
  windowDays: number;
  configured: boolean;
  items: NewsHeadline[];
  source: "finnhub";
  asOf: string;
  notConfiguredMessage?: string;
};

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getTickerNews(
  ticker: string,
  windowDays = 14,
  limit = 10
): Promise<TickerNews> {
  const asOf = new Date().toISOString();
  const apiKey = key();
  if (!apiKey) {
    return {
      ticker,
      windowDays,
      configured: false,
      items: [],
      source: "finnhub",
      asOf,
      notConfiguredMessage:
        "News feed not configured. Set FINNHUB_API_KEY in environment to enable per-ticker headlines and sentiment.",
    };
  }

  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 86400000);
  const url = new URL(`${BASE}/company-news`);
  url.searchParams.set("symbol", ticker.toUpperCase());
  url.searchParams.set("from", fmtDate(from));
  url.searchParams.set("to", fmtDate(to));
  url.searchParams.set("token", apiKey);

  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 900 }, // 15 min cache
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      log.warn("finnhub", "company-news non-2xx", { status: res.status });
      return {
        ticker,
        windowDays,
        configured: true,
        items: [],
        source: "finnhub",
        asOf,
      };
    }
    const raw = (await res.json()) as Array<{
      id?: number;
      datetime?: number;
      headline?: string;
      source?: string;
      summary?: string;
      url?: string;
      image?: string;
      category?: string;
    }>;
    const items: NewsHeadline[] = raw
      .slice(0, limit)
      .filter((n) => n.headline)
      .map((n) => ({
        id: n.id ?? `${n.datetime}-${n.headline?.slice(0, 20)}`,
        datetime: n.datetime
          ? new Date(n.datetime * 1000).toISOString()
          : new Date().toISOString(),
        headline: n.headline ?? "",
        source: n.source ?? null,
        summary: n.summary ?? null,
        url: n.url ?? null,
        image: n.image ?? null,
        category: n.category ?? null,
      }));
    return {
      ticker,
      windowDays,
      configured: true,
      items,
      source: "finnhub",
      asOf,
    };
  } catch (err) {
    log.warn("finnhub", "company-news fetch failed", {
      ticker,
      ...errorInfo(err),
    });
    return {
      ticker,
      windowDays,
      configured: true,
      items: [],
      source: "finnhub",
      asOf,
    };
  }
}

export type NewsSentiment = {
  ticker: string;
  configured: boolean;
  /** Finnhub's "buzz" block: company-mentioned articles per week + trend. */
  buzz?: {
    articlesInLastWeek: number;
    weeklyAverage: number;
    buzz: number; // articlesInLastWeek / weeklyAverage
  };
  companyNewsScore?: number; // -1..1
  sectorAverageNewsScore?: number;
  sentiment?: {
    bearishPercent: number;
    bullishPercent: number;
  };
  asOf: string;
  source: "finnhub";
  notConfiguredMessage?: string;
};

export async function getTickerSentiment(
  ticker: string
): Promise<NewsSentiment> {
  const asOf = new Date().toISOString();
  const apiKey = key();
  if (!apiKey) {
    return {
      ticker,
      configured: false,
      asOf,
      source: "finnhub",
      notConfiguredMessage:
        "News sentiment not configured. Set FINNHUB_API_KEY to enable.",
    };
  }

  const url = new URL(`${BASE}/news-sentiment`);
  url.searchParams.set("symbol", ticker.toUpperCase());
  url.searchParams.set("token", apiKey);

  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 3600 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      log.warn("finnhub", "sentiment non-2xx", { status: res.status });
      return { ticker, configured: true, asOf, source: "finnhub" };
    }
    const data = (await res.json()) as {
      buzz?: {
        articlesInLastWeek?: number;
        weeklyAverage?: number;
        buzz?: number;
      };
      companyNewsScore?: number;
      sectorAverageNewsScore?: number;
      sentiment?: { bearishPercent?: number; bullishPercent?: number };
    };
    const buzz = data.buzz
      ? {
          articlesInLastWeek: data.buzz.articlesInLastWeek ?? 0,
          weeklyAverage: data.buzz.weeklyAverage ?? 0,
          buzz: data.buzz.buzz ?? 0,
        }
      : undefined;
    const sentiment = data.sentiment
      ? {
          bearishPercent: data.sentiment.bearishPercent ?? 0,
          bullishPercent: data.sentiment.bullishPercent ?? 0,
        }
      : undefined;
    return {
      ticker,
      configured: true,
      buzz,
      companyNewsScore: data.companyNewsScore,
      sectorAverageNewsScore: data.sectorAverageNewsScore,
      sentiment,
      asOf,
      source: "finnhub",
    };
  } catch (err) {
    log.warn("finnhub", "sentiment fetch failed", {
      ticker,
      ...errorInfo(err),
    });
    return { ticker, configured: true, asOf, source: "finnhub" };
  }
}
