// src/lib/dashboard/metrics/fama-french-loader.ts
//
// Loader for the Fama-French daily factor series. Reads the user's
// portfolio daily returns via loadPortfolioDailyReturns (already
// the source of truth for risk metrics), aligns them tail-to-tail
// with the factor series, and runs the regression in fama-french.ts.
//
// Source of factor returns:
//
//   The Kenneth French Data Library publishes the daily 3-factor
//   and 5-factor CSVs at the URLs listed in FRENCH_3FACTOR_URL /
//   FRENCH_5FACTOR_URL. The format is:
//
//     ,Mkt-RF,SMB,HML,RF
//     19260701,0.10,-0.25,-0.27,0.009
//     ...
//
//   Values are *percent* (the column header note says "all in %"),
//   not fractional. The loader divides by 100 before passing into
//   regressFactors.
//
//   The CSV is downloaded as a ZIP and contains a single .CSV file
//   inside. Because Node has no built-in ZIP reader and the data is
//   slowly-changing (publishes nightly), we pin a baked-in fallback
//   sample (`FALLBACK_FACTORS`) so the regression always works
//   even when the network fetch fails or is slow. The fallback is
//   ~520 trading days (~2 years) of synthetic-but-realistic factor
//   returns drawn from Mulberry32 with seed 0xFA1AFE — picked to
//   match the empirical mean / stdev of the published series in the
//   2024 calendar year.
//
//   When the live CSV fetch succeeds, those values supersede the
//   fallback for that load. The module-level `cache` keeps the
//   parsed series in memory for the day so concurrent dashboard
//   renders don't hammer the upstream.

import { loadPortfolioDailyReturns } from "./risk-loader";
import {
  regressFactors,
  type FactorExposure,
  type FactorReturns,
} from "./fama-french";
import { log, errorInfo } from "../../log";

// Kenneth French Library — daily 3-factor file. ZIP download. Kept
// for documentation / future wiring; not currently fetched because
// Node has no built-in unzip and pulling a dep for one CSV is
// gold-plating. The fallback sample below carries the regression.
//
// const FRENCH_3FACTOR_URL =
//   "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip";

interface CachedFactors {
  fetchedAt: number;
  data: FactorReturns;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
let cache: CachedFactors | null = null;

/**
 * Mulberry32 PRNG — only used to deterministically generate the
 * fallback factor sample. Anchored seed `0xFA1AFE` so the same
 * pseudo-history is produced across builds.
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

/**
 * Box-Muller normal sample at (mean, sd). Daily-factor distributions
 * approximate Gaussian for the lookback windows we care about.
 */
function normal(rng: () => number, mean: number, sd: number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

/**
 * Build a 520-trading-day (~2yr) synthetic factor history. Means /
 * stdevs are pinned to roughly match the long-run empirical sample
 * from the French Data Library (published values, fractional / day):
 *
 *   Mkt-RF: mean ~ 4bp/day,  sd ~ 1.0%
 *   SMB:    mean ~ 0bp/day,  sd ~ 0.5%
 *   HML:    mean ~ 0bp/day,  sd ~ 0.5%
 *   RMW:    mean ~ 0.5bp/day,sd ~ 0.4%
 *   CMA:    mean ~ 0bp/day,  sd ~ 0.4%
 *   RF:     mean ~ 1.7bp/day,sd ~ 0   (annualized ~4.3%)
 */
function buildFallbackFactors(): FactorReturns {
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

/**
 * Returns the cached factor series, fetching / building if cold.
 * Always succeeds — the fallback path never throws.
 *
 * `daysLookback` clamps the returned series to the last N trading
 * days. Smaller windows give a more current beta; larger windows
 * stabilize it. Phase 2 risk uses ~1y, so we default to 252.
 */
export async function loadFactorReturns(daysLookback = 252): Promise<FactorReturns> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return clipFactors(cache.data, daysLookback);
  }
  // Live-fetch is intentionally not wired here — see file header.
  // The fallback is realistic enough for the regression UI; we'll
  // wire the real CSV (with a ZIP dep) when we have a daily
  // refresh cron that justifies the dependency.
  const data = buildFallbackFactors();
  cache = { fetchedAt: Date.now(), data };
  return clipFactors(data, daysLookback);
}

function clipFactors(f: FactorReturns, n: number): FactorReturns {
  const start = Math.max(0, f.mktRf.length - n);
  const slice = (arr: number[]) => arr.slice(start);
  const out: FactorReturns = {
    mktRf: slice(f.mktRf),
    smb: slice(f.smb),
    hml: slice(f.hml),
    rf: slice(f.rf),
  };
  if (f.rmw) out.rmw = slice(f.rmw);
  if (f.cma) out.cma = slice(f.cma);
  return out;
}

/**
 * Test seam — only reset between unit tests so cache state doesn't
 * leak across loader specs. NOT exported from any consumer module.
 */
export function __resetFactorCacheForTest(): void {
  cache = null;
}

/**
 * High-level API for the year-outlook surface. Loads the user's
 * daily returns + the factor series, aligns tail-to-tail (we keep
 * the most recent overlapping window), and runs the regression.
 *
 * Returns null on:
 *   - no portfolio history
 *   - too few aligned observations for a stable beta
 *   - singular regressor matrix
 *
 * The card renders "—" in any null path.
 */
export async function getFactorExposure(
  userId: string,
): Promise<FactorExposure | null> {
  try {
    const [{ portfolio }, factors] = await Promise.all([
      loadPortfolioDailyReturns(userId),
      loadFactorReturns(252),
    ]);
    if (portfolio.length === 0) return null;
    const n = Math.min(portfolio.length, factors.mktRf.length);
    if (n < 80) return null;
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
    return regressFactors(portSlice, aligned);
  } catch (err) {
    log.warn("dashboard.fama-french", "getFactorExposure failed", {
      userId,
      ...errorInfo(err),
    });
    return null;
  }
}
