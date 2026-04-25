import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { log, errorInfo } from "@/lib/log";
import { getTickerMarketBatch } from "@/lib/warehouse/market";

/**
 * GET /api/research/sector-rail
 *
 * Returns today's move for the 11 sector ETF proxies so the Research
 * page can render a horizontal discovery rail — browse sectors without
 * needing to know a ticker. Each tile is itself a researchable ETF,
 * so clicking loads real analysis.
 *
 * The ETF proxy approach is deliberate: individual-stock sector
 * rollups would require joining holding × ticker_metadata, which
 * isn't the warehouse surface, and would add schema complexity for
 * a list that rarely changes. The 11 Select Sector SPDR ETFs are the
 * standard industry proxy used by every brokerage research desk.
 *
 * Zero AI cost. Reads warehouse market rows only.
 */
export const dynamic = "force-dynamic";

// Select Sector SPDR ETFs — the canonical 11-sector map.
// Keep in this order: market-cap weighted order roughly, with defensive
// sectors at the end. UI renders in this order left-to-right.
const SECTOR_ETFS: Array<{
  ticker: string;
  sector: string;
  shortLabel: string;
}> = [
  { ticker: "XLK", sector: "Technology", shortLabel: "Tech" },
  { ticker: "XLF", sector: "Financials", shortLabel: "Financials" },
  { ticker: "XLV", sector: "Health Care", shortLabel: "Healthcare" },
  { ticker: "XLY", sector: "Consumer Discretionary", shortLabel: "Consumer Disc" },
  { ticker: "XLC", sector: "Communication Services", shortLabel: "Comms" },
  { ticker: "XLI", sector: "Industrials", shortLabel: "Industrials" },
  { ticker: "XLE", sector: "Energy", shortLabel: "Energy" },
  { ticker: "XLP", sector: "Consumer Staples", shortLabel: "Staples" },
  { ticker: "XLU", sector: "Utilities", shortLabel: "Utilities" },
  { ticker: "XLRE", sector: "Real Estate", shortLabel: "Real Estate" },
  { ticker: "XLB", sector: "Materials", shortLabel: "Materials" },
];

type SectorTile = {
  ticker: string;
  sector: string;
  shortLabel: string;
  close: number | null;
  changePct: number | null;
  asOf: string | null;
};

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tickers = SECTOR_ETFS.map((s) => s.ticker);
    const marketMap = await getTickerMarketBatch(tickers);

    const tiles: SectorTile[] = SECTOR_ETFS.map((s) => {
      const market = marketMap.get(s.ticker);
      return {
        ticker: s.ticker,
        sector: s.sector,
        shortLabel: s.shortLabel,
        close: market?.close ?? null,
        changePct: market?.changePct ?? null,
        asOf: market?.capturedAt
          ? new Date(market.capturedAt).toISOString()
          : null,
      };
    });

    return NextResponse.json({ tiles });
  } catch (err) {
    log.error("research.sector-rail", "failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not load sectors." },
      { status: 500 }
    );
  }
}
