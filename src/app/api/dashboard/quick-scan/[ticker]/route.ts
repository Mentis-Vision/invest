import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { getTickerMarket } from "@/lib/warehouse/market";
import { getMentionsForTickers } from "@/lib/data/market-news";
import { log, errorInfo } from "@/lib/log";
import { checkRateLimit, RULES } from "@/lib/rate-limit";

/**
 * GET /api/dashboard/quick-scan/[ticker]
 *
 * Returns the 9-field shape the QuickScanStrip component needs.
 * Data sources (all free, $0 AI):
 *   - ticker_market_daily via getTickerMarket() → price, change, 52w range, RSI
 *   - ticker_market_daily direct query → 30d price move
 *   - ticker_metadata → company name
 *   - holding (user-scoped) → avgCostBasis, unrealizedPct
 *   - market_news_daily → latestHeadline
 *
 * Auth-gated (session required for holding lookup).
 * Rate-limited at 60/hr per user (cheap DB reads, no AI).
 */

export type QuickScanData = {
  ticker: string;
  name: string | null;
  lastPrice: number | null;
  changePct: number | null;
  range52w: { low: number | null; high: number | null } | null;
  avgCostBasis: number | null;
  unrealizedPct: number | null;
  move30d: number | null;
  rsi14: number | null;
  latestHeadline: { source: string; title: string; whenAgo: string } | null;
};

function whenAgo(isoStr: string | null): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "";
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 60) return `${Math.max(diffMin, 0)}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 30) return `${diffDay}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const rl = await checkRateLimit(
    { ...RULES.researchUser, name: "dashboard:quick-scan", limit: 60 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const userId = session.user.id;

    // ── Parallel fetch all data sources ──────────────────────────────────────
    const [market, nameRow, holdingRow, move30dRow, newsItems] =
      await Promise.all([
        // 1. Latest warehouse market row (price, change, 52w range, RSI14)
        getTickerMarket(ticker),

        // 2. Company name from ticker_metadata
        pool
          .query(
            `SELECT name FROM "ticker_metadata" WHERE ticker = $1 LIMIT 1`,
            [ticker]
          )
          .then((r) => (r.rows[0] as { name: string | null } | undefined) ?? null)
          .catch(() => null),

        // 3. User's holding row for avgCostBasis
        pool
          .query(
            `SELECT "avgPrice", "lastPrice" FROM "holding"
             WHERE "userId" = $1 AND ticker = $2 LIMIT 1`,
            [userId, ticker]
          )
          .then(
            (r) =>
              (r.rows[0] as {
                avgPrice: string | number | null;
                lastPrice: string | number | null;
              } | undefined) ?? null
          )
          .catch(() => null),

        // 4. 30-day price move: latest close vs close ~30 days ago
        pool
          .query(
            `SELECT
               (SELECT close FROM "ticker_market_daily"
                WHERE ticker = $1 ORDER BY captured_at DESC LIMIT 1) AS latest,
               (SELECT close FROM "ticker_market_daily"
                WHERE ticker = $1 AND captured_at <= CURRENT_DATE - 30
                ORDER BY captured_at DESC LIMIT 1) AS prior`,
            [ticker]
          )
          .then(
            (r) =>
              (r.rows[0] as {
                latest: string | number | null;
                prior: string | number | null;
              } | undefined) ?? null
          )
          .catch(() => null),

        // 5. Latest headline from market_news_daily
        getMentionsForTickers([ticker], { limit: 1, maxAgeDays: 14 }),
      ]);

    // ── Compute derived fields ────────────────────────────────────────────────

    const lastPrice = market?.close ?? null;
    const changePct = market?.changePct ?? null;

    const range52w =
      market?.high52w != null || market?.low52w != null
        ? { low: market?.low52w ?? null, high: market?.high52w ?? null }
        : null;

    const avgCostBasis =
      holdingRow?.avgPrice != null ? Number(holdingRow.avgPrice) : null;

    let unrealizedPct: number | null = null;
    if (avgCostBasis != null && avgCostBasis > 0 && lastPrice != null) {
      unrealizedPct = ((lastPrice - avgCostBasis) / avgCostBasis) * 100;
    }

    let move30d: number | null = null;
    if (move30dRow?.latest != null && move30dRow?.prior != null) {
      const latest = Number(move30dRow.latest);
      const prior = Number(move30dRow.prior);
      if (prior > 0) {
        move30d = ((latest - prior) / prior) * 100;
      }
    }

    const rsi14 = market?.rsi14 ?? null;

    let latestHeadline: QuickScanData["latestHeadline"] = null;
    if (newsItems.length > 0) {
      const n = newsItems[0];
      latestHeadline = {
        source: n.providerName,
        title: n.title.slice(0, 200),
        whenAgo: whenAgo(n.publishedAt),
      };
    }

    const payload: QuickScanData = {
      ticker,
      name: nameRow?.name ?? null,
      lastPrice,
      changePct,
      range52w,
      avgCostBasis,
      unrealizedPct,
      move30d,
      rsi14,
      latestHeadline,
    };

    return NextResponse.json(payload, {
      headers: {
        // Cache for 5 minutes — data is refreshed nightly, intraday
        // freshness via changePct from the warehouse row is sufficient.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    log.error("dashboard.quick-scan", "failed", {
      ticker,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not load quick-scan data." },
      { status: 500 }
    );
  }
}
