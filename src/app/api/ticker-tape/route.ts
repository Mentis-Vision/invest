import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { getStockSnapshot } from "@/lib/data/yahoo";
import { checkRateLimit, RULES } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/ticker-tape
 *
 * Returns the data for the scrolling marquee at the top of the app:
 *   - A fixed set of market indexes (S&P, Nasdaq, Dow, Russell, 10Y, VIX)
 *   - The requesting user's top ~6 holdings by market value
 *
 * Cached 5 minutes per ticker via Yahoo fetch cache; overall call
 * returns in ~200ms for a typical universe.
 *
 * Response shape:
 *   {
 *     items: [{ symbol, label, price, changePct, up, kind: 'index' | 'holding' }]
 *   }
 */
type TapeItem = {
  symbol: string;
  label: string;
  price: number;
  changePct: number;
  up: boolean;
  kind: "index" | "holding";
};

const INDEXES: Array<{ symbol: string; label: string }> = [
  { symbol: "SPY", label: "S&P 500" },
  { symbol: "QQQ", label: "NASDAQ" },
  { symbol: "DIA", label: "DOW" },
  { symbol: "IWM", label: "RUT" },
  { symbol: "^TNX", label: "10Y" },
  { symbol: "^VIX", label: "VIX" },
];

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Very generous cap — the marquee is polled ~once a minute per
  // active tab. Don't let one frantic user blow the Yahoo budget.
  const rl = await checkRateLimit(
    { ...RULES.researchUser, name: "ticker-tape:user", limit: 120 },
    session.user.id
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    // User's top holdings by value. Cap at 6 so the tape doesn't get
    // too long. Skip tickers with empty values.
    const { rows } = await pool.query(
      `SELECT ticker, COALESCE("lastValue", 0) AS value
         FROM "holding"
        WHERE "userId" = $1
          AND ticker IS NOT NULL
        ORDER BY COALESCE("lastValue", 0) DESC
        LIMIT 6`,
      [session.user.id]
    );
    const holdingSymbols = (rows as Array<{ ticker: string }>).map(
      (r) => r.ticker
    );

    const all = [
      ...INDEXES,
      ...holdingSymbols.map((s) => ({ symbol: s, label: s })),
    ];

    // Parallel fetch snapshots. Each call is independently cached, and
    // any failure becomes a skip — we'd rather show fewer items than
    // stall the tape waiting on one slow quote.
    const results = await Promise.all(
      all.map(async (entry, idx) => {
        try {
          const snap = await getStockSnapshot(entry.symbol);
          if (!snap || snap.price <= 0) return null;
          return {
            symbol: entry.symbol,
            label: entry.label,
            price: snap.price,
            changePct: snap.changePct ?? 0,
            up: (snap.changePct ?? 0) >= 0,
            kind: idx < INDEXES.length ? ("index" as const) : ("holding" as const),
          } as TapeItem;
        } catch {
          return null;
        }
      })
    );

    const items = results.filter((r): r is TapeItem => r !== null);
    return NextResponse.json({ items });
  } catch (err) {
    log.error("ticker-tape", "failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json({ items: [] }, { status: 200 });
  }
}
