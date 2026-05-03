// src/lib/dashboard/metrics/tax.ts
// Pure tax helpers for the Phase 3 Batch H tax-loss harvest layer.
//
// Three surfaces:
//
//   - unrealizedLoss(costBasis, currentValue) → negative number or 0.
//     Returns the loss amount (always ≤ 0); positive deltas collapse
//     to 0 so callers can filter by `loss <= -threshold` without
//     juggling signs.
//
//   - isWashSaleWindow(soldDate, today) → true when soldDate falls
//     inside the IRS 30-day before/after window relative to today.
//     Symmetric: applies whether the user has just sold (today is
//     after soldDate) or is about to sell (today is before).
//
//   - suggestReplacement(soldTicker, sectorMap) → ETF ticker or null.
//     Hardcoded sector → broad ETF mapping for v1; ticker overrides
//     are intentionally empty until each pair is verified clean.
//
// IMPORTANT: the IRS "substantially identical" test for wash-sale safety
// is fuzzy and case-by-case. UI must always render a disclaimer beneath
// suggestions: "Suggested replacement is general guidance; verify
// wash-sale safety with your tax advisor before acting."
//
// Zero side effects, zero I/O. Tested in tax.test.ts.

const WASH_SALE_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Sector → broad-market sector ETF replacement candidates.
 *
 * The mapping is intentionally generic — Vanguard sector ETFs whose
 * holdings are diversified across the sector and therefore unlikely
 * to be deemed "substantially identical" to any one constituent stock.
 * Still: not a substitute for tax-advisor review. Disclaimer required
 * on every surface that consumes this map.
 *
 * Keys match the canonical sector strings stored in `holding.sector`
 * (Yahoo categorization). Add lower-case aliases as we encounter them
 * — see `suggestReplacement` for the case-insensitive lookup.
 */
export const SECTOR_REPLACEMENTS: Record<string, string> = {
  Technology: "VGT",
  Healthcare: "VHT",
  Financials: "VFH",
  Energy: "VDE",
  Consumer: "VCR",
  Industrials: "VIS",
  Utilities: "VPU",
  Materials: "VAW",
  RealEstate: "VNQ",
  Communication: "VOX",
};

/**
 * Per-ticker overrides for cases where the sector mapping is too
 * generic. Intentionally empty in v1 — we only add a pair after
 * confirming it's not "substantially identical" under IRS guidance,
 * which is a manual review per pair.
 */
export const TICKER_REPLACEMENTS: Record<string, string> = {
  // intentionally empty in v1
};

/**
 * Returns the unrealized loss as a non-positive number.
 * Gains and break-evens collapse to 0 so callers can filter on
 * `loss <= -threshold` without sign juggling.
 *
 * Non-finite or non-numeric inputs return 0 (no loss recognized).
 */
export function unrealizedLoss(
  costBasis: number | null | undefined,
  currentValue: number | null | undefined,
): number {
  if (
    costBasis === null ||
    costBasis === undefined ||
    currentValue === null ||
    currentValue === undefined
  ) {
    return 0;
  }
  if (!Number.isFinite(costBasis) || !Number.isFinite(currentValue)) {
    return 0;
  }
  const delta = currentValue - costBasis;
  return delta < 0 ? delta : 0;
}

/**
 * IRS wash-sale 30-day window check. Returns true when the absolute
 * difference between soldDate and today is ≤30 calendar days.
 *
 * The IRS rule reads: "if you sell a security at a loss and buy the
 * same or substantially identical security within 30 days before OR
 * after the sale, the loss is disallowed." We implement the symmetric
 * window so the same helper covers both directions: "I just sold,
 * can I buy?" and "I'm thinking of selling, did I just buy?"
 *
 * Bound is INCLUSIVE on both ends (≤30, not <30) — IRS phrasing
 * counts the 30th day inside the prohibited window.
 */
export function isWashSaleWindow(soldDate: Date, today: Date): boolean {
  if (!(soldDate instanceof Date) || !(today instanceof Date)) return false;
  if (Number.isNaN(soldDate.getTime()) || Number.isNaN(today.getTime())) {
    return false;
  }
  const diffMs = Math.abs(today.getTime() - soldDate.getTime());
  const diffDays = Math.floor(diffMs / MS_PER_DAY);
  return diffDays <= WASH_SALE_WINDOW_DAYS;
}

/**
 * Suggest a wash-sale-safe replacement for `soldTicker`.
 *
 * Resolution order:
 *   1. Per-ticker override (TICKER_REPLACEMENTS — empty in v1).
 *   2. Sector ETF mapping derived from `sectorMap[soldTicker]`.
 *
 * Returns null when no clean mapping exists (unknown sector, missing
 * sector, or sector → ETF lookup miss). Caller renders no suggestion
 * rather than a misleading guess.
 *
 * Sector matching is case-insensitive on the first word so common
 * variations ("Consumer Cyclical" / "Consumer Defensive" / "consumer
 * discretionary" / "Consumer Staples") all map to VCR.
 *
 * Always paired with the standard disclaimer at the call site.
 */
export function suggestReplacement(
  soldTicker: string,
  sectorMap: Record<string, string | null | undefined>,
): string | null {
  if (!soldTicker || typeof soldTicker !== "string") return null;
  const upper = soldTicker.toUpperCase();
  const override = TICKER_REPLACEMENTS[upper];
  if (override) return override;

  const sector = sectorMap[upper] ?? sectorMap[soldTicker];
  if (!sector || typeof sector !== "string") return null;

  // Build a case-insensitive index over the canonical keys with a
  // few extra aliases so Yahoo / SnapTrade variants ("Financial
  // Services", "Consumer Cyclical", "Real Estate", "Communication
  // Services") all land on the right ETF.
  const norm = (s: string) =>
    s.replace(/\s+/g, "").toLowerCase();
  const aliasIndex: Record<string, string> = {};
  for (const k of Object.keys(SECTOR_REPLACEMENTS)) {
    aliasIndex[norm(k)] = SECTOR_REPLACEMENTS[k];
  }
  // Plural / variant aliases — Yahoo emits singulars for some sectors.
  aliasIndex.financial = SECTOR_REPLACEMENTS.Financials;
  aliasIndex.financialservices = SECTOR_REPLACEMENTS.Financials;
  aliasIndex.communicationservices = SECTOR_REPLACEMENTS.Communication;
  aliasIndex.basicmaterials = SECTOR_REPLACEMENTS.Materials;
  aliasIndex.consumerstaples = SECTOR_REPLACEMENTS.Consumer;
  aliasIndex.consumerdiscretionary = SECTOR_REPLACEMENTS.Consumer;
  aliasIndex.consumercyclical = SECTOR_REPLACEMENTS.Consumer;
  aliasIndex.consumerdefensive = SECTOR_REPLACEMENTS.Consumer;
  aliasIndex.realestate = SECTOR_REPLACEMENTS.RealEstate;
  aliasIndex.health = SECTOR_REPLACEMENTS.Healthcare;
  aliasIndex.healthcare = SECTOR_REPLACEMENTS.Healthcare;
  aliasIndex.tech = SECTOR_REPLACEMENTS.Technology;

  // First pass: full normalized string.
  const full = norm(sector);
  if (aliasIndex[full]) return aliasIndex[full];

  // Second pass: leading word only ("Consumer Cyclical" → "consumer").
  const firstWord = sector.split(/\s+/)[0]?.trim();
  if (firstWord && aliasIndex[norm(firstWord)]) {
    return aliasIndex[norm(firstWord)];
  }

  return null;
}
