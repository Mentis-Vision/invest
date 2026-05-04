import { describe, it, expect, beforeEach } from "vitest";
import {
  recordFetcherEvent,
  getFetcherHealth,
  _resetFetcherHealthForTest,
} from "./fetcher-health";

beforeEach(() => {
  _resetFetcherHealthForTest();
});

describe("recordFetcherEvent + getFetcherHealth", () => {
  it("returns clean snapshots when no events recorded", () => {
    const health = getFetcherHealth();
    expect(health).toHaveLength(3);
    expect(health.every((h) => h.lastEvent === null && !h.degraded)).toBe(true);
  });

  it("marks source degraded after fallback", () => {
    recordFetcherEvent("fama-french", "fallback", "stale cache");
    const health = getFetcherHealth();
    const ff = health.find((h) => h.source === "fama-french");
    expect(ff?.degraded).toBe(true);
    expect(ff?.totalFallbacks24h).toBe(1);
  });

  it("clears degraded flag after a successful fetch", () => {
    recordFetcherEvent("damodaran", "fallback");
    recordFetcherEvent("damodaran", "live");
    const health = getFetcherHealth();
    const dam = health.find((h) => h.source === "damodaran");
    expect(dam?.degraded).toBe(false);
    expect(dam?.lastEvent?.outcome).toBe("live");
  });

  it("counts errors separately from fallbacks", () => {
    recordFetcherEvent("fomc", "error");
    const health = getFetcherHealth();
    const fomc = health.find((h) => h.source === "fomc");
    expect(fomc?.totalErrors24h).toBe(1);
    expect(fomc?.totalFallbacks24h).toBe(0);
    expect(fomc?.degraded).toBe(true);
  });

  it("treats sources independently", () => {
    recordFetcherEvent("fama-french", "fallback");
    recordFetcherEvent("damodaran", "live");
    const health = getFetcherHealth();
    const ff = health.find((h) => h.source === "fama-french");
    const dam = health.find((h) => h.source === "damodaran");
    expect(ff?.degraded).toBe(true);
    expect(dam?.degraded).toBe(false);
  });
});
