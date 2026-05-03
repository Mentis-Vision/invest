// src/lib/dashboard/metrics/fama-french-fetcher.ts
//
// Live Kenneth French Data Library factor-return loader.
//
// Source:
//   https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/
//   F-F_Research_Data_Factors_daily_CSV.zip            (3-factor daily)
//   F-F_Research_Data_5_Factors_2x3_daily_CSV.zip      (5-factor daily)
//
// CSV layout (after the multi-line preamble):
//   ,Mkt-RF,SMB,HML,RF                       (3-factor header — leading empty col)
//   19260701,    0.09,   -0.25,   -0.27,    0.01
//   ...
//   20260227,   -0.51,   -0.44,   -1.25,    0.01
//   <blank line>
//   <annual data block — different date format, we stop before this>
//
// Values are in PERCENT (e.g. 0.45 = 0.45%). The fetcher divides by
// 100 so downstream consumers get fractional returns matching the
// rest of the codebase (risk.ts / fama-french.ts).
//
// Caching:
//   * Module-level Map cache, 24h TTL (French publishes nightly).
//   * Next.js fetch revalidate hint (1d) so cross-instance dedupe
//     hits Vercel's data cache.
//   * On fetch failure, returns the last-good cached rows; if none
//     exist, returns []. Never throws — the caller falls through to
//     the synthetic baseline in fama-french-loader.ts.

import AdmZip from "adm-zip";
import { log, errorInfo } from "../../log";

const FF_3FACTOR_URL =
  "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip";
const FF_5FACTOR_URL =
  "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_daily_CSV.zip";

export interface FactorReturnRow {
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Daily market excess return, fractional (0.0045 = 0.45%). */
  mktRf: number;
  smb: number;
  hml: number;
  /** 5-factor only. */
  rmw?: number;
  /** 5-factor only. */
  cma?: number;
  rf: number;
}

interface CacheEntry {
  fetchedAt: number;
  rows: FactorReturnRow[];
  flavor: "3" | "5";
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
let cache: CacheEntry | null = null;

/**
 * Test seam — reset the module-level cache between specs so cached
 * rows from one test don't leak into another.
 */
export function __resetFrenchFetcherCacheForTest(): void {
  cache = null;
}

/**
 * Test seam — pre-populate the module-level cache with known rows.
 * Lets us assert TTL behavior without a live fetch.
 */
export function __seedFrenchFetcherCacheForTest(
  rows: FactorReturnRow[],
  flavor: "3" | "5",
  fetchedAt: number = Date.now(),
): void {
  cache = { fetchedAt, rows, flavor };
}

/**
 * Fetch the daily Fama-French factor returns. `flavor` selects 3 or
 * 5 factor; default is 5 because the regression in fama-french.ts
 * supports both and the extra columns improve R² without much cost.
 *
 * Resolves to [] on a hard failure with no cached fallback. Never
 * throws.
 */
export async function fetchFrenchFactorsDaily(
  flavor: "3" | "5" = "5",
): Promise<FactorReturnRow[]> {
  if (
    cache &&
    cache.flavor === flavor &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache.rows;
  }
  try {
    const url = flavor === "5" ? FF_5FACTOR_URL : FF_3FACTOR_URL;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "ClearPathInvest/1.0 (contact: support@clearpathinvest.app)",
      },
      // Cross-instance dedupe via Next's data cache — daily refresh
      // is plenty since French publishes nightly.
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) throw new Error(`French CSV fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buf);
    const csvEntry = zip
      .getEntries()
      .find((e) => e.entryName.toLowerCase().endsWith(".csv"));
    if (!csvEntry) throw new Error("No CSV in French zip");
    const text = csvEntry.getData().toString("utf8");
    const rows = parseFrenchCsv(text, flavor);
    if (rows.length === 0) {
      throw new Error("Parsed zero rows from French CSV");
    }
    cache = { fetchedAt: Date.now(), rows, flavor };
    log.info("dashboard.fama-french", "fetched", {
      flavor,
      rows: rows.length,
      latest: rows[rows.length - 1]?.date ?? null,
    });
    return rows;
  } catch (err) {
    log.warn("dashboard.fama-french", "fetch failed", {
      flavor,
      ...errorInfo(err),
    });
    // Stale cache is better than nothing — keep serving prior data
    // when the upstream wobbles.
    if (cache && cache.flavor === flavor) return cache.rows;
    return [];
  }
}

/**
 * Parse the published French CSV. The file has a multi-line preamble,
 * then a blank line, then the daily data block, then ANOTHER blank
 * line followed by the annual data block (which uses a YYYY-only
 * date format). We must stop at the second blank line to avoid
 * polluting the daily series with annual rows.
 *
 * Returns rows in chronological order. Values are converted from
 * percent to fraction (divide by 100).
 */
export function parseFrenchCsv(
  text: string,
  flavor: "3" | "5",
): FactorReturnRow[] {
  const lines = text.split(/\r?\n/);
  const result: FactorReturnRow[] = [];
  let inDataSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inDataSection) break; // hit the gap before annual data
      continue;
    }
    // Header detection: first row containing "Mkt-RF" is the header.
    // The header line has a leading empty cell, e.g. ",Mkt-RF,SMB,HML,RF".
    if (trimmed.includes("Mkt-RF") && !inDataSection) {
      inDataSection = true;
      continue;
    }
    if (!inDataSection) continue;

    const cells = trimmed.split(",").map((c) => c.trim());
    // 3-factor data rows: date,mktRf,smb,hml,rf  → 5 cells
    // 5-factor data rows: date,mktRf,smb,hml,rmw,cma,rf → 7 cells
    const expectedCells = flavor === "5" ? 7 : 5;
    if (cells.length < expectedCells) continue;

    const dateRaw = cells[0];
    // Daily rows are YYYYMMDD. Skip annual (YYYY) and monthly (YYYYMM)
    // rows that may sneak through if the parser misreads a section break.
    if (!/^\d{8}$/.test(dateRaw)) continue;

    const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
    const mktRf = Number(cells[1]) / 100;
    const smb = Number(cells[2]) / 100;
    const hml = Number(cells[3]) / 100;
    let rmw: number | undefined;
    let cma: number | undefined;
    let rf: number;
    if (flavor === "5") {
      rmw = Number(cells[4]) / 100;
      cma = Number(cells[5]) / 100;
      rf = Number(cells[6]) / 100;
    } else {
      rf = Number(cells[4]) / 100;
    }

    if (
      !Number.isFinite(mktRf) ||
      !Number.isFinite(smb) ||
      !Number.isFinite(hml) ||
      !Number.isFinite(rf)
    ) {
      continue;
    }
    if (flavor === "5" && (!Number.isFinite(rmw) || !Number.isFinite(cma))) {
      continue;
    }

    const row: FactorReturnRow = { date, mktRf, smb, hml, rf };
    if (flavor === "5") {
      row.rmw = rmw;
      row.cma = cma;
    }
    result.push(row);
  }

  return result;
}
