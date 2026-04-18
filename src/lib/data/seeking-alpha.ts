import { log, errorInfo } from "../log";

/**
 * Seeking Alpha RSS — supplemental third-party analyst opinions.
 *
 * Why we use it:
 *   Yahoo / Finnhub / Polygon news feeds skew toward newswire and
 *   first-party press releases. Seeking Alpha's article feed adds
 *   independent commentary — bull/bear takes, deep-dives, opinion
 *   pieces — that a thoughtful retail investor reads alongside
 *   the headline news.
 *
 *   Important: this is OPINION, not breaking news. We surface it as
 *   "third-party commentary" so users can weigh it accordingly.
 *
 * Endpoints used:
 *   - Per-ticker:  https://seekingalpha.com/api/sa/combined/{TICKER}.xml
 *   - General:     https://seekingalpha.com/feed.xml
 *
 * Rate / availability:
 *   - SA's RSS is best-effort. They sometimes 403 / 429 / change shape;
 *     we degrade silently to an empty list. Never throw.
 *   - 30-min Vercel fetch cache so we don't hammer them per page-view.
 *
 * No API key required.
 */

export type SARSSItem = {
  title: string;
  url: string;
  publishedAt: string;
  author: string | null;
  summary: string | null;
};

const PER_TICKER = (t: string) =>
  `https://seekingalpha.com/api/sa/combined/${t.toUpperCase()}.xml`;
const MARKET_NEWS = "https://seekingalpha.com/market_currents.xml";

export function seekingAlphaConfigured(): boolean {
  return true; // no key needed
}

/**
 * Fetch + parse RSS for one ticker. Returns up to `limit` items.
 *
 * Parsing approach: regex extraction of <item>…</item> blocks. Pulling
 * in a full XML parser (fast-xml-parser, xml2js) is overkill for what
 * is effectively a flat list of items with predictable fields.
 */
export async function getSeekingAlphaForTicker(
  ticker: string,
  limit = 5
): Promise<SARSSItem[]> {
  return fetchAndParseRss(PER_TICKER(ticker), limit, `sa-ticker:${ticker}`);
}

/**
 * General market commentary feed. Useful for the research page's
 * "today's market read" surface — not tied to one ticker.
 */
export async function getSeekingAlphaMarketFeed(
  limit = 8
): Promise<SARSSItem[]> {
  return fetchAndParseRss(MARKET_NEWS, limit, "sa-market");
}

async function fetchAndParseRss(
  url: string,
  limit: number,
  context: string
): Promise<SARSSItem[]> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 }, // 30 min
      headers: {
        // SA blocks scrapers without a UA. A plain browser UA is enough.
        "User-Agent":
          "Mozilla/5.0 (compatible; ClearPathInvest/1.0; +https://clearpathinvest.app)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) {
      // 403 / 429 are expected occasionally; quiet.
      log.warn("seeking-alpha", "non-2xx", {
        context,
        status: res.status,
      });
      return [];
    }
    const xml = await res.text();
    return parseRssItems(xml).slice(0, limit);
  } catch (err) {
    log.warn("seeking-alpha", "fetch failed", {
      context,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Minimal RSS 2.0 item parser. Extracts title / link / pubDate /
 * dc:creator (author) / description for each <item>. Tolerates CDATA
 * wrappers, missing fields, and unescaped entities.
 */
function parseRssItems(xml: string): SARSSItem[] {
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  const items: SARSSItem[] = [];
  const matches = xml.match(itemRegex) ?? [];
  for (const block of matches) {
    items.push({
      title: cleanText(extract(block, "title")),
      url: extract(block, "link"),
      publishedAt: normalizeDate(extract(block, "pubDate")),
      author: cleanText(extract(block, "dc:creator")) || null,
      summary: cleanText(extract(block, "description")) || null,
    });
  }
  return items.filter((i) => i.title && i.url);
}

function extract(block: string, tag: string): string {
  // Match <tag>VALUE</tag> or <tag><![CDATA[VALUE]]></tag>
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<${escapedTag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${escapedTag}>`,
    "i"
  );
  const m = block.match(re);
  return m?.[1]?.trim() ?? "";
}

function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function normalizeDate(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}
