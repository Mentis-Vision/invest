// src/lib/dashboard/metrics/macro-valuation.ts
//
// Macro-valuation chips for the regime tile / macro snapshot:
//   * Buffett indicator = Wilshire 5000 / nominal GDP
//   * Shiller CAPE      = deferred (no stable free API)
//
// On the Buffett indicator:
//   - WILL5000PRFC (FRED) is the Wilshire 5000 Total Market Index in
//     millions of USD, daily.
//   - GDP (FRED) is nominal US GDP in billions of USD, quarterly.
//   - The Buffett ratio is unitless: it's the total US equity market
//     cap divided by GDP. To match units we divide by (GDP * 1000)
//     because Wilshire is millions and GDP is billions.
//   - Historical context (informational only):
//       <  0.85   undervalued
//       0.85-1.10 fairly valued
//       1.10-1.40 modestly overvalued
//       >  1.40   significantly overvalued
//     We don't render those bands here — the chip just shows the
//     ratio; the disclaimer banner already covers the
//     "informational only, not advice" rule.
//
// On CAPE (Shiller P/E):
//   - Robert Shiller publishes a monthly spreadsheet at
//     shillerdata.com; multpl.com scrapes it. Neither is a stable
//     free API and both impose attribution / scrape-rate limits.
//   - Manual constants would go stale within a quarter and have
//     near-zero value compared to the live Buffett indicator.
//   - Decision: keep CAPE deferred here (returns null, UI hides
//     the chip). Damodaran's monthly implied ERP — wired in
//     `damodaran-loader.ts` and surfaced via DamodaranCard in
//     Phase 4 Batch J — is the credible alternative we shipped
//     instead. Same spirit (forward-looking market valuation
//     anchor) without the brittle Shiller scrape.

import { getLatestSeriesValue } from "../../data/fred";
import { log, errorInfo } from "../../log";

export interface MacroValuation {
  /** Buffett indicator (market cap / GDP), unitless. null when unavailable. */
  buffett: number | null;
  /** Shiller CAPE — deferred until a stable source is wired. */
  cape: number | null;
  /**
   * Coarse band the Buffett indicator falls into. Surfaced as a
   * tooltip / sub-label, not as actionable advice.
   */
  buffettBand: "undervalued" | "fair" | "elevated" | "stretched" | null;
  /** Date of the Wilshire observation, when known. */
  asOf: string | null;
}

function classifyBuffett(ratio: number): MacroValuation["buffettBand"] {
  if (!Number.isFinite(ratio)) return null;
  if (ratio < 0.85) return "undervalued";
  if (ratio < 1.1) return "fair";
  if (ratio < 1.4) return "elevated";
  return "stretched";
}

/**
 * Fetches the Buffett indicator (and the still-deferred CAPE).
 * Both legs are wrapped in catches so an outage in either FRED series
 * doesn't break the dashboard — `buffett` falls back to null and the
 * UI simply hides the chip.
 */
export async function getMacroValuation(): Promise<MacroValuation> {
  const [wilshire, gdp] = await Promise.all([
    getLatestSeriesValue("WILL5000PRFC").catch((err) => {
      log.warn("dashboard.macro-val", "WILL5000PRFC fetch failed", {
        ...errorInfo(err),
      });
      return null;
    }),
    getLatestSeriesValue("GDP").catch((err) => {
      log.warn("dashboard.macro-val", "GDP fetch failed", {
        ...errorInfo(err),
      });
      return null;
    }),
  ]);

  let buffett: number | null = null;
  if (
    wilshire &&
    gdp &&
    Number.isFinite(wilshire.value) &&
    Number.isFinite(gdp.value) &&
    gdp.value > 0
  ) {
    // Wilshire millions / (GDP billions * 1000) → unitless ratio.
    buffett = wilshire.value / (gdp.value * 1000);
    if (!Number.isFinite(buffett)) buffett = null;
  }

  return {
    buffett,
    cape: null, // deferred — see file header
    buffettBand: buffett !== null ? classifyBuffett(buffett) : null,
    asOf: wilshire?.date ?? null,
  };
}
