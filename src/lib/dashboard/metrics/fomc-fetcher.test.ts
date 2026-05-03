// src/lib/dashboard/metrics/fomc-fetcher.test.ts
//
// Tests for the federalreserve.gov FOMC calendar scraper. We verify
// the parser against a synthetic HTML fixture that mirrors the
// repeating fomc-meeting__month + fomc-meeting__date pattern, then
// assert cache TTL and graceful failure semantics.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseFOMCDatesFromHtml,
  fetchFOMCCalendar,
  __resetFomcFetcherCacheForTest,
  __seedFomcFetcherCacheForTest,
} from "./fomc-fetcher";

const SAMPLE_HTML = `
<html><body>
  <h4>2026 FOMC Meetings</h4>
  <div class="row fomc-meeting">
    <div class="fomc-meeting__month col"><strong>January</strong></div>
    <div class="fomc-meeting__date col">27-28</div>
  </div>
  <div class="row fomc-meeting">
    <div class="fomc-meeting--shaded fomc-meeting__month col"><strong>March</strong></div>
    <div class="fomc-meeting__date col">17-18*</div>
  </div>
  <div class="row fomc-meeting">
    <div class="fomc-meeting__month col"><strong>April</strong></div>
    <div class="fomc-meeting__date col">28-29</div>
  </div>
  <div class="row fomc-meeting">
    <div class="fomc-meeting__month col"><strong>December</strong></div>
    <div class="fomc-meeting__date col">8-9</div>
  </div>

  <h4>2027 FOMC Meetings</h4>
  <div class="row fomc-meeting">
    <div class="fomc-meeting__month col"><strong>January</strong></div>
    <div class="fomc-meeting__date col">26-27</div>
  </div>
  <div class="row fomc-meeting">
    <div class="fomc-meeting__month col"><strong>March</strong></div>
    <div class="fomc-meeting__date col">16-17*</div>
  </div>
</body></html>
`;

describe("parseFOMCDatesFromHtml", () => {
  it("extracts the second day of each meeting as the announcement date", () => {
    const dates = parseFOMCDatesFromHtml(SAMPLE_HTML);
    expect(dates).toContain("2026-01-28");
    expect(dates).toContain("2026-03-18");
    expect(dates).toContain("2026-04-29");
    expect(dates).toContain("2026-12-09");
    expect(dates).toContain("2027-01-27");
    expect(dates).toContain("2027-03-17");
  });

  it("returns dates sorted ascending", () => {
    const dates = parseFOMCDatesFromHtml(SAMPLE_HTML);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it("dedups dates that appear in both summary and detail sections", () => {
    const html = SAMPLE_HTML + SAMPLE_HTML; // duplicate the entire page
    const dates = parseFOMCDatesFromHtml(html);
    const set = new Set(dates);
    expect(dates.length).toBe(set.size);
  });

  it("strips the asterisk that marks meetings with projection materials", () => {
    const dates = parseFOMCDatesFromHtml(SAMPLE_HTML);
    // 17-18* should be parsed as 2026-03-18, no asterisk leakage
    expect(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
  });

  it("handles a single-day meeting (no range)", () => {
    const html = `
      <h4>2025 FOMC Meetings</h4>
      <div class="row fomc-meeting">
        <div class="fomc-meeting__month col"><strong>July</strong></div>
        <div class="fomc-meeting__date col">15</div>
      </div>
    `;
    const dates = parseFOMCDatesFromHtml(html);
    expect(dates).toEqual(["2025-07-15"]);
  });

  it("handles cross-month meetings (day2 < day1)", () => {
    // "29-1" means meeting starts Jan 29, ends Feb 1 - announcement
    // is Feb 1.
    const html = `
      <h4>2024 FOMC Meetings</h4>
      <div class="row fomc-meeting">
        <div class="fomc-meeting__month col"><strong>January</strong></div>
        <div class="fomc-meeting__date col">29-1</div>
      </div>
    `;
    const dates = parseFOMCDatesFromHtml(html);
    expect(dates).toEqual(["2024-02-01"]);
  });

  it("returns [] when no FOMC year sections are present", () => {
    expect(parseFOMCDatesFromHtml("<html></html>")).toEqual([]);
  });

  it("returns [] when meeting markup is missing", () => {
    const html = "<h4>2026 FOMC Meetings</h4><p>no meetings here</p>";
    expect(parseFOMCDatesFromHtml(html)).toEqual([]);
  });
});

describe("fetchFOMCCalendar", () => {
  beforeEach(() => {
    __resetFomcFetcherCacheForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __resetFomcFetcherCacheForTest();
  });

  it("fetches and parses on a cold cache", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(SAMPLE_HTML),
    } as unknown as Response);
    const dates = await fetchFOMCCalendar();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(dates).toContain("2026-01-28");
    expect(dates).toContain("2027-03-17");
  });

  it("does not refetch within the 7-day TTL", async () => {
    const seeded = ["2026-03-18", "2026-04-29"];
    __seedFomcFetcherCacheForTest(seeded, Date.now());
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const dates = await fetchFOMCCalendar();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dates).toEqual(seeded);
  });

  it("returns stale cache when fetch fails", async () => {
    const seeded = ["2025-12-17", "2026-01-28"];
    __seedFomcFetcherCacheForTest(
      seeded,
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    );
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("dns"));
    const dates = await fetchFOMCCalendar();
    expect(dates).toEqual(seeded);
  });

  it("returns [] when fetch fails and there is no cache", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("dns"));
    const dates = await fetchFOMCCalendar();
    expect(dates).toEqual([]);
  });

  it("returns [] on non-2xx HTTP response with no cache", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve(""),
    } as unknown as Response);
    const dates = await fetchFOMCCalendar();
    expect(dates).toEqual([]);
  });
});
