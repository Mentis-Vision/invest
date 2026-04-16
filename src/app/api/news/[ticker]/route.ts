import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getTickerNews,
  getTickerSentiment,
  finnhubConfigured,
} from "@/lib/data/finnhub";
import { getRecentNews } from "@/lib/data/yahoo-extras";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/news/[ticker]
 * Unified news + sentiment endpoint for the research UI strip.
 * Prefers Finnhub when configured; falls back to Yahoo headlines (no
 * sentiment in that case).
 */
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
    if (finnhubConfigured()) {
      const [news, sent] = await Promise.all([
        getTickerNews(ticker, 14, 8),
        getTickerSentiment(ticker),
      ]);
      return NextResponse.json({
        ticker,
        configured: true,
        source: "finnhub",
        items: news.items,
        sentiment: sent.sentiment ?? null,
        buzz: sent.buzz ?? null,
        companyNewsScore: sent.companyNewsScore ?? null,
        sectorAverageNewsScore: sent.sectorAverageNewsScore ?? null,
      });
    }
    // Yahoo fallback — headlines only
    const y = await getRecentNews(ticker, 8);
    return NextResponse.json({
      ticker,
      configured: false,
      source: "yahoo",
      items: y.items.map((n) => ({
        datetime: n.publishedAt,
        headline: n.title,
        source: n.publisher,
        summary: n.summary,
        url: n.link,
      })),
      sentiment: null,
      buzz: null,
    });
  } catch (err) {
    log.error("news.route", "failed", { ticker, ...errorInfo(err) });
    return NextResponse.json(
      { error: "Could not load news." },
      { status: 500 }
    );
  }
}
