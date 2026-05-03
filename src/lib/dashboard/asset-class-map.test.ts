// src/lib/dashboard/asset-class-map.test.ts

import { describe, it, expect } from "vitest";
import {
  classifyTicker,
  BOND_ETFS,
  COMMODITY_ETFS,
} from "./asset-class-map";

describe("classifyTicker", () => {
  it("classifies known Treasury ETFs as bond", () => {
    expect(classifyTicker("TLT", "etf")).toBe("bond");
    expect(classifyTicker("IEF", "etf")).toBe("bond");
    expect(classifyTicker("SHY", null)).toBe("bond");
  });

  it("classifies aggregate-bond ETFs as bond", () => {
    expect(classifyTicker("AGG", "etf")).toBe("bond");
    expect(classifyTicker("BND", "etf")).toBe("bond");
  });

  it("classifies gold and silver ETFs as commodity", () => {
    expect(classifyTicker("GLD", "etf")).toBe("commodity");
    expect(classifyTicker("SLV", "etf")).toBe("commodity");
    expect(classifyTicker("IAU", null)).toBe("commodity");
  });

  it("preserves stock for individual equities", () => {
    expect(classifyTicker("AAPL", "stock")).toBe("stock");
    expect(classifyTicker("MSFT", "stock")).toBe("stock");
  });

  it("normalizes 'equity' assetClass to 'stock'", () => {
    expect(classifyTicker("AAPL", "equity")).toBe("stock");
  });

  it("preserves etf for unclassified ETFs", () => {
    expect(classifyTicker("SPY", "etf")).toBe("etf");
    expect(classifyTicker("QQQ", "etf")).toBe("etf");
  });

  it("preserves crypto when the holding row reports crypto", () => {
    expect(classifyTicker("BTC", "crypto")).toBe("crypto");
    expect(classifyTicker("ETH", "crypto")).toBe("crypto");
  });

  it("preserves cash when the holding row reports cash", () => {
    expect(classifyTicker("USD", "cash")).toBe("cash");
  });

  it("returns 'unknown' for an unknown ticker with no row class", () => {
    expect(classifyTicker("ZZZZ", null)).toBe("unknown");
  });

  it("returns 'unknown' for an unrecognized assetClass string", () => {
    expect(classifyTicker("ZZZZ", "futures")).toBe("unknown");
  });

  it("ETF lookup takes precedence over upstream assetClass", () => {
    // Even if Plaid mis-tagged TLT as 'stock', the bond map wins.
    expect(classifyTicker("TLT", "stock")).toBe("bond");
    expect(classifyTicker("GLD", "stock")).toBe("commodity");
  });

  it("ticker comparison is case-insensitive", () => {
    expect(classifyTicker("tlt", "etf")).toBe("bond");
    expect(classifyTicker("Gld", "etf")).toBe("commodity");
  });

  it("BOND_ETFS and COMMODITY_ETFS sets do not overlap", () => {
    for (const t of BOND_ETFS) {
      expect(COMMODITY_ETFS.has(t)).toBe(false);
    }
  });
});
