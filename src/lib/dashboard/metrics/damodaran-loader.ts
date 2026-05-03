// src/lib/dashboard/metrics/damodaran-loader.ts
//
// Bridges the pure cost-of-capital math in damodaran.ts with the
// repo's existing data sources:
//
//   - Damodaran's market-level implied ERP (NYU Stern, monthly):
//     getDamodaranERP() returns the latest figure. We pin a monthly
//     anchor constant that we update each quarter — Damodaran's
//     histimpl.html is HTML-scrape territory and isn't a stable
//     wire to depend on for an on-render call.
//   - The risk-free rate from FRED (DGS10).
//   - Per-stock COE inputs from the existing yahoo snapshot
//     (price, dividend yield, beta).
//   - Forward growth from Yahoo's analyst growth estimate when
//     available, capped to a sensible range.

import { getStockSnapshot } from "../../data/yahoo";
import { getLatestSeriesValue } from "../../data/fred";
import { impliedCostOfEquity, type CostOfEquityResult } from "./damodaran";
import { log, errorInfo } from "../../log";

// Damodaran "histimpl.html" — manually pinned monthly anchor. As of
// publication on 2026-01-01 the implied ERP for the S&P 500 read
// 4.33%. Refresh this constant each quarter from the published
// histimpl table; the file header explains the choice not to
// scrape the live HTML.
//
// Source: Aswath Damodaran, NYU Stern School of Business,
// "Implied Equity Risk Premia" — pages.stern.nyu.edu/~adamodar/
const ERP_ANCHOR = 0.0433;
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
  /** Whether this was the pinned anchor or a future live source. */
  source: "anchor" | "live";
}

export function getDamodaranERP(): DamodaranERP {
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
    const [snap, riskFreeRate] = await Promise.all([
      getStockSnapshot(ticker),
      getRiskFreeRate(),
    ]);
    if (!snap || !Number.isFinite(snap.price) || snap.price <= 0) return null;

    const erp = getDamodaranERP();
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
}
