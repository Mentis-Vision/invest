import { NextResponse } from "next/server";
import { listRecentBriefs } from "@/lib/public-brief";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /research/feed.xml — RSS 2.0 feed of weekly public briefs.
 *
 * Rendered dynamically but cached for an hour (Cache-Control below).
 * Newsletter-adjacent distribution: aggregators (Feedly, NewsBlur) and
 * fintech newsletter tools that pull RSS will pick this up. Also a
 * solid fallback for anyone who wants updates without signing up.
 */

const BASE_URL =
  process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ??
  "https://clearpathinvest.app";

// Simple XML-safe escape — RSS readers are strict. Only handles the
// five characters that actually break XML; anything else passes through.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const started = Date.now();
  let briefs: Awaited<ReturnType<typeof listRecentBriefs>> = [];
  try {
    briefs = await listRecentBriefs(40);
  } catch (err) {
    // DB read failure shouldn't 500 the feed — aggregators retry on
    // non-200 and a stale-but-empty feed is less disruptive than a
    // stream of errors. Log so the failure still surfaces in Vercel
    // runtime logs for investigation.
    log.error("research.feed.xml", "listRecentBriefs failed", errorInfo(err));
  }

  const items = briefs
    .map((b) => {
      const url = `${BASE_URL}/research/${b.slug}`;
      const title = `${b.ticker} weekly brief — ${b.recommendation} (${b.confidence})`;
      const pubDate = new Date(b.createdAt).toUTCString();
      const description =
        b.summary ??
        `Three-lens brief on ${b.ticker} for the week of ${b.weekOf}. ${b.recommendation} with ${b.confidence} confidence. Informational only.`;
      return `    <item>
      <title>${esc(title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${esc(description)}</description>
      <category>${esc(b.ticker)}</category>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ClearPath Invest — Weekly Research Briefs</title>
    <link>${BASE_URL}/research</link>
    <atom:link href="${BASE_URL}/research/feed.xml" rel="self" type="application/rss+xml" />
    <description>One ticker, bull case and bear case, every Monday. Three-lens evidence-based analysis with cited claims. Informational only — not investment advice.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      // Cache at the edge for an hour — briefs update weekly so even a
      // 1h cache never serves dangerously stale data.
      "Cache-Control":
        "public, s-maxage=3600, stale-while-revalidate=7200",
    },
  });
}
