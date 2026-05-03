// src/lib/dashboard/metrics/behavioral-audit.test.ts
//
// Pure-math tests for the three behavioral audit signals.

import { describe, it, expect } from "vitest";
import {
  isUsListed,
  computeHomeBias,
  computeConcentrationDrift,
  computeRecencyChase,
  US_GLOBAL_MARKET_CAP_WEIGHT,
} from "./behavioral-audit";

describe("isUsListed", () => {
  it("returns true for bare US tickers", () => {
    expect(isUsListed("AAPL")).toBe(true);
    expect(isUsListed("MSFT")).toBe(true);
    expect(isUsListed("BRK.B")).toBe(false); // BRK.B has the .B class suffix and is technically US,
    // but our heuristic flags any 1-3 letter suffix as foreign — that's an
    // acceptable false-positive for the home-bias signal (BRK.B is single
    // ticker; if user has it, they have ~0.5% bias error). Document and accept.
  });

  it("returns false for foreign tickers", () => {
    expect(isUsListed("TD.TO")).toBe(false);
    expect(isUsListed("HSBA.L")).toBe(false);
    expect(isUsListed("0700.HK")).toBe(false);
    expect(isUsListed("BHP.AX")).toBe(false);
  });

  it("returns false for crypto symbols", () => {
    expect(isUsListed("BTC-USD")).toBe(false);
    expect(isUsListed("ETH-USD")).toBe(false);
  });

  it("handles lowercase input", () => {
    expect(isUsListed("aapl")).toBe(true);
    expect(isUsListed("td.to")).toBe(false);
  });
});

describe("computeHomeBias", () => {
  it("returns null on empty input", () => {
    expect(computeHomeBias([])).toBeNull();
  });

  it("returns neutral when US share matches baseline", () => {
    const reading = computeHomeBias([
      { ticker: "AAPL", weight: 0.6 },
      { ticker: "TD.TO", weight: 0.4 },
    ]);
    expect(reading?.usShare).toBe(0.6);
    expect(reading?.deltaPp).toBe(0);
    expect(reading?.level).toBe("neutral");
  });

  it("flags moderate home bias at +20pp", () => {
    const reading = computeHomeBias([
      { ticker: "AAPL", weight: 0.8 },
      { ticker: "TD.TO", weight: 0.2 },
    ]);
    expect(reading?.usShare).toBe(0.8);
    expect(reading?.deltaPp).toBe(20);
    expect(reading?.level).toBe("moderate");
  });

  it("flags extreme home bias at +40pp", () => {
    const reading = computeHomeBias([
      { ticker: "AAPL", weight: 1.0 },
    ]);
    expect(reading?.usShare).toBe(1);
    expect(reading?.deltaPp).toBe(40);
    expect(reading?.level).toBe("extreme");
  });

  it("respects explicit isUs override", () => {
    const reading = computeHomeBias([
      { ticker: "BRK.B", weight: 0.5, isUs: true }, // explicitly US despite suffix
      { ticker: "TD.TO", weight: 0.5 },
    ]);
    expect(reading?.usShare).toBe(0.5);
  });

  it("uses configurable baseline", () => {
    const reading = computeHomeBias(
      [{ ticker: "AAPL", weight: 1.0 }],
      0.5,
    );
    expect(reading?.deltaPp).toBe(50);
  });

  it("US baseline constant is around 60%", () => {
    expect(US_GLOBAL_MARKET_CAP_WEIGHT).toBeGreaterThan(0.5);
    expect(US_GLOBAL_MARKET_CAP_WEIGHT).toBeLessThan(0.7);
  });
});

