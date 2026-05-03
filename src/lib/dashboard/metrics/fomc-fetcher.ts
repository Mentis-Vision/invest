// src/lib/dashboard/metrics/fomc-fetcher.ts
//
// Live FOMC meeting calendar fetched from federalreserve.gov.
//
// Source:
//   https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
//
// HTML structure (one repeating block per meeting):
//
//   <h4>... 2026 FOMC Meetings</h4>
//   <div class="row fomc-meeting"...>
//     <div class="fomc-meeting__month..."><strong>January</strong></div>
//     <div class="fomc-meeting__date...">27-28</div>
//     ...other detail divs...
//   </div>
//   ...next meeting...
//
// Year header anchors the section. Each meeting's __date div contains
// either a single day (rare; one-day meetings) or "DD-DD" / "DD-DD*"
// where the second day is the rate-decision announcement. We use the
// second day as the canonical "FOMC date" since that's when the
// statement releases.
//
// Caching:
//   * Module-level cache, 7-day TTL (calendar changes only when the
//     Fed publishes the next year's schedule).
//   * Next.js fetch revalidate hint at 7d for cross-instance dedupe.
//   * On fetch failure: stale cache; if no cache, [].

import { log, errorInfo } from "../../log";

const FED_URL =
  "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";

interface CacheEntry {
  fetchedAt: number;
  dates: string[];
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
let cache: CacheEntry | null = null;

/** Test seam - clear the in-process cache. */
export function __resetFomcFetcherCacheForTest(): void {
  cache = null;
}

/** Test seam - pre-populate the in-process cache. */
export function __seedFomcFetcherCacheForTest(
  dates: string[],
  fetchedAt: number = Date.now(),
): void {
  cache = { fetchedAt, dates };
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
 * Fetch the FOMC calendar from federalreserve.gov, returning the
 * meeting end-day dates (rate-decision day) sorted ascending. Never
 * throws - falls back to stale cache, then [], on hard failures.
 */
export async function fetchFOMCCalendar(): Promise<string[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.dates;
  }
  try {
    const res = await fetch(FED_URL, {
      headers: {
        "User-Agent":
          "ClearPathInvest/1.0 (contact: support@clearpathinvest.app)",
      },
      next: { revalidate: 60 * 60 * 24 * 7 },
    });
    if (!res.ok) throw new Error(`FOMC fetch ${res.status}`);
    const html = await res.text();
    const dates = parseFOMCDatesFromHtml(html);
    if (dates.length === 0) throw new Error("Parsed zero FOMC dates");
    cache = { fetchedAt: Date.now(), dates };
    log.info("dashboard.fomc", "fetched", {
      count: dates.length,
      first: dates[0],
      last: dates[dates.length - 1],
    });
    return dates;
  } catch (err) {
    log.warn("dashboard.fomc", "fetch failed", errorInfo(err));
    return cache?.dates ?? [];
  }
}

/**
 * Parse the FOMC calendar HTML into a sorted, deduplicated list of
 * ISO meeting end-day dates.
 *
 * Strategy: split the document at "<YEAR> FOMC Meetings" anchors so
 * each chunk only contains meetings for one year, then within each
 * chunk grep for the (month, date-range) pair that always appears in
 * adjacent fomc-meeting__month / fomc-meeting__date divs.
 */
export function parseFOMCDatesFromHtml(html: string): string[] {
  const dates: string[] = [];
  // Split into [preamble, year, block, year, block, ...].
  const parts = html.split(/(\d{4}) FOMC Meetings/);
  for (let i = 1; i < parts.length; i += 2) {
    const year = Number(parts[i]);
    const block = parts[i + 1] ?? "";
    if (!Number.isFinite(year)) continue;
    // Pair pattern: month div followed by date div within the same
    // meeting row. The two divs may be separated by whitespace and
    // attribute fragments but always co-occur in this order.
    const pairRegex =
      /fomc-meeting__month[^>]*>\s*<strong>(January|February|March|April|May|June|July|August|September|October|November|December)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>\s*([^<\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = pairRegex.exec(block)) !== null) {
      const month = MONTH_MAP[m[1]];
      const rawRange = m[2].replace(/\*/g, "").trim();
      // Parse range: "27-28" or "27" (single-day) or "29-1" (rare;
      // crosses a month boundary, in which case the announcement is
      // in the following month).
      const rangeMatch = rawRange.match(/^(\d{1,2})(?:[–—\-](\d{1,2}))?$/);
      if (!rangeMatch) continue;
      const day1 = Number(rangeMatch[1]);
      const day2 = rangeMatch[2] ? Number(rangeMatch[2]) : day1;
      if (!Number.isFinite(day2) || day2 < 1 || day2 > 31) continue;
      // If day2 < day1 (cross-month meeting like Jan 29 - Feb 1), the
      // announcement day is in the FOLLOWING month - bump the month.
      let isoYear = year;
      let isoMonth = month;
      if (day2 < day1) {
        isoMonth = month + 1;
        if (isoMonth > 12) {
          isoMonth = 1;
          isoYear = year + 1;
        }
      }
      const iso = `${isoYear}-${String(isoMonth).padStart(2, "0")}-${String(day2).padStart(2, "0")}`;
      dates.push(iso);
    }
  }
  // Dedup + sort ascending. The page sometimes lists the same meeting
  // in summary tables and detailed sections; we want each only once.
  const uniq = Array.from(new Set(dates));
  uniq.sort();
  return uniq;
}
