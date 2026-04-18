import { log, errorInfo } from "../log";

/**
 * Editorial feed aggregator — public RSS/Atom sources that complement
 * the ticker-level news providers (Finnhub, Polygon, Seeking Alpha).
 *
 * Design:
 *   - Each provider is a flat config (id, name, url, format, ua).
 *   - One shared fetcher + parser handles RSS 2.0 and Atom 1.0.
 *   - No API keys; public feeds only. Each call soft-fails to [] so
 *     one broken feed doesn't blank the aggregate.
 *
 * Why this exists (alongside the per-ticker news feeds we already have):
 *   Per-ticker providers skew toward press releases and newswire.
 *   These editorial feeds add:
 *     - Major-outlet narrative context (WSJ, CNBC, MarketWatch,
 *       Barron's, IBD)
 *     - Data aggregator commentary (Stock Analysis, Seeking Alpha)
 *     - Long-form investor thinking (Howard Marks, Aswath Damodaran)
 *     - Regulatory flow (SEC EDGAR filings, cross-company)
 *
 *   The cron pulls these nightly, ticker-mentions are extracted,
 *   results persist to market_news_daily. The UI reads the table —
 *   no per-request fan-out, no per-user rate pressure.
 *
 * Voice rule: user-facing surfaces cite providers with their
 * publisher name only (e.g. "WSJ", "CNBC") — never "via RSS".
 */

export type EditorialProvider = {
  /** Stable slug used as the `provider` key in the DB and UI. */
  id: string;
  /** Publisher name as displayed to users. */
  name: string;
  /** Category the UI groups by. */
  category: "news" | "analysis" | "thinker" | "regulatory";
  /** Feed URL. */
  url: string;
  /** Feed format. Most common is RSS; Blogger/Atom uses atom. */
  format: "rss" | "atom";
  /** Some publishers require a browser UA or block the SEC default. */
  userAgent?: string;
};

/**
 * Curated roster. The UI groups by category for rendering.
 * Feeds that have been documented as gated or removed are noted in
 * comments and excluded.
 */
export const EDITORIAL_PROVIDERS: EditorialProvider[] = [
  // ── Major financial news ────────────────────────────────────────
  {
    id: "wsj_markets",
    name: "WSJ Markets",
    category: "news",
    url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain",
    format: "rss",
  },
  {
    id: "marketwatch_top",
    name: "MarketWatch",
    category: "news",
    url: "https://www.marketwatch.com/rss/topstories",
    format: "rss",
  },
  {
    id: "cnbc_top",
    name: "CNBC",
    category: "news",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
    format: "rss",
  },
  {
    id: "barrons",
    name: "Barron's",
    category: "news",
    url: "https://www.barrons.com/xml/rss/3_7455.xml",
    format: "rss",
  },
  {
    id: "ibd",
    name: "Investor's Business Daily",
    category: "news",
    url: "https://www.investors.com/feed/",
    format: "rss",
  },
  // Reuters RSS was partially deprecated in 2020–2022. Reuters coverage
  // arrives via Polygon's news feed (which syndicates Reuters).

  // ── Analysis / aggregator ───────────────────────────────────────
  {
    id: "stock_analysis",
    name: "Stock Analysis",
    category: "analysis",
    url: "https://stockanalysis.com/rss/news/",
    format: "rss",
  },
  {
    id: "seeking_alpha_market",
    name: "Seeking Alpha",
    category: "analysis",
    url: "https://seekingalpha.com/market_currents.xml",
    format: "rss",
    userAgent:
      "Mozilla/5.0 (compatible; ClearPathInvest/1.0; +https://clearpathinvest.app)",
  },

  // ── Long-form investor thinkers ─────────────────────────────────
  {
    id: "damodaran",
    name: "Aswath Damodaran",
    category: "thinker",
    url: "https://aswathdamodaran.blogspot.com/feeds/posts/default?alt=rss",
    format: "rss",
  },
  {
    id: "oaktree_memos",
    name: "Howard Marks (Oaktree)",
    category: "thinker",
    // Oaktree's feed has been intermittent. We try it; if it 404s we
    // degrade quietly. User-visible alternative: a direct link to
    // oaktreecapital.com/insights/memos surfaced in the UI.
    url: "https://www.oaktreecapital.com/insights/rss",
    format: "rss",
  },
  // Berkshire shareholder letters — annual, no RSS, handled as a
  // curated link in the UI.

  // ── Regulatory ──────────────────────────────────────────────────
  {
    id: "sec_current",
    name: "SEC EDGAR",
    category: "regulatory",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom&count=50",
    format: "atom",
    userAgent: "ClearPath Invest research@lippertohana.com",
  },
];

export type EditorialItem = {
  id: string;
  providerId: string;
  providerName: string;
  category: EditorialProvider["category"];
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string; // ISO
  /** Tickers mentioned in title+summary (uppercase). */
  tickersMentioned: string[];
};

