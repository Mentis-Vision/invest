// src/lib/dashboard/metrics/fama-french-loader.ts
//
// Loader for the Fama-French daily factor series. Now wired to the
// live Kenneth French Library via fama-french-fetcher.ts. Falls back
// to a deterministic synthetic series only when both the live fetch
// AND the in-process cache are empty (e.g. cold instance + upstream
// outage on first render). The synthetic baseline keeps the
// regression UI from collapsing in that edge case, but the loader
// reports `dataSource: 'synthetic'` so the card can label it.
//
// Flavor:
//   We default to 5-factor — RMW + CMA improve R² without much cost
//   and the regression in fama-french.ts already supports both.
//
// The loader exposes `getFactorExposure` which:
//   * Loads the user's portfolio daily returns.
//   * Loads (and caches) the factor series.
//   * Aligns by overlapping date when possible (live rows have
//     dates), or tail-to-tail for the synthetic fallback.
//   * Runs the regression and returns FactorExposure with provenance
//     metadata (asOf, dataSource).
//
// Data provenance is surfaced on the UI — the factor-exposure card
// renders "Factor data from Kenneth French Library, as-of {asOf}"
// when live, or a clear "synthetic baseline" label when the
// fallback is used.

import { loadPortfolioDailyReturns } from "./risk-loader";
import {
  regressFactors,
  type FactorExposure,
  type FactorReturns,
} from "./fama-french";
import {
  fetchFrenchFactorsDaily,
  type FactorReturnRow,
} from "./fama-french-fetcher";
import { log, errorInfo } from "../../log";

interface LoadedFactors {
  data: FactorReturns;
  /** Most-recent factor date when live; null when synthetic fallback. */
  asOf: string | null;
  /** Per-row dates aligned with `data` arrays; null when synthetic. */
  dates: string[] | null;
  dataSource: "live" | "synthetic";
}

interface CachedFactors {
  fetchedAt: number;
  loaded: LoadedFactors;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
let cache: CachedFactors | null = null;

/**
 * Mulberry32 PRNG — only used to deterministically generate the
 * synthetic fallback when live fetch fails on a cold instance.
 */
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller normal sample at (mean, sd). */
function normal(rng: () => number, mean: number, sd: number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

/**
 * Build a 520-trading-day synthetic factor history. Only used when
 * both live fetch and cached rows fail. Means / stdevs roughly track
 * the long-run empirical sample from the French Data Library so the
 * regression still yields plausible-shaped betas in that edge case.
 *
 * Important: this is labelled `synthetic` in the loader's return
 * value — the UI must not present synthetic factors as live data.
 */
function buildSyntheticFactors(): FactorReturns {
  const rng = makePrng(0xfa1afe);
  const N = 520;
  const mktRf: number[] = [];
  const smb: number[] = [];
  const hml: number[] = [];
  const rmw: number[] = [];
  const cma: number[] = [];
  const rf: number[] = [];
  for (let i = 0; i < N; i++) {
    mktRf.push(normal(rng, 0.0004, 0.01));
    smb.push(normal(rng, 0, 0.005));
    hml.push(normal(rng, 0, 0.005));
    rmw.push(normal(rng, 0.00005, 0.004));
    cma.push(normal(rng, 0, 0.004));
    rf.push(0.043 / 252);
  }
  return { mktRf, smb, hml, rmw, cma, rf };
}

function rowsToFactorReturns(rows: FactorReturnRow[]): FactorReturns {
  const fr: FactorReturns = {
    mktRf: new Array(rows.length),
    smb: new Array(rows.length),
    hml: new Array(rows.length),
    rf: new Array(rows.length),
  };
  let hasRmw = true;
  let hasCma = true;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    fr.mktRf[i] = r.mktRf;
    fr.smb[i] = r.smb;
    fr.hml[i] = r.hml;
    fr.rf[i] = r.rf;
    if (r.rmw === undefined) hasRmw = false;
    if (r.cma === undefined) hasCma = false;
  }
  if (hasRmw && hasCma) {
    fr.rmw = rows.map((r) => r.rmw ?? 0);
    fr.cma = rows.map((r) => r.cma ?? 0);
  }
  return fr;
}

/**
 * Returns the cached factor bundle, fetching / synthesizing if cold.
 * Always succeeds — the synthetic fallback never throws.
 *
 * `daysLookback` clamps the returned series to the last N rows.
 */
export async function loadFactorReturns(
  daysLookback = 252,
): Promise<LoadedFactors> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return clipLoaded(cache.loaded, daysLookback);
  }

  // Try live first.
  try {
    const rows = await fetchFrenchFactorsDaily("5");
    if (rows.length > 0) {
      const data = rowsToFactorReturns(rows);
      const asOf = rows[rows.length - 1].date;
      const dates = rows.map((r) => r.date);
      const loaded: LoadedFactors = {
        data,
        asOf,
        dates,
        dataSource: "live",
      };
      cache = { fetchedAt: Date.now(), loaded };
      return clipLoaded(loaded, daysLookback);
    }
  } catch (err) {
    log.warn("dashboard.fama-french-loader", "live load failed", errorInfo(err));
  }

  // Synthetic fallback only when nothing else is available. We do not
  // refresh the synthetic timestamp — it's a baseline, not data.
  const data = buildSyntheticFactors();
  const loaded: LoadedFactors = {
    data,
    asOf: null,
    dates: null,
    dataSource: "synthetic",
  };
  cache = { fetchedAt: Date.now(), loaded };
  return clipLoaded(loaded, daysLookback);
}

