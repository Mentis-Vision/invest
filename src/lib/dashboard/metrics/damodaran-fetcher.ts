// src/lib/dashboard/metrics/damodaran-fetcher.ts
//
// Live Damodaran S&P 500 implied ERP scraper.
//
// Source:
//   https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histimpl.html
//
// The page is an Excel-as-HTML republish - Damodaran updates it
// roughly monthly with the latest year-end snapshot. The table
// structure is one row per calendar year, 9 columns:
//
//   1: Year                           e.g. "2025"
//   2: T.Bond rate                    "3.97%"
//   3: T.Bond bill spread             "1.15%"
//   4: S&P 500                        "6845.50"
//   5: Earnings                       "271.52"
//   6: Dividends                      "78.51"
//   7: Implied ERP (Required Return)  "4.18%"
//   8: Implied ERP (T.Bond)           "4.61%"
//   9: Implied ERP (FCFE)             "4.23%"   <- we use this
//
// FCFE-based implied ERP is the figure Damodaran emphasizes in his
// equity-risk-premium paper, so it's the apples-to-apples number to
// surface in our cost-of-capital tile.
//
// "As-of" date - the page header carries a "Date: <Month> <Year>"
// line giving the publication month. We extract that as ISO
// "YYYY-MM-01".
//
// Caching:
//   * Module-level Map cache, 7-day TTL (Damodaran publishes monthly).
//   * Next.js fetch revalidate hint (1d) for cross-instance dedupe.
//   * On fetch failure, returns the last-good cached entry; if none
//     exist, returns null. Never throws - the caller falls through
//     to the pinned constant in damodaran-loader.ts.

import { log, errorInfo } from "../../log";

const URL =
  "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histimpl.html";

export interface DamodaranLiveERP {
  /** Implied ERP (FCFE), fractional. e.g. 0.0423 = 4.23%. */
  erp: number;
  /** ISO date approximating publication month, e.g. "2026-01-01". */
  asOf: string;
  /** Most-recent calendar year in the table. */
  year: number;
}

interface CacheEntry {
  fetchedAt: number;
  data: DamodaranLiveERP;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
let cache: CacheEntry | null = null;

/** Test seam - clear the in-process cache. */
export function __resetDamodaranFetcherCacheForTest(): void {
  cache = null;
}

/** Test seam - pre-populate the in-process cache. */
export function __seedDamodaranFetcherCacheForTest(
  data: DamodaranLiveERP,
  fetchedAt: number = Date.now(),
): void {
  cache = { fetchedAt, data };
}

const MONTH_MAP: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

/**
 * Fetch the latest live Damodaran implied ERP. Returns null on a
 * cold instance + upstream failure with no cache; otherwise returns
 * the most-recent cached entry.
 */
export async function fetchLiveDamodaranERP(): Promise<DamodaranLiveERP | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  try {
    const res = await fetch(URL, {
      headers: {
        "User-Agent":
          "ClearPathInvest/1.0 (contact: support@clearpathinvest.app)",
      },
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) throw new Error(`Damodaran fetch ${res.status}`);
    const html = await res.text();
    const parsed = parseDamodaranHtml(html);
    if (!parsed) throw new Error("Could not parse Damodaran HTML");
    cache = { fetchedAt: Date.now(), data: parsed };
    log.info("dashboard.damodaran", "fetched", {
      erp: parsed.erp,
      asOf: parsed.asOf,
      year: parsed.year,
    });
    return parsed;
  } catch (err) {
    log.warn("dashboard.damodaran", "fetch failed", errorInfo(err));
    return cache?.data ?? null;
  }
}

/**
 * Parse the Damodaran histimpl HTML page into the latest implied
 * ERP plus the publication month. Returns null on a structural
 * mismatch (caller falls back to pinned constant).
 *
 * The parser is intentionally tolerant of Damodaran's Excel-as-HTML
 * markup quirks - TDs may wrap content in <pre> tags, contain
 * non-breaking spaces, etc.
 */
export function parseDamodaranHtml(html: string): DamodaranLiveERP | null {
  // Pull the publication month from the "Date: Month Year" header.
  const dateMatch = html.match(
    /<strong>Date<\/strong>:\s*([A-Z][a-z]+)\s+(\d{4})/,
  );
  let asOf = "";
  if (dateMatch && MONTH_MAP[dateMatch[1]]) {
    const month = MONTH_MAP[dateMatch[1]];
    asOf = `${dateMatch[2]}-${String(month).padStart(2, "0")}-01`;
  }

  // Walk every <tr> looking for a 9-cell row whose first cell is a
  // 4-digit year. Pull the last cell as the implied ERP (FCFE).
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const tdRegex = /<td[^>]*>(?:<pre>)?([^<]*?)(?:<\/pre>)?<\/td>/g;
  let mostRecent: { year: number; erp: number } | null = null;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const inner = trMatch[1];
    tdRegex.lastIndex = 0;
    const cells: string[] = [];
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRegex.exec(inner)) !== null) {
      cells.push(tdMatch[1].trim());
    }
    if (cells.length < 9) continue;
    if (!/^\d{4}$/.test(cells[0])) continue;
    const year = Number(cells[0]);
    const erpCell = cells[8].replace(/&nbsp;/g, "").replace("%", "").trim();
    if (!/^-?\d+(\.\d+)?$/.test(erpCell)) continue;
    const erp = Number(erpCell) / 100;
    if (!Number.isFinite(erp)) continue;
    if (!mostRecent || year > mostRecent.year) {
      mostRecent = { year, erp };
    }
  }

  if (!mostRecent) return null;

  // Fall back to the year-end of the most-recent year row when the
  // publication header was missing.
  if (!asOf) asOf = `${mostRecent.year}-12-31`;

  return {
    erp: mostRecent.erp,
    asOf,
    year: mostRecent.year,
  };
}
