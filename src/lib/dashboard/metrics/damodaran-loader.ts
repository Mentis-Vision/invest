// src/lib/dashboard/metrics/damodaran-loader.ts
//
// Bridges the pure cost-of-capital math in damodaran.ts with the
// repo's existing data sources:
//
//   - Damodaran's market-level implied ERP (NYU Stern, monthly):
//     getDamodaranERP() now scrapes histimpl.html via the dedicated
//     fetcher in damodaran-fetcher.ts. Falls back to a pinned
//     constant when the live fetch fails on a cold instance.
//   - The risk-free rate from FRED (DGS10).
//   - Per-stock COE inputs from the existing yahoo snapshot
//     (price, dividend yield, beta).
//   - Forward growth from Yahoo's analyst growth estimate when
//     available, capped to a sensible range.

import { getStockSnapshot } from "../../data/yahoo";
import { getLatestSeriesValue } from "../../data/fred";
import { impliedCostOfEquity, type CostOfEquityResult } from "./damodaran";
import { fetchLiveDamodaranERP } from "./damodaran-fetcher";
import { log, errorInfo } from "../../log";

// Damodaran "histimpl.html" anchor — pinned baseline used only when
// the live fetch fails on a cold instance with no in-process cache.
// Refresh occasionally (annually is fine — it's a fallback). The
// anchor reflects the 2025 year-end FCFE-implied ERP.
//
// Source: Aswath Damodaran, NYU Stern School of Business,
// "Implied Equity Risk Premia" — pages.stern.nyu.edu/~adamodar/
const ERP_ANCHOR = 0.0423;
const ERP_ANCHOR_DATE = "2026-01-01";

// Default risk-free rate when DGS10 is unavailable. 10-year
// treasury yield Jan 2026 ~4.05%.
const RISK_FREE_FALLBACK = 0.0405;

// Default forward growth assumption when no analyst growth is wired:
// long-run nominal GDP growth, ~5%. Conservative anchor.
const DEFAULT_GROWTH = 0.05;

interface CachedRiskFree {
  fetchedAt: number;
  rate: number;
}
const RF_TTL_MS = 60 * 60 * 1000; // 1h
let rfCache: CachedRiskFree | null = null;

export interface DamodaranERP {
  /** Implied market ERP, fractional. */
  erp: number;
  /** ISO date the anchor is sourced from. */
  asOf: string;
  /** Provenance: "live" scrape, "cached" stale cache, or "anchor" pinned constant. */
  source: "anchor" | "live" | "cached";
}

interface CachedERP {
  fetchedAt: number;
  data: DamodaranERP;
}

const ERP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
let erpCache: CachedERP | null = null;

/**
 * Live Damodaran ERP. Tries the scraper first, falls back to the
 * pinned constant on a cold-instance + upstream failure. Async because
 * the live path makes a network call; the in-process cache amortizes
 * across renders.
 */
export async function getDamodaranERP(): Promise<DamodaranERP> {
  if (erpCache && Date.now() - erpCache.fetchedAt < ERP_TTL_MS) {
    return erpCache.data;
  }
  try {
    const live = await fetchLiveDamodaranERP();
    if (live) {
      const data: DamodaranERP = {
        erp: live.erp,
        asOf: live.asOf,
        source: "live",
      };
      erpCache = { fetchedAt: Date.now(), data };
      return data;
    }
  } catch (err) {
    log.warn("dashboard.damodaran", "live ERP fetch failed", errorInfo(err));
  }
  // Fall back to anchor constant. Don't cache the anchor — keep
  // retrying the live fetch on each render so we recover quickly
  // when the upstream comes back.
  return {
    erp: ERP_ANCHOR,
    asOf: ERP_ANCHOR_DATE,
    source: "anchor",
  };
}

/**
 * Fetch the 10y Treasury yield from FRED and convert percent → fraction.
 * Cached 1h. Falls back to the constant on failure so this never
 * throws.
 */
async function getRiskFreeRate(): Promise<number> {
  if (rfCache && Date.now() - rfCache.fetchedAt < RF_TTL_MS) return rfCache.rate;
  try {
    const obs = await getLatestSeriesValue("DGS10");
    if (obs && Number.isFinite(obs.value)) {
      const rate = obs.value / 100;
      rfCache = { fetchedAt: Date.now(), rate };
      return rate;
    }
  } catch (err) {
    log.warn("dashboard.damodaran", "DGS10 fetch failed", errorInfo(err));
  }
  rfCache = { fetchedAt: Date.now(), rate: RISK_FREE_FALLBACK };
  return RISK_FREE_FALLBACK;
}

export interface StockCostOfCapital {
  ticker: string;
  result: CostOfEquityResult;
  /** Spread vs market = COE − (rf + ERP). Positive = priced for higher return than the index. */
  spreadVsMarket: number;
  /** Damodaran market ERP at evaluation time. */
  marketErp: number;
  /** Risk-free rate used. */
  riskFreeRate: number;
  /** Echo of the dividend per share fed in (not yield × price), for callouts. */
  dividendsPerShare: number;
  asOf: string;
}

/**
 * Compute a per-stock implied cost of equity, returning null on any
 * data gap. Pulls the Yahoo snapshot for price / dividendYield /
 * beta, the FRED 10-year for risk-free, and the pinned Damodaran ERP.
 */
export async function getStockImpliedCOE(
  ticker: string,
): Promise<StockCostOfCapital | null> {
  try {
    const [snap, riskFreeRate, erp] = await Promise.all([
      getStockSnapshot(ticker),
      getRiskFreeRate(),
      getDamodaranERP(),
    ]);
    if (!snap || !Number.isFinite(snap.price) || snap.price <= 0) return null;
    // dividendYield from Yahoo is FRACTIONAL (0.025 = 2.5%). Convert
    // to dollars-per-share so the math reads cleanly.
    const dpsRaw =
      snap.dividendYield && Number.isFinite(snap.dividendYield) && snap.dividendYield > 0
        ? snap.dividendYield * snap.price
        : 0;

    const result = impliedCostOfEquity({
      price: snap.price,
      dividendsPerShare: dpsRaw,
      // Yahoo doesn't expose long-term analyst growth on the snapshot
      // we currently load. Use the conservative default until we wire
      // Polygon's earningsGrowth or Finnhub's growth_estimates feed.
      growthRate: DEFAULT_GROWTH,
      riskFreeRate,
      beta: snap.beta && Number.isFinite(snap.beta) ? snap.beta : 1,
      equityRiskPremium: erp.erp,
    });
    if (!result) return null;

    const spreadVsMarket = result.costOfEquity - (riskFreeRate + erp.erp);

    return {
      ticker: ticker.toUpperCase(),
      result,
      spreadVsMarket,
      marketErp: erp.erp,
      riskFreeRate,
      dividendsPerShare: dpsRaw,
      asOf: new Date().toISOString(),
    };
  } catch (err) {
    log.warn("dashboard.damodaran", "getStockImpliedCOE failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

/** Test seam — same convention as the FF loader. */
export function __resetDamodaranCacheForTest(): void {
  rfCache = null;
  erpCache = null;
}
