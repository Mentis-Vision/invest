import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * /stocks — hub for the programmatic /stocks/[ticker] pages.
 *
 * Dynamic: queries the warehouse for tickers with a fresh
 * (within 2 days) market row. Every listed ticker is guaranteed
 * to render a real dossier on /stocks/[ticker] — avoids the
 * "doorway page" SEO penalty that an advertised-but-empty URL
 * would incur.
 *
 * Read-only warehouse access per AGENTS.md #10.
 *
 * Capped at 500 displayed entries for UX; the sitemap lists all
 * of them for search-engine discovery. Expansion plan lives in
 * handoff/2026-04-24-marketing-visibility.md.
 */

// Same ISR rationale as src/app/sitemap.ts: this page reads
// `ticker_market_daily` at request time, so without an explicit
// revalidate it would freeze on the first build's coverage count
// (16 tickers) instead of reflecting the warehouse's real state.
// 1-hour cache is plenty given the warehouse refreshes daily.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Stock research directory",
  description:
    "Evidence-based three-lens research briefs on the most-watched US equities. Live data, cited claims, honest confidence calibration.",
  alternates: { canonical: "/stocks" },
  openGraph: {
    title: "Stock research directory — ClearPath Invest",
    description:
      "Three-lens briefs on every major US equity. Live SEC + Fed data, every claim sourced.",
    url: "/stocks",
    type: "website",
  },
};

const DISPLAY_CAP = 500;

/**
 * Tickers with a recent market row in the warehouse. Sitemap lists all
 * of them; this UI caps at DISPLAY_CAP so the grid doesn't balloon.
 * Falls back to an empty list on DB error — the page still renders with
 * a "loading coverage" hint rather than a hard 500.
 */
async function listCoveredTickers(): Promise<string[]> {
  try {
    const { rows } = await pool.query<{ ticker: string }>(
      `SELECT DISTINCT ticker
         FROM "ticker_market_daily"
        WHERE as_of >= CURRENT_DATE - INTERVAL '2 days'
          AND ticker IS NOT NULL
        ORDER BY ticker`
    );
    return rows
      .map((r) => r.ticker)
      .filter((t) => typeof t === "string" && t.length > 0);
  } catch (err) {
    log.warn("stocks.index", "listCoveredTickers failed", errorInfo(err));
    return [];
  }
}

export default async function StocksIndex() {
  const allTickers = await listCoveredTickers();
  const tickers = allTickers.slice(0, DISPLAY_CAP);
  const coveredCount = allTickers.length;

  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Stock research directory
          </div>
          <h1 className="font-heading text-[44px] leading-[1.05] tracking-tight md:text-[60px]">
            Three-lens briefs on the{" "}
            <em className="italic text-[var(--buy)]">tickers</em> that
            matter.
          </h1>
          <p className="mx-auto mt-6 max-w-[620px] text-[17px] leading-relaxed text-muted-foreground">
            Each ticker page is a zero-AI nightly brief built from live
            SEC, Federal Reserve, and market data. Every claim cites its
            source. Informational only, not investment advice.
          </p>
          {coveredCount > 0 ? (
            <p className="mt-6 font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
              {coveredCount.toLocaleString()} stocks covered
            </p>
          ) : null}
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-5xl px-6">
          {tickers.length === 0 ? (
            <p className="text-center text-[14px] text-muted-foreground">
              Coverage is refreshing. Check back shortly.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {tickers.map((t) => (
                <Link
                  key={t}
                  href={`/stocks/${t}`}
                  className="group flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 font-mono text-[13px] tracking-tight transition-colors hover:border-[var(--buy)]/40 hover:bg-[var(--buy)]/[0.04]"
                >
                  <span className="font-semibold uppercase tracking-[0.1em] text-foreground">
                    {t}
                  </span>
                  <span className="text-muted-foreground/50 transition-colors group-hover:text-[var(--buy)]">
                    &rarr;
                  </span>
                </Link>
              ))}
            </div>
          )}

          {coveredCount > DISPLAY_CAP ? (
            <p className="mt-8 text-center text-[12px] text-muted-foreground">
              Showing the first {DISPLAY_CAP.toLocaleString()} of{" "}
              {coveredCount.toLocaleString()} covered tickers.
            </p>
          ) : null}

          <p className="mt-10 text-center text-[12px] text-muted-foreground">
            Don&rsquo;t see a ticker?{" "}
            <Link
              href="/#access"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Request beta access
            </Link>{" "}
            and run a live three-lens analysis on any US equity.
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