/**
 * Fetch + parse a single provider. Returns [] on any failure.
 * `universe` is the list of tickers to scan for in title/summary.
 */
export async function fetchProviderItems(
  provider: EditorialProvider,
  universe: Set<string>,
  limit = 20
): Promise<EditorialItem[]> {
  try {
    const res = await fetch(provider.url, {
      next: { revalidate: 900 },
      headers: {
        "User-Agent":
          provider.userAgent ??
          "Mozilla/5.0 (compatible; ClearPathInvest/1.0; +https://clearpathinvest.app)",
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) {
      log.warn("editorial-feeds", "non-2xx", {
        provider: provider.id,
        status: res.status,
      });
      return [];
    }
    const xml = await res.text();
    const parsed =
      provider.format === "atom" ? parseAtomItems(xml) : parseRssItems(xml);
    return parsed.slice(0, limit).map((raw) => ({
      id: hashUrl(raw.url || raw.title),
      providerId: provider.id,
      providerName: provider.name,
      category: provider.category,
      title: raw.title,
      url: raw.url,
      summary: raw.summary,
      publishedAt: raw.publishedAt,
      tickersMentioned: extractTickers(
        `${raw.title} ${raw.summary ?? ""}`,
        universe
      ),
    }));
  } catch (err) {
    log.warn("editorial-feeds", "fetch failed", {
      provider: provider.id,
      ...errorInfo(err),
    });
    return [];
  }
}

/** Pull ALL configured providers in parallel. */
export async function fetchAllProviders(
  universe: Set<string>,
  perProviderLimit = 20
): Promise<EditorialItem[]> {
  const results = await Promise.all(
    EDITORIAL_PROVIDERS.map((p) =>
      fetchProviderItems(p, universe, perProviderLimit)
    )
  );
  return results.flat();
}

// ─── Parsing ────────────────────────────────────────────────────────────

type RawItem = {
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string;
};

function parseRssItems(xml: string): RawItem[] {
  const itemRe = /<item[\s\S]*?<\/item>/g;
  const matches = xml.match(itemRe) ?? [];
  const items: RawItem[] = [];
  for (const block of matches) {
    const title = cleanText(extract(block, "title"));
    const url = cleanText(extract(block, "link"));
    const summary =
      cleanText(extract(block, "description")) ||
      cleanText(extract(block, "content:encoded")) ||
      null;
    const pub = extract(block, "pubDate") || extract(block, "dc:date");
    items.push({
      title,
      url,
      summary,
      publishedAt: normalizeDate(pub),
    });
  }
  return items.filter((i) => i.title && i.url);
}

function parseAtomItems(xml: string): RawItem[] {
  const entryRe = /<entry[\s\S]*?<\/entry>/g;
  const matches = xml.match(entryRe) ?? [];
  const items: RawItem[] = [];
  for (const block of matches) {
    const title = cleanText(extract(block, "title"));
    const alt = block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/);
    const any = block.match(/<link[^>]*href="([^"]+)"/);
    const url = alt?.[1] ?? any?.[1] ?? "";
    const summary =
      cleanText(extract(block, "summary")) ||
      cleanText(extract(block, "content")) ||
      null;
    const pub = extract(block, "published") || extract(block, "updated");
    items.push({
      title,
      url,
      summary,
      publishedAt: normalizeDate(pub),
    });
  }
  return items.filter((i) => i.title && i.url);
}

function extract(block: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<${escaped}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${escaped}>`,
    "i"
  );
  return block.match(re)?.[1]?.trim() ?? "";
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
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function hashUrl(s: string): string {
  // Cheap deterministic ID — djb2 variant, hex. Good enough to key an
  // INSERT … ON CONFLICT; we don't need cryptographic strength.
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ─── Ticker mention extractor ──────────────────────────────────────────

/**
 * Scan text for tickers that appear in `universe`. Uses three patterns:
 *   1. $AAPL — cashtag convention (unambiguous)
 *   2. (AAPL) — parenthetical after a company name: "Apple (AAPL)"
 *   3. Standalone AAPL at a word boundary, ONLY when in universe —
 *      prevents false triggers on words like "ATOM" in prose.
 *
 * Returns uppercase tickers, deduped.
 */
export function extractTickers(
  text: string,
  universe: Set<string>
): string[] {
  if (!text || universe.size === 0) return [];
  const found = new Set<string>();

  for (const m of text.matchAll(/\$([A-Z][A-Z0-9.\-]{0,9})\b/g)) {
    const t = m[1].toUpperCase();
    if (universe.has(t)) found.add(t);
  }

  for (const m of text.matchAll(/\(([A-Z][A-Z0-9.\-]{0,9})\)/g)) {
    const t = m[1].toUpperCase();
    if (universe.has(t)) found.add(t);
  }

  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,5}\b/g)) {
    const t = m[0].toUpperCase();
    if (universe.has(t)) found.add(t);
  }

  return [...found];
}
