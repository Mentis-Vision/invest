// src/lib/dashboard/asset-class-map.ts
//
// Phase 4 Batch I — closes Phase 3 Batch G's deferral. The `holding`
// table's `assetClass` enum upstream from SnapTrade / Plaid only
// distinguishes stock / etf / cash / crypto — there's no native bond
// classification. The glidepath donut previously inferred a bonds /
// cash split from non-stock holdings using the target ratio as a
// proxy, which understated bond exposure for users who actually hold
// bond ETFs.
//
// This module ships a static lookup of well-known fixed-income and
// commodity ETF tickers, layered on top of whatever assetClass the
// holding row already carries. classifyTicker prefers the ETF lookup
// first (so TLT classed as "etf" upstream still surfaces as "bond"
// here) then falls back to the row's assetClass.
//
// Universe sourced from the largest-AUM US-listed bond and commodity
// ETFs as of 2026 — covers >95% of typical retail allocations. Not
// exhaustive: a niche bond fund will fall through to "etf", which
// the glidepath visualizer will still render. Adding new tickers is
// a one-line change.
//
// Pure module: no DB, no I/O. Tested in asset-class-map.test.ts.

/** Canonical asset-class buckets used by the glidepath visualizer. */
export type AssetClass =
  | "stock"
  | "etf"
  | "bond"
  | "commodity"
  | "cash"
  | "crypto"
  | "unknown";

/**
 * US-listed fixed-income ETFs (Treasury / aggregate / corporate /
 * high-yield / muni / TIPS / international). Ticker uppercased.
 *
 * Curated from the top-AUM lists at iShares / Vanguard / SPDR /
 * Schwab; covers the funds most retail investors actually hold.
 */
export const BOND_ETFS = new Set<string>([
  // Treasuries
  "TLT", "IEF", "SHY", "GOVT", "BIL", "VGLT", "VGIT", "VGSH", "EDV",
  // Aggregate
  "AGG", "BND", "BNDX", "SCHZ",
  // Corporate
  "LQD", "VCIT", "VCSH", "VCLT", "IGSB", "IGIB",
  // High yield
  "HYG", "JNK", "USHY", "ANGL",
  // Munis
  "MUB", "TFI", "VTEB", "VWITX",
  // TIPS
  "TIP", "VTIP", "SCHP",
  // International
  "EMB", "PCY", "VWOB",
]);

/**
 * US-listed commodity ETFs / ETPs. Includes gold, silver, oil, natural
 * gas, platinum / palladium, and broad-basket diversified products.
 */
export const COMMODITY_ETFS = new Set<string>([
  // Gold
  "GLD", "IAU", "SGOL", "GLDM",
  // Silver
  "SLV", "SIVR",
  // Oil
  "USO", "DBO", "BNO", "USL",
  // Diversified / broad
  "DBC", "PDBC", "GSG", "BCI",
  // Natural gas
  "UNG", "BOIL",
  // Platinum / palladium
  "PPLT", "PALL",
]);

/**
 * Resolve the canonical asset class for a ticker.
 *
 * Order:
 *   1. Bond ETF lookup
 *   2. Commodity ETF lookup
 *   3. Fall through to whatever the holding row reports
 *
 * The fall-through preserves the upstream classification for plain
 * stocks ("stock") and uncategorized ETFs ("etf"). Cash and crypto
 * always come from the row — they have no ticker overlap with the
 * static maps. Anything we can't classify becomes "unknown".
 */
export function classifyTicker(
  ticker: string,
  holdingAssetClass: string | null,
): AssetClass {
  const upper = ticker.toUpperCase();
  if (BOND_ETFS.has(upper)) return "bond";
  if (COMMODITY_ETFS.has(upper)) return "commodity";

  switch (holdingAssetClass) {
    case "cash":
      return "cash";
    case "crypto":
      return "crypto";
    case "stock":
    case "equity":
      return "stock";
    case "etf":
      return "etf";
    case "bond":
      return "bond";
    case "commodity":
      return "commodity";
    default:
      return "unknown";
  }
}
