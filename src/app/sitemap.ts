import type { MetadataRoute } from "next";
import { listRecentBriefs } from "@/lib/public-brief";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

// Sitemap reads from the DB at request time. Without an explicit
// revalidate hint Next.js would build it once at deploy and serve a
// stale snapshot forever — which is exactly how we ended up with a
// 16-URL sitemap after the warehouse expanded to 600+ tickers.
//
// Revalidate every hour: Googlebot polls sitemap.xml infrequently
// enough that hourly is generous, and the cache hit shields the DB
// from the few crawlers that hit it harder than that.
export const revalidate = 3600;

const BASE_URL =
  process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ??
  "https://clearpathinvest.app";

/**
 * Pull the list of tickers that have a FRESH (within 2 days) market row
 * in the warehouse. Only these render meaningful dossiers — advertising
 * a ticker URL that has no data would be a soft-404 SEO penalty
 * ("doorway page").
 *
 * Read-only — warehouse writes happen only in the cron (AGENTS.md #10).
 * Failure-tolerant: on DB error the sitemap still returns static routes,
 * we just skip ticker URLs this generation. Google will retry.
 */
async function listFreshTickers(): Promise<string[]> {
  try {
    const { rows } = await pool.query<{ ticker: string }>(
      `SELECT DISTINCT ticker
         FROM "ticker_market_daily"
        WHERE as_of >= CURRENT_DATE - INTERVAL '2 days'
          AND ticker IS NOT NULL
        ORDER BY ticker`
    );
    return rows.map((r) => r.ticker).filter((t) => typeof t === "string" && t.length > 0);
  } catch (err) {
    log.warn("sitemap", "listFreshTickers failed", errorInfo(err));
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const today = new Date();
  const routes = [
    { path: "", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/manifesto", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/alternatives", priority: 0.85, changeFrequency: "monthly" as const },
    { path: "/track-record", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/stocks", priority: 0.75, changeFrequency: "weekly" as const },
    { path: "/research", priority: 0.85, changeFrequency: "weekly" as const },
    { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/disclosures", priority: 0.3, changeFrequency: "yearly" as const },
  ];

  // Programmatic ticker pages — one URL per ticker that has a recent
  // market row in the warehouse. Lower priority than hub pages since
  // there are many of them and Google would penalize over-claiming
  // priority on long-tail URLs.
  const freshTickers = await listFreshTickers();
  const tickerRoutes = freshTickers.map((t) => ({
    path: `/stocks/${t}`,
    priority: 0.6,
    changeFrequency: "weekly" as const,
  }));

  // Weekly briefs — dynamic, pulled from the public_weekly_brief table.
  // Each brief is an individual URL and accrues evergreen search value
  // (the 30d / 90d / 365d outcome evaluations keep the page relevant
  // long after publication). Capped at 200 most recent to keep the
  // sitemap under reasonable size; expand cap later if we ever have
  // that many briefs.
  let briefRoutes: Array<{
    path: string;
    priority: number;
    changeFrequency: "weekly";
  }> = [];
  try {
    const briefs = await listRecentBriefs(200);
    briefRoutes = briefs.map((b) => ({
      path: `/research/${b.slug}`,
      priority: 0.65,
      changeFrequency: "weekly" as const,
    }));
  } catch (err) {
    // Don't fail the entire sitemap if the DB is momentarily slow —
    // the static routes + ticker pages are still valuable and Google
    // will retry this sitemap on its own cadence.
    log.warn("sitemap", "listRecentBriefs failed", errorInfo(err));
  }

  return [...routes, ...tickerRoutes, ...briefRoutes].map((r) => ({
    url: `${BASE_URL}${r.path}`,
    lastModified: today,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
