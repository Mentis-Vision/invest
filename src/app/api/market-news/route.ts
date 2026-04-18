import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import {
  getRecentMarketNews,
  getMentionsForTickers,
  getCoverageCounts,
} from "@/lib/data/market-news";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/market-news
 *
 * Modes (driven by query params):
 *   - ?ticker=AAPL                 → articles mentioning AAPL
 *   - ?scope=portfolio             → articles mentioning ANY of the
 *                                    requesting user's holdings
 *   - ?scope=thinker               → just Damodaran / Marks / similar
 *                                    long-form items (low-frequency,
 *                                    high-signal — "worth reading")
 *   - (no params)                  → latest across every provider
 *
 * Reads market_news_daily; never fetches RSS on-demand. The cron
 * populates the table nightly.
 */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(
    { ...RULES.researchUser, name: "market-news:user", limit: 120 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const url = new URL(req.url);
    const ticker = url.searchParams.get("ticker")?.toUpperCase();
    const scope = url.searchParams.get("scope");
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") ?? "10"), 1),
      30
    );

    if (ticker) {
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
        return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
      }
      const [items, coverage] = await Promise.all([
        getMentionsForTickers([ticker], { limit, maxAgeDays: 21 }),
        getCoverageCounts([ticker], { maxAgeDays: 7 }),
      ]);
      return NextResponse.json({
        scope: "ticker",
        ticker,
        items,
        outletCount: coverage[ticker] ?? 0,
      });
    }

    if (scope === "portfolio") {
      const { rows } = await pool.query(
        `SELECT DISTINCT ticker FROM "holding"
          WHERE "userId" = $1 AND ticker IS NOT NULL`,
        [session.user.id]
      );
      const tickers = (rows as Array<{ ticker: string }>).map((r) =>
        r.ticker.toUpperCase()
      );
      if (tickers.length === 0) {
        return NextResponse.json({ scope: "portfolio", items: [], tickers: [] });
      }
      const items = await getMentionsForTickers(tickers, { limit });
      return NextResponse.json({
        scope: "portfolio",
        tickers,
        items,
      });
    }

    if (scope === "thinker") {
      const items = await getRecentMarketNews({
        category: "thinker",
        limit,
        maxAgeDays: 60,
      });
      return NextResponse.json({ scope: "thinker", items });
    }

    const items = await getRecentMarketNews({ limit });
    return NextResponse.json({ scope: "latest", items });
  } catch (err) {
    log.error("market-news.route", "failed", errorInfo(err));
    return NextResponse.json(
      { error: "Could not load market news." },
      { status: 500 }
    );
  }
}
