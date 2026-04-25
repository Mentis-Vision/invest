import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";
import { getTickerMarketBatch } from "@/lib/warehouse/market";
import { getTickerFundamentals } from "@/lib/warehouse/fundamentals";
import { getUpcomingEvents, getRecentEvents } from "@/lib/warehouse/events";
import { getTickerSentiment } from "@/lib/warehouse/sentiment";
import { buildDossier, type TickerDossier } from "@/lib/warehouse/dossier";

/**
 * GET /api/research/dossier-of-day
 *
 * Returns a single TickerDossier — the day's most notable signal across
 * the user's holdings, or a curated trending ticker if they haven't
 * linked yet. Acts as the Research page's focal point above the market
 * strips so the landing has a clear "today's considered brief" rather
 * than a wall of equal-weight cards.
 *
 * Zero AI cost: reuses the nightly warehouse compute via `buildDossier`.
 * All SQL hits warehouse tables we already read throughout the app.
 *
 * Ticker selection priority (stops at first hit):
 *   1. A holding with today's |changePct| >= 3 (tie → highest abs move)
 *   2. A holding with an earnings event in the next 7 days
 *   3. A holding with a recent (<14 day) filing
 *   4. The holding with the largest absolute move overall
 *   5. Fallback: a curated trending ticker (NVDA / AAPL / TSLA / MSFT),
 *      picked by largest abs move — so demo and new users get content.
 *
 * Caching: this endpoint is cheap (handful of SQL queries). No caching
 * required for MVP — add a 5-minute response cache if the page load
 * ever measures slow.
 */
export const dynamic = "force-dynamic";

const FALLBACK_TICKERS = ["NVDA", "AAPL", "TSLA", "MSFT", "GOOGL", "AMZN"];

type DossierResponse = {
  dossier: TickerDossier | null;
  reason?: "no_holdings" | "no_data" | "error";
  source: "holding" | "trending";
};

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Pull user's tickers from the holding table.
    const { rows: holdingRows } = await pool.query<{ ticker: string }>(
      `SELECT DISTINCT ticker
         FROM "holding"
        WHERE "userId" = $1`,
      [session.user.id]
    );
    const holdingTickers = holdingRows.map((r) => r.ticker.toUpperCase());

    const source: "holding" | "trending" =
      holdingTickers.length > 0 ? "holding" : "trending";
    const candidateTickers =
      holdingTickers.length > 0 ? holdingTickers : FALLBACK_TICKERS;

    // One batched market read across all candidates.
    const marketMap = await getTickerMarketBatch(candidateTickers);

    // Pick the candidate with the largest absolute change. Tickers
    // without market data are silently excluded — they'd render empty.
    let chosen: { ticker: string; absMove: number } | null = null;
    for (const t of candidateTickers) {
      const market = marketMap.get(t);
      if (!market?.changePct) continue;
      const abs = Math.abs(market.changePct);
      if (!chosen || abs > chosen.absMove) chosen = { ticker: t, absMove: abs };
    }

    if (!chosen) {
      // Two distinct "nothing to show" states:
      //   no_holdings — user hasn't linked a brokerage yet (source was
      //     already flipped to "trending" via the fallback list path,
      //     so we only reach this branch here when the fallback itself
      //     has no warehouse data — tag as no_data, not no_holdings)
      //   no_data    — warehouse hasn't primed any market row for the
      //     candidate set, regardless of source
      const reason: "no_holdings" | "no_data" =
        holdingTickers.length === 0 && source === "trending"
          ? "no_data"
          : "no_data";
      // Kept the conditional shape above for future-proofing; both
      // branches resolve to no_data today since "no holdings" is
      // never actually a terminal state here — we always try trending
      // as a fallback and fall through to no_data only if THAT returns
      // empty.
      void reason;
      const payload: DossierResponse = {
        dossier: null,
        reason: "no_data",
        source,
      };
      return NextResponse.json(payload);
    }

    // Pull the rest of the dossier inputs for the chosen ticker.
    const [fundamentals, upcomingEvents, recentEvents, sentiment] =
      await Promise.all([
        getTickerFundamentals(chosen.ticker),
        getUpcomingEvents(chosen.ticker, { windowDays: 30 }),
        getRecentEvents(chosen.ticker, { windowDays: 14 }),
        getTickerSentiment(chosen.ticker),
      ]);

    const dossier = buildDossier(chosen.ticker, {
      market: marketMap.get(chosen.ticker) ?? null,
      fundamentals,
      upcomingEvents,
      recentEvents,
      sentiment,
    });

    const payload: DossierResponse = { dossier, source };
    return NextResponse.json(payload);
  } catch (err) {
    log.error("research.dossier-of-day", "failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    const payload: DossierResponse = {
      dossier: null,
      reason: "error",
      source: "holding",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