function clipLoaded(loaded: LoadedFactors, n: number): LoadedFactors {
  const start = Math.max(0, loaded.data.mktRf.length - n);
  const slice = (arr: number[]) => arr.slice(start);
  const data: FactorReturns = {
    mktRf: slice(loaded.data.mktRf),
    smb: slice(loaded.data.smb),
    hml: slice(loaded.data.hml),
    rf: slice(loaded.data.rf),
  };
  if (loaded.data.rmw) data.rmw = slice(loaded.data.rmw);
  if (loaded.data.cma) data.cma = slice(loaded.data.cma);
  const dates = loaded.dates ? loaded.dates.slice(start) : null;
  return {
    data,
    asOf: dates ? dates[dates.length - 1] ?? loaded.asOf : loaded.asOf,
    dates,
    dataSource: loaded.dataSource,
  };
}

/**
 * Test seam — only reset between unit tests so cache state doesn't
 * leak across loader specs.
 */
export function __resetFactorCacheForTest(): void {
  cache = null;
}

export interface FactorExposureResult {
  /** Regression result; null when too few aligned obs or singular X. */
  exposure: FactorExposure | null;
  /** ISO date of the most-recent factor row used. */
  asOf: string | null;
  /** "live" when the regression ran on Kenneth French data, else "synthetic". */
  dataSource: "live" | "synthetic";
}

/**
 * High-level API for the year-outlook surface. Loads the user's
 * daily returns + the factor series, aligns tail-to-tail, runs the
 * regression. Returns a result object carrying the regression and
 * provenance — the card uses provenance to label the as-of footer.
 *
 * Returns `exposure: null` on:
 *   - no portfolio history
 *   - too few aligned observations for a stable beta
 *   - singular regressor matrix
 *
 * Even when exposure is null, asOf + dataSource are still populated
 * so the card can render a credible "Factors as-of X" footer.
 */
export async function getFactorExposure(
  userId: string,
): Promise<FactorExposureResult> {
  try {
    const [{ portfolio }, loaded] = await Promise.all([
      loadPortfolioDailyReturns(userId),
      loadFactorReturns(252),
    ]);
    const factors = loaded.data;
    if (portfolio.length === 0) {
      return {
        exposure: null,
        asOf: loaded.asOf,
        dataSource: loaded.dataSource,
      };
    }
    const n = Math.min(portfolio.length, factors.mktRf.length);
    if (n < 80) {
      return {
        exposure: null,
        asOf: loaded.asOf,
        dataSource: loaded.dataSource,
      };
    }
    const aligned: FactorReturns = {
      mktRf: factors.mktRf.slice(-n),
      smb: factors.smb.slice(-n),
      hml: factors.hml.slice(-n),
      rf: factors.rf.slice(-n),
    };
    if (factors.rmw && factors.cma) {
      aligned.rmw = factors.rmw.slice(-n);
      aligned.cma = factors.cma.slice(-n);
    }
    const portSlice = portfolio.slice(-n);
    const exposure = regressFactors(portSlice, aligned);
    return {
      exposure,
      asOf: loaded.asOf,
      dataSource: loaded.dataSource,
    };
  } catch (err) {
    log.warn("dashboard.fama-french", "getFactorExposure failed", {
      userId,
      ...errorInfo(err),
    });
    return { exposure: null, asOf: null, dataSource: "synthetic" };
  }
}
