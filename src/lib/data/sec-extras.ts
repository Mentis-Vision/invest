import { log, errorInfo } from "../log";
import { getRecentFilings } from "./sec";

/**
 * Fetch the text content of a specific SEC filing by accession number.
 *
 * Filing HTML is huge (10-Ks can be 200+ pages). We truncate aggressively
 * and strip boilerplate so the model sees the substantive content without
 * eating the context window.
 *
 * This is the flagship "deep dive" tool. Cached for 24h per accession.
 */

const UA = "ClearPath Invest research@lippertohana.com";

export type FilingText = {
  accession: string;
  ticker: string | null;
  form: string | null;
  filedOn: string | null;
  url: string;
  excerpt: string;
  truncated: boolean;
  lengthOriginal: number;
  source: "sec-edgar";
};

/**
 * Strip common HTML / XBRL boilerplate and collapse whitespace.
 * We don't need a full HTML parser — the filings are mostly plain text
 * once inline tags are removed.
 */
function sanitize(raw: string): string {
  // Remove HTML comments, script, style, XBRL
  let out = raw
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<xbrl[\s\S]*?<\/xbrl>/gi, " ")
    .replace(/<ix:[\s\S]*?>/gi, " ")
    .replace(/<\/ix:[^>]*>/gi, " ")
    // Strip all remaining tags
    .replace(/<[^>]+>/g, " ")
    // Collapse whitespace
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ");
  // Remove very short noise tokens
  out = out.trim();
  return out;
}

/**
 * Try to locate the "Item" sections that tend to contain substantive content
 * in 10-K/10-Q filings (Item 1 business, Item 1A risk factors, Item 7 MD&A).
 * Returns a concatenation prioritized by signal density.
 */
function extractHighSignalSections(text: string): string {
  const markers = [
    /\bItem\s+1[^0-9A]\s*\.?\s*Business\b/i,
    /\bItem\s+1A\s*\.?\s*Risk\s+Factors\b/i,
    /\bItem\s+7\s*\.?\s*Management'?s?\s+Discussion\b/i,
    /\bItem\s+2\s*\.?\s*Management'?s?\s+Discussion\b/i, // 10-Q variant
  ];
  const parts: string[] = [];
  for (const m of markers) {
    const idx = text.search(m);
    if (idx >= 0) {
      const slice = text.slice(idx, idx + 4000);
      parts.push(slice);
    }
  }
  return parts.join("\n\n---\n\n");
}

export async function getFilingText(
  accessionNumber: string,
  maxChars = 8000,
  ticker?: string
): Promise<FilingText> {
  const accNormalized = accessionNumber.trim();

  // Look up metadata from the ticker's recent filings if a ticker was provided
  let filingMeta:
    | { form: string; filedOn: string; url: string }
    | null = null;

  if (ticker) {
    try {
      const recent = await getRecentFilings(ticker, 20);
      const match = recent.find(
        (f) =>
          f.accession === accNormalized ||
          f.accession.replace(/-/g, "") === accNormalized.replace(/-/g, "")
      );
      if (match) {
        filingMeta = { form: match.form, filedOn: match.filedOn, url: match.url };
      }
    } catch {
      /* ignore */
    }
  }

  // If no URL yet, try the generic EDGAR filing-index URL pattern
  const url =
    filingMeta?.url ??
    `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=&State=0&SIC=&dateb=&owner=include&count=40&search_text=`;

  try {
    if (!filingMeta?.url) {
      return {
        accession: accNormalized,
        ticker: ticker ?? null,
        form: null,
        filedOn: null,
        url,
        excerpt:
          "Filing not found in this ticker's recent 20 filings. Supply a ticker along with a valid accession number from getRecentFilings.",
        truncated: false,
        lengthOriginal: 0,
        source: "sec-edgar",
      };
    }

    const res = await fetch(filingMeta.url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      return {
        accession: accNormalized,
        ticker: ticker ?? null,
        form: filingMeta.form,
        filedOn: filingMeta.filedOn,
        url: filingMeta.url,
        excerpt: `SEC EDGAR returned ${res.status} for this filing.`,
        truncated: false,
        lengthOriginal: 0,
        source: "sec-edgar",
      };
    }
    const raw = await res.text();
    const sanitized = sanitize(raw);
    const highSignal = extractHighSignalSections(sanitized);
    const source = highSignal.length > 1000 ? highSignal : sanitized;
    const truncated = source.length > maxChars;
    const excerpt = truncated ? source.slice(0, maxChars) + "…" : source;

    return {
      accession: accNormalized,
      ticker: ticker ?? null,
      form: filingMeta.form,
      filedOn: filingMeta.filedOn,
      url: filingMeta.url,
      excerpt,
      truncated,
      lengthOriginal: source.length,
      source: "sec-edgar",
    };
  } catch (err) {
    log.warn("sec-extras", "filing text fetch failed", {
      accession: accNormalized,
      ...errorInfo(err),
    });
    return {
      accession: accNormalized,
      ticker: ticker ?? null,
      form: filingMeta?.form ?? null,
      filedOn: filingMeta?.filedOn ?? null,
      url,
      excerpt: "Failed to fetch filing text.",
      truncated: false,
      lengthOriginal: 0,
      source: "sec-edgar",
    };
  }
}
