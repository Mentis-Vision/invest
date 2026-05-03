// src/lib/dashboard/metrics/tax.test.ts
import { describe, it, expect } from "vitest";
import {
  unrealizedLoss,
  isWashSaleWindow,
  suggestReplacement,
  SECTOR_REPLACEMENTS,
  TICKER_REPLACEMENTS,
} from "./tax";

describe("unrealizedLoss", () => {
  it("returns negative number when current value is below cost basis", () => {
    expect(unrealizedLoss(1000, 800)).toBe(-200);
    expect(unrealizedLoss(5000, 4500)).toBe(-500);
  });

  it("returns 0 for gains", () => {
    expect(unrealizedLoss(1000, 1500)).toBe(0);
    expect(unrealizedLoss(100, 100.01)).toBe(0);
  });

  it("returns 0 for break-even", () => {
    expect(unrealizedLoss(1000, 1000)).toBe(0);
  });

  it("returns 0 for null / undefined inputs", () => {
    expect(unrealizedLoss(null, 100)).toBe(0);
    expect(unrealizedLoss(100, null)).toBe(0);
    expect(unrealizedLoss(undefined, undefined)).toBe(0);
  });

  it("returns 0 for non-finite numbers", () => {
    expect(unrealizedLoss(Number.NaN, 100)).toBe(0);
    expect(unrealizedLoss(100, Number.POSITIVE_INFINITY)).toBe(0);
    expect(unrealizedLoss(Number.NEGATIVE_INFINITY, 100)).toBe(0);
  });
});

describe("isWashSaleWindow", () => {
  const today = new Date("2026-05-02T12:00:00Z");

  it("flags sale 1 day before today", () => {
    const sold = new Date("2026-05-01T12:00:00Z");
    expect(isWashSaleWindow(sold, today)).toBe(true);
  });

  it("flags sale exactly 30 days before today (inclusive)", () => {
    const sold = new Date("2026-04-02T12:00:00Z");
    expect(isWashSaleWindow(sold, today)).toBe(true);
  });

  it("rejects sale 31 days before today", () => {
    const sold = new Date("2026-04-01T11:00:00Z");
    expect(isWashSaleWindow(sold, today)).toBe(false);
  });

  it("flags sale 1 day in the future (symmetric)", () => {
    const sold = new Date("2026-05-03T12:00:00Z");
    expect(isWashSaleWindow(sold, today)).toBe(true);
  });

  it("flags sale 30 days in the future (symmetric)", () => {
    const sold = new Date("2026-06-01T12:00:00Z");
    expect(isWashSaleWindow(sold, today)).toBe(true);
  });

  it("rejects sale 31 days in the future", () => {
    const sold = new Date("2026-06-02T13:00:00Z");
    expect(isWashSaleWindow(sold, today)).toBe(false);
  });

  it("rejects invalid Date inputs", () => {
    expect(isWashSaleWindow(new Date("not-a-date"), today)).toBe(false);
    expect(isWashSaleWindow(today, new Date("not-a-date"))).toBe(false);
  });
});

describe("suggestReplacement", () => {
  const sectorMap: Record<string, string> = {
    NVDA: "Technology",
    JNJ: "Healthcare",
    XOM: "Energy",
    AMZN: "Consumer Cyclical",
    KO: "Consumer Defensive",
    BA: "Industrials",
    DUK: "Utilities",
    LIN: "Materials",
    SPG: "Real Estate",
    META: "Communication Services",
    JPM: "Financial Services",
  };

  it("maps Technology → VGT", () => {
    expect(suggestReplacement("NVDA", sectorMap)).toBe("VGT");
  });

  it("maps Healthcare → VHT", () => {
    expect(suggestReplacement("JNJ", sectorMap)).toBe("VHT");
  });

  it("collapses 'Consumer Cyclical' first-word → VCR", () => {
    expect(suggestReplacement("AMZN", sectorMap)).toBe("VCR");
  });

  it("collapses 'Consumer Defensive' first-word → VCR", () => {
    expect(suggestReplacement("KO", sectorMap)).toBe("VCR");
  });

  it("collapses 'Real Estate' (with space) → VNQ", () => {
    expect(suggestReplacement("SPG", sectorMap)).toBe("VNQ");
  });

  it("collapses 'Financial Services' → VFH", () => {
    expect(suggestReplacement("JPM", sectorMap)).toBe("VFH");
  });

  it("collapses 'Communication Services' → VOX", () => {
    expect(suggestReplacement("META", sectorMap)).toBe("VOX");
  });

  it("returns null when sector is unknown", () => {
    expect(suggestReplacement("XYZ", { XYZ: "Unknown Sector" })).toBeNull();
  });

  it("returns null when ticker has no sector entry", () => {
    expect(suggestReplacement("NVDA", {})).toBeNull();
  });

  it("returns null for empty / non-string input", () => {
    expect(suggestReplacement("", sectorMap)).toBeNull();
  });

  it("respects per-ticker override when present", () => {
    // Add a pretend override for the duration of the test by
    // mutating the exported object — restore it before exiting.
    const original = TICKER_REPLACEMENTS.NVDA;
    try {
      TICKER_REPLACEMENTS.NVDA = "QQQM";
      expect(suggestReplacement("NVDA", sectorMap)).toBe("QQQM");
    } finally {
      if (original === undefined) delete TICKER_REPLACEMENTS.NVDA;
      else TICKER_REPLACEMENTS.NVDA = original;
    }
  });

  it("exports the expected sector keys", () => {
    expect(Object.keys(SECTOR_REPLACEMENTS)).toEqual(
      expect.arrayContaining([
        "Technology",
        "Healthcare",
        "Financials",
        "Energy",
        "Consumer",
        "Industrials",
        "Utilities",
        "Materials",
        "RealEstate",
        "Communication",
      ]),
    );
  });
});
