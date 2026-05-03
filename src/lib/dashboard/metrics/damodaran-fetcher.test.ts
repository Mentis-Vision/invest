// src/lib/dashboard/metrics/damodaran-fetcher.test.ts
//
// Tests for the live Damodaran implied-ERP scraper. We exercise the
// HTML parser against a synthetic snippet that mirrors the Excel-
// as-HTML markup pattern used by Stern's republished page, then
// verify cache TTL + graceful failure semantics for the fetcher.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseDamodaranHtml,
  fetchLiveDamodaranERP,
  __resetDamodaranFetcherCacheForTest,
  __seedDamodaranFetcherCacheForTest,
} from "./damodaran-fetcher";

const SAMPLE_HTML = `
<html><body>
  <h1>Implied Equity Risk Premiums</h1>
  <p><b>Data Used</b>: Multiple data services</p>
  <p><strong>Date</strong>: January 2026</p>
  <table>
    <tr>
      <td>Year</td><td>T.Bond Rate</td><td>Spread</td><td>S&amp;P 500</td>
      <td>Earnings</td><td>Dividends</td><td>Implied ERP (Required)</td>
      <td>Implied ERP (T.Bond)</td><td>Implied ERP (FCFE)</td>
    </tr>
    <tr>
      <td><pre>2023</pre></td><td>4.64%</td><td>1.47%</td><td>4769.83</td>
      <td>221.36</td><td>70.07</td><td>3.88%</td><td>3.68%</td><td>4.60%</td>
    </tr>
    <tr>
      <td>2024</td><td>4.14%</td><td>1.25%</td><td>5881.63</td>
      <td>243.32</td><td>73.40</td><td>4.58%</td><td>4.61%</td><td>4.33%</td>
    </tr>
    <tr>
      <td>2025</td><td>3.97%</td><td>1.15%</td><td>6845.50</td>
      <td>271.52</td><td>78.51</td><td>4.18%</td><td>4.61%</td><td>4.23%</td>
    </tr>
  </table>
</body></html>
`;

describe("parseDamodaranHtml", () => {
  it("extracts the most recent implied ERP (FCFE)", () => {
    const parsed = parseDamodaranHtml(SAMPLE_HTML);
    expect(parsed).not.toBeNull();
    expect(parsed!.year).toBe(2025);
    expect(parsed!.erp).toBeCloseTo(0.0423, 4);
  });

  it("extracts the publication date from the header", () => {
    const parsed = parseDamodaranHtml(SAMPLE_HTML);
    expect(parsed!.asOf).toBe("2026-01-01");
  });

  it("falls back to year-end date when publication header is missing", () => {
    const html = SAMPLE_HTML.replace(
      /<p><strong>Date<\/strong>:[^<]*<\/p>/,
      "",
    );
    const parsed = parseDamodaranHtml(html);
    expect(parsed!.asOf).toBe("2025-12-31");
  });

  it("returns null when no year row is parseable", () => {
    const parsed = parseDamodaranHtml("<html><body><p>nothing</p></body></html>");
    expect(parsed).toBeNull();
  });

  it("ignores rows whose first cell is not a 4-digit year", () => {
    const html = `
      <p><strong>Date</strong>: January 2026</p>
      <table>
        <tr><td>2024</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>4.33%</td></tr>
        <tr><td>not-a-year</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>5.00%</td></tr>
      </table>
    `;
    const parsed = parseDamodaranHtml(html);
    expect(parsed!.year).toBe(2024);
    expect(parsed!.erp).toBeCloseTo(0.0433, 4);
  });

  it("handles &nbsp; and missing % in the ERP cell gracefully", () => {
    const html = `
      <p><strong>Date</strong>: January 2026</p>
      <table>
        <tr><td>2024</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>&nbsp;</td></tr>
        <tr><td>2023</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>4.60%</td></tr>
      </table>
    `;
    // 2024 is rejected for unparseable ERP; 2023 wins.
    const parsed = parseDamodaranHtml(html);
    expect(parsed!.year).toBe(2023);
    expect(parsed!.erp).toBeCloseTo(0.046, 4);
  });
});

describe("fetchLiveDamodaranERP", () => {
  beforeEach(() => {
    __resetDamodaranFetcherCacheForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __resetDamodaranFetcherCacheForTest();
  });

  it("fetches and parses on a cold cache", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(SAMPLE_HTML),
    } as unknown as Response);
    const result = await fetchLiveDamodaranERP();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result?.year).toBe(2025);
    expect(result?.erp).toBeCloseTo(0.0423, 4);
    expect(result?.asOf).toBe("2026-01-01");
  });

  it("does not refetch within the 7-day TTL", async () => {
    __seedDamodaranFetcherCacheForTest(
      { erp: 0.05, asOf: "2026-01-01", year: 2025 },
      Date.now(),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await fetchLiveDamodaranERP();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result?.erp).toBeCloseTo(0.05, 6);
  });

  it("returns stale cache when fetch fails", async () => {
    __seedDamodaranFetcherCacheForTest(
      { erp: 0.05, asOf: "2025-06-01", year: 2024 },
      Date.now() - 8 * 24 * 60 * 60 * 1000, // > 7 days ago
    );
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("500"));
    const result = await fetchLiveDamodaranERP();
    expect(result?.erp).toBeCloseTo(0.05, 6);
  });

  it("returns null when fetch fails and there is no cache", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("500"));
    const result = await fetchLiveDamodaranERP();
    expect(result).toBeNull();
  });

  it("returns null on non-2xx HTTP response with no cache", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve(""),
    } as unknown as Response);
    const result = await fetchLiveDamodaranERP();
    expect(result).toBeNull();
  });

  it("returns null when the HTML cannot be parsed and there is no cache", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("<html><body>no table here</body></html>"),
    } as unknown as Response);
    const result = await fetchLiveDamodaranERP();
    expect(result).toBeNull();
  });
});