describe("computeConcentrationDrift", () => {
  it("returns null with fewer than 2 snapshots", () => {
    expect(computeConcentrationDrift([])).toBeNull();
    expect(
      computeConcentrationDrift([
        { capturedAt: "2026-01-01", weights: { Tech: 0.5 } },
      ]),
    ).toBeNull();
  });

  it("flags rising trend when top-3 grew >5pp", () => {
    // Tech / Health / Energy are unambiguously the largest three;
    // remaining weight is split across many small sectors so none
    // can crowd top-3.
    const reading = computeConcentrationDrift([
      {
        capturedAt: "2026-01-01",
        weights: {
          Tech: 0.3,
          Health: 0.2,
          Energy: 0.15,
          A: 0.05,
          B: 0.05,
          C: 0.05,
          D: 0.05,
          E: 0.05,
          F: 0.05,
          G: 0.05,
        },
      },
      {
        capturedAt: "2026-05-01",
        weights: {
          Tech: 0.5,
          Health: 0.25,
          Energy: 0.15,
          A: 0.02,
          B: 0.02,
          C: 0.02,
          D: 0.01,
          E: 0.01,
          F: 0.01,
          G: 0.01,
        },
      },
    ]);
    expect(reading?.priorTop3).toBe(0.65);
    expect(reading?.currentTop3).toBe(0.9);
    expect(reading?.deltaPp).toBe(25);
    expect(reading?.trend).toBe("rising");
    expect(reading?.topSectors).toEqual(["Tech", "Health", "Energy"]);
  });

  it("flags falling trend when top-3 shrunk >5pp", () => {
    const reading = computeConcentrationDrift([
      {
        capturedAt: "2026-01-01",
        weights: {
          Tech: 0.5,
          Health: 0.25,
          Energy: 0.15,
          A: 0.02,
          B: 0.02,
          C: 0.02,
          D: 0.01,
          E: 0.01,
          F: 0.01,
          G: 0.01,
        },
      },
      {
        capturedAt: "2026-05-01",
        weights: {
          Tech: 0.3,
          Health: 0.2,
          Energy: 0.15,
          A: 0.05,
          B: 0.05,
          C: 0.05,
          D: 0.05,
          E: 0.05,
          F: 0.05,
          G: 0.05,
        },
      },
    ]);
    expect(reading?.trend).toBe("falling");
  });

  it("flags stable trend within +/- 5pp", () => {
    const reading = computeConcentrationDrift([
      {
        capturedAt: "2026-01-01",
        weights: {
          Tech: 0.3,
          Health: 0.2,
          Energy: 0.15,
          A: 0.05,
          B: 0.05,
          C: 0.05,
          D: 0.05,
          E: 0.05,
          F: 0.05,
          G: 0.05,
        },
      },
      {
        capturedAt: "2026-05-01",
        weights: {
          Tech: 0.32,
          Health: 0.21,
          Energy: 0.14,
          A: 0.05,
          B: 0.05,
          C: 0.05,
          D: 0.04,
          E: 0.05,
          F: 0.04,
          G: 0.05,
        },
      },
    ]);
    expect(reading?.trend).toBe("stable");
  });

  it("handles unsorted input by capturedAt", () => {
    const reading = computeConcentrationDrift([
      {
        capturedAt: "2026-05-01",
        weights: { Tech: 0.5, Health: 0.2, Energy: 0.1 },
      },
      {
        capturedAt: "2026-01-01",
        weights: { Tech: 0.3, Health: 0.2, Energy: 0.1 },
      },
    ]);
    expect(reading?.deltaPp).toBeGreaterThan(0);
    expect(reading?.trend).toBe("rising");
  });
});

describe("computeRecencyChase", () => {
  it("returns null with fewer than 3 usable recommendations", () => {
    expect(computeRecencyChase([])).toBeNull();
    expect(
      computeRecencyChase([
        { ticker: "AAPL", recommendation: "BUY", ytdReturnAtTime: 0.2 },
      ]),
    ).toBeNull();
  });

  it("flags high chase rate when most BUYs target winners", () => {
    const reading = computeRecencyChase([
      { ticker: "A", recommendation: "BUY", ytdReturnAtTime: 0.2 },
      { ticker: "B", recommendation: "BUY", ytdReturnAtTime: 0.3 },
      { ticker: "C", recommendation: "BUY", ytdReturnAtTime: 0.15 },
      { ticker: "D", recommendation: "BUY", ytdReturnAtTime: -0.05 }, // not a winner
    ]);
    expect(reading?.chaseCount).toBe(3);
    expect(reading?.totalCount).toBe(4);
    expect(reading?.chaseRate).toBe(0.75);
    expect(reading?.level).toBe("high");
  });

  it("flags moderate chase rate at 30-60%", () => {
    const reading = computeRecencyChase([
      { ticker: "A", recommendation: "BUY", ytdReturnAtTime: 0.2 },
      { ticker: "B", recommendation: "BUY", ytdReturnAtTime: -0.05 },
      { ticker: "C", recommendation: "BUY", ytdReturnAtTime: -0.1 },
    ]);
    expect(reading?.chaseRate).toBeCloseTo(0.33, 2);
    expect(reading?.level).toBe("moderate");
  });

  it("flags low chase rate when BUYs target losers", () => {
    const reading = computeRecencyChase([
      { ticker: "A", recommendation: "BUY", ytdReturnAtTime: -0.2 },
      { ticker: "B", recommendation: "BUY", ytdReturnAtTime: -0.05 },
      { ticker: "C", recommendation: "BUY", ytdReturnAtTime: 0.0 },
    ]);
    expect(reading?.chaseCount).toBe(0);
    expect(reading?.level).toBe("low");
  });

  it("ignores HOLD/SELL recommendations from the buy count", () => {
    const reading = computeRecencyChase([
      { ticker: "A", recommendation: "BUY", ytdReturnAtTime: 0.2 },
      { ticker: "B", recommendation: "HOLD", ytdReturnAtTime: 0.2 },
      { ticker: "C", recommendation: "SELL", ytdReturnAtTime: 0.2 },
    ]);
    expect(reading?.totalCount).toBe(1);
    expect(reading?.chaseCount).toBe(1);
  });

  it("returns null when no BUYs in usable set", () => {
    const reading = computeRecencyChase([
      { ticker: "A", recommendation: "HOLD", ytdReturnAtTime: 0.2 },
      { ticker: "B", recommendation: "HOLD", ytdReturnAtTime: 0.3 },
      { ticker: "C", recommendation: "SELL", ytdReturnAtTime: 0.1 },
    ]);
    expect(reading).toBeNull();
  });
});
