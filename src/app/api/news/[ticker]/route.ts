import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getTickerNews,
  getTickerSentiment,
  finnhubConfigured,
} from "@/lib/data/finnhub";
import { getRecentNews } from "@/lib/data/yahoo-extras";
import { getPolygonNews, polygonConfigured } from "@/lib/data/polygon";
import { getSeekingAlphaForTicker } from "@/lib/data/seeking-alpha";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/news/[ticker]
 *
 * Unified news + sentiment endpoint for the research UI strip.
 * Aggregates across every configured news source (Finnhub, Polygon,
 * Seeking Alpha, Yahoo fallback), deduplicates by URL, returns the
 * merged feed sorted newest-first with each item tagged by source.
 *
 * The "right" answer is multi-source — different outlets surface
 * different stories. Finnhub leans newswire (Reuters, MarketWatch).
 * Polygon enriches with Benzinga + Zacks + per-article sentiment.
 * Seeking Alpha adds independent commentary (opinion, not just news).
 */

type UnifiedNewsItem = {
  datetime: string;
  headline: string;
  source: string | null;
  summary: string | null;
  url: string | null;
  /** Provider that surfaced this item (finnhub | polygon | seeking_alpha | yahoo). */
  provider: "finnhub" | "polygon" | "seeking_alpha" | "yahoo";
  /** Per-article sentiment when the provider scored it (Polygon does, others don't). */
  sentiment?: "positive" | "negative" | "neutral" | null;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const rl = await checkRateLimit(
    { ...RULES.researchUser, name: "news:user", limit: 60 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    // Fan out to every configured provider in parallel. Each call
    // catches its own errors and returns an empty list on failure so
    // one bad provider can't blank the whole feed.
    const [finnhubNews, finnhubSent, polygonNews, saItems] = await Promise.all([
      finnhubConfigured()
        ? getTickerNews(ticker, 14, 8).catch(() => null)
        : Promise.resolve(null),
      finnhubConfigured()
        ? getTickerSentiment(ticker).catch(() => null)
        : Promise.resolve(null),
      polygonConfigured()
        ? getPolygonNews(ticker, 8).catch(() => [])
        : Promise.resolve([]),
      getSeekingAlphaForTicker(ticker, 5).catch(() => []),
    ]);

    // Compose unified item list. Provider-tagged so the UI can show
    // a small chip per item ("Reuters · via Finnhub", "Seeking Alpha
    // commentary", etc.).
    const merged: UnifiedNewsItem[] = [];
    const seen = new Set<string>();
    const pushUnique = (item: UnifiedNewsItem) => {
      const key = (item.url ?? item.headline).toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    };

    for (const n of finnhubNews?.items ?? []) {
      pushUnique({
        datetime: n.datetime,
        headline: n.headline,
        source: n.source,
        summary: n.summary,
        url: n.url,
        provider: "finnhub",
        sentiment: null,
      });
    }
    for (const n of polygonNews) {
      pushUnique({
        datetime: n.publishedAt,
        headline: n.title,
        source: n.publisher,
        summary: n.description,
        url: n.url,
        provider: "polygon",
        sentiment: n.sentiment,
      });
    }
    for (const n of saItems) {
      pushUnique({
        datetime: n.publishedAt,
        headline: n.title,
        source: n.author ?? "Seeking Alpha",
        summary: n.summary,
        url: n.url,
        provider: "seeking_alpha",
        sentiment: null,
      });
    }

    // Last-resort fallback: when no provider had anything, fall back
    // to Yahoo headlines (lowest signal but at least non-empty).
    if (merged.length === 0) {
      try {
        const y = await getRecentNews(ticker, 8);
        for (const n of y.items) {
          pushUnique({
            datetime: n.publishedAt ?? "",
            headline: n.title,
            source: n.publisher,
            summary: n.summary,
            url: n.link,
            provider: "yahoo",
            sentiment: null,
          });
        }
      } catch {
        /* truly nothing — empty list is correct */
      }
    }

    // Newest first.
    merged.sort((a, b) => {
      const ad = new Date(a.datetime).getTime() || 0;
      const bd = new Date(b.datetime).getTime() || 0;
      return bd - ad;
    });

    const sourcesUsed = Array.from(
      new Set(merged.map((m) => m.provider))
    );

    return NextResponse.json({
      ticker,
      configured: merged.length > 0,
      sources: sourcesUsed,
      items: merged.slice(0, 12),
      sentiment: finnhubSent?.sentiment ?? null,
      buzz: finnhubSent?.buzz ?? null,
      companyNewsScore: finnhubSent?.companyNewsScore ?? null,
      sectorAverageNewsScore: finnhubSent?.sectorAverageNewsScore ?? null,
    });
  } catch (err) {
    log.error("news.route", "failed", { ticker, ...errorInfo(err) });
    return NextResponse.json(
      { error: "Could not load news." },
      { status: 500 }
    );
  }
}
