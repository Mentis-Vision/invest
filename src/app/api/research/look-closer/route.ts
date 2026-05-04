import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getLookCloserCards } from "@/lib/research/look-closer-loader";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/research/look-closer
 *
 * Returns up to 8 "look closer at your holdings" cards composed from
 * existing data sources (holdings + ticker_events + recommendation +
 * ticker_market_daily). BetterAuth-gated. No AI calls — this is a
 * cheap composition over the warehouse + recommendation tables, so
 * we don't rate-limit or cost-cap.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const cards = await getLookCloserCards(session.user.id);
    return NextResponse.json({ ok: true, cards });
  } catch (err) {
    log.error(
      "research.look-closer",
      "GET failed",
      errorInfo(err),
    );
    return NextResponse.json(
      { ok: false, cards: [], error: "Could not load look-closer cards." },
      { status: 500 },
    );
  }
}
