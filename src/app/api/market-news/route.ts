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
 *   - ?scope=market                → general market news (no holdings
 *                                    filter). Used as a fallback when
 *                                    portfolio-scoped freshness yields
 *                                    too few items.
 *   - ?scope=thinker               → just Damodaran / Marks / similar
 *                                    long-form items (low-frequency,
 *                                    high-signal — "worth reading")
 *   - (no params)                  → latest across every provider
 *
 * Freshness (?freshness=24h | 72h | 7d):
 *   - 24h / 72h are tighter caps than the per-mode default. 7d (the
 *     default) preserves the prior route behavior so existing callers
 *     don't see a coverage drop.
 *   - Trust tenet: stale items don't masquerade as current. The cap
 *     applied is echoed back in the response so consumers know what
 *     window they're rendering.
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

    // Freshness cap. Defaults to 7d to preserve backward compat with
    // existing callers. 24h / 72h are explicit asks for "current
    // headlines only" — trust tenet: yesterday's news doesn't get to
    // sit on a dashboard claiming to be today's.
    const rawFreshness = url.searchParams.get("freshness");
    const freshness: "24h" | "72h" | "7d" =
      rawFreshness === "24h" || rawFreshness === "72h" || rawFreshness === "7d"
        ? rawFreshness
        : "7d";
    const freshnessDays =
      freshness === "24h" ? 1 : freshness === "72h" ? 3 : 7;

    if (ticker) {
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
        return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
      }
      const [items, coverage] = await Promise.all([
        getMentionsForTickers([ticker], { limit, maxAgeDays: freshnessDays }),
        getCoverageCounts([ticker], {
          maxAgeDays: Math.min(freshnessDays, 7),
        }),
      ]);
      return NextResponse.json({
        scope: "ticker",
        ticker,
        freshness,
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
        return NextResponse.json({
          scope: "portfolio",
          freshness,
          items: [],
          tickers: [],
        });
      }
      const items = await getMentionsForTickers(tickers, {
        limit,
        maxAgeDays: freshnessDays,
      });
      return NextResponse.json({
        scope: "portfolio",
        freshness,
        tickers,
        items,
      });
    }

    if (scope === "market") {
      // No holdings filter — general market news within the freshness
      // cap. Used as the BlockNews fallback when portfolio-scoped
      // results come up thin.
      const items = await getRecentMarketNews({
        limit,
        maxAgeDays: freshnessDays,
      });
      return NextResponse.json({ scope: "market", freshness, items });
    }

    if (scope === "thinker") {
      // 14-day window — earlier we used 60 days on the theory that
      // Damodaran / Marks pieces are evergreen, but the surface
      // started feeling stale (users saw 2–3 week old pieces on a
      // dashboard meant to capture "what changed recently"). Keep
      // this tight; if there are no recent picks, Worth Reading
      // hides itself entirely.
      const items = await getRecentMarketNews({
        category: "thinker",
        limit,
        maxAgeDays: 14,
      });
      return NextResponse.json({ scope: "thinker", items });
    }

    const items = await getRecentMarketNews({
      limit,
      maxAgeDays: freshnessDays,
    });
    return NextResponse.json({ scope: "latest", freshness, items });
  } catch (err) {
    log.error("market-news.route", "failed", errorInfo(err));
    return NextResponse.json(
      { error: "Could not load market news." },
      { status: 500 }
    );
  }
}
