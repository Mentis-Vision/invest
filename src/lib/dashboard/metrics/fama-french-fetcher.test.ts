// src/lib/dashboard/metrics/fama-french-fetcher.test.ts
//
// Tests for the live Kenneth French CSV fetcher. We assert the parser
// extracts rows correctly from a synthetic CSV, the cache TTL avoids
// re-fetching within window, and the failure path is silent (no
// throw) and falls back to stale cache.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import AdmZip from "adm-zip";
import {
  parseFrenchCsv,
  fetchFrenchFactorsDaily,
  __resetFrenchFetcherCacheForTest,
  __seedFrenchFetcherCacheForTest,
  type FactorReturnRow,
} from "./fama-french-fetcher";

// Build a tiny zip-as-Buffer in memory. Lets us mock the network
// response with a real, AdmZip-parseable payload.
function buildZip(filename: string, csv: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(filename, Buffer.from(csv, "utf8"));
  return zip.toBuffer();
}

const SAMPLE_3FACTOR_CSV = [
  "This file was created by using the 202602 CRSP database.",
  "Description line 2.",
  "",
  ",Mkt-RF,SMB,HML,RF",
  "20240102,    0.50,   -0.10,    0.20,    0.02",
  "20240103,   -0.25,    0.05,   -0.15,    0.02",
  "20240104,    0.10,    0.00,    0.05,    0.02",
  "",
  "  Annual Factors: January-December",
  "1926,    9.00,   -0.20,   -2.00,    3.20",
  "",
].join("\n");

const SAMPLE_5FACTOR_CSV = [
  "Header preamble",
  "",
  ",Mkt-RF,SMB,HML,RMW,CMA,RF",
  "20240102,    0.50,   -0.10,    0.20,    0.30,   -0.05,    0.02",
  "20240103,   -0.25,    0.05,   -0.15,    0.10,    0.20,    0.02",
  "",
  "  Annual Factors: January-December",
  "1963,    9.50,    1.20,    3.00,    2.00,    1.50,    3.20",
].join("\n");

describe("parseFrenchCsv", () => {
  it("parses 3-factor daily rows and converts percent to fraction", () => {
    const rows = parseFrenchCsv(SAMPLE_3FACTOR_CSV, "3");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      date: "2024-01-02",
      mktRf: 0.005,
      smb: -0.001,
      hml: 0.002,
      rf: 0.0002,
    });
    expect(rows[2].date).toBe("2024-01-04");
  });

  it("parses 5-factor rows including RMW and CMA", () => {
    const rows = parseFrenchCsv(SAMPLE_5FACTOR_CSV, "5");
    expect(rows).toHaveLength(2);
    expect(rows[0].rmw).toBeCloseTo(0.003, 6);
    expect(rows[0].cma).toBeCloseTo(-0.0005, 6);
    expect(rows[0].rf).toBeCloseTo(0.0002, 6);
  });

  it("stops at the blank line before annual rows", () => {
    // The annual row "1926, 9.00, -0.20, -2.00, 3.20" must NOT appear in output.
    const rows = parseFrenchCsv(SAMPLE_3FACTOR_CSV, "3");
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
    expect(rows.some((r) => r.date.startsWith("1926"))).toBe(false);
  });

  it("returns an empty array when there is no Mkt-RF header", () => {
    const rows = parseFrenchCsv("just,some,csv\n1,2,3\n", "3");
    expect(rows).toEqual([]);
  });

  it("skips data rows whose first cell is not YYYYMMDD", () => {
    const csv = [
      "preamble",
      "",
      ",Mkt-RF,SMB,HML,RF",
      "202401,    0.50,   -0.10,    0.20,    0.02",
      "20240102,    0.50,   -0.10,    0.20,    0.02",
    ].join("\n");
    const rows = parseFrenchCsv(csv, "3");
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2024-01-02");
  });
});

describe("fetchFrenchFactorsDaily", () => {
  beforeEach(() => {
    __resetFrenchFetcherCacheForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __resetFrenchFetcherCacheForTest();
  });

  it("fetches and parses the live zip on first call", async () => {
    const zipBuf = buildZip("F-F_Research_Data_Factors_daily.csv", SAMPLE_3FACTOR_CSV);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength)),
    } as unknown as Response);

    const rows = await fetchFrenchFactorsDaily("3");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(3);
    expect(rows[0].mktRf).toBeCloseTo(0.005, 6);
  });

  it("does not refetch within the cache TTL window", async () => {
    const seeded: FactorReturnRow[] = [
      { date: "2024-01-02", mktRf: 0.001, smb: 0, hml: 0, rf: 0.00008 },
    ];
    __seedFrenchFetcherCacheForTest(seeded, "5", Date.now());
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const rows = await fetchFrenchFactorsDaily("5");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rows).toBe(seeded);
  });

  it("re-fetches when cache flavor differs", async () => {
    const seeded: FactorReturnRow[] = [
      { date: "2024-01-02", mktRf: 0.001, smb: 0, hml: 0, rf: 0.00008 },
    ];
    __seedFrenchFetcherCacheForTest(seeded, "3", Date.now());
    const zipBuf = buildZip(
      "F-F_Research_Data_5_Factors_2x3_daily.csv",
      SAMPLE_5FACTOR_CSV,
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength)),
    } as unknown as Response);
    const rows = await fetchFrenchFactorsDaily("5");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(rows[0].rmw).toBeDefined();
  });

  it("returns stale cache rows when fetch fails", async () => {
    const seeded: FactorReturnRow[] = [
      { date: "2024-01-02", mktRf: 0.001, smb: 0, hml: 0, rf: 0.00008 },
    ];
    // Pre-seed cache with a stale timestamp that's outside the TTL.
    __seedFrenchFetcherCacheForTest(
      seeded,
      "5",
      Date.now() - 25 * 60 * 60 * 1000, // > 24h ago
    );
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    const rows = await fetchFrenchFactorsDaily("5");
    expect(rows).toBe(seeded);
  });

  it("returns [] when fetch fails and no cache exists", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    const rows = await fetchFrenchFactorsDaily("5");
    expect(rows).toEqual([]);
  });

  it("returns [] when the zip is missing a CSV entry", async () => {
    const zip = new AdmZip();
    zip.addFile("README.txt", Buffer.from("hello"));
    const buf = zip.toBuffer();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    } as unknown as Response);
    const rows = await fetchFrenchFactorsDaily("5");
    expect(rows).toEqual([]);
  });

  it("returns [] on non-2xx HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 503,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as unknown as Response);
    const rows = await fetchFrenchFactorsDaily("5");
    expect(rows).toEqual([]);
  });
});
