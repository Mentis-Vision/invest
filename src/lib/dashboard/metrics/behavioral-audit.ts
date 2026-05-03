// src/lib/dashboard/metrics/behavioral-audit.ts
//
// Phase 4 Batch K4 — measurable behavioral self-audit metrics.
//
// Three signals the typical retail investor blind-spots:
//
//   1. Home bias — share of equity exposure in US-listed names. The
//      US is roughly 60% of global market cap, so allocations
//      meaningfully above that are a measurable home bias rather
//      than a deliberate factor tilt.
//
//   2. Concentration drift — top-3-sector weight over time. When a
//      user keeps adding to winners, the top-3 weight creeps upward
//      without an explicit rebalance decision. We compare the latest
//      portfolio_snapshot against ~12 months of history.
//
//   3. Recency-chase counter — how many of the user's last N
//      recommendations / actions targeted YTD-winners. High counts
//      indicate the user is buying recent strength rather than
//      diversifying.
//
// Pure module — every helper takes plain inputs and returns plain
// outputs. The loader piece (behavioral-audit-loader.ts) handles
// the SQL fetches and feeds these helpers.

export const US_GLOBAL_MARKET_CAP_WEIGHT = 0.60; // ~60% of MSCI ACWI

export interface HoldingPosition {
  ticker: string;
  weight: number; // 0–1 fractional of total
  sector?: string | null;
  /**
   * True when the ticker is US-exchange-listed. Tickers without a
   * suffix (NASDAQ/NYSE) are US-listed; tickers with `.TO`, `.L`,
   * `.HK`, etc. are foreign. The loader sets this; pure detection
   * happens in `isUsListed` below.
   */
  isUs?: boolean;
}

/**
 * Heuristic: detect whether a Yahoo-style ticker is US-listed. US
 * exchanges (NASDAQ, NYSE, AMEX) use bare symbols without a suffix.
 * Foreign exchanges use suffixes like `.TO` (Toronto), `.L` (London),
 * `.HK` (Hong Kong), `.AX` (ASX), `.PA` (Paris), etc.
 *
 * Crypto symbols (BTC-USD, ETH-USD) are treated as non-US for this
 * audit — they're not equity, not in the home-bias baseline.
 */
export function isUsListed(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  if (t.length === 0) return false;
  // Crypto: contains "-USD" suffix.
  if (t.includes("-USD")) return false;
  // Foreign suffix: any ticker with a `.` followed by 1-3 letters.
  if (/\.[A-Z]{1,3}$/.test(t)) return false;
  return true;
}

export type HomeBiasLevel = "neutral" | "moderate" | "extreme";

export interface HomeBiasReading {
  /** US-listed share of equity exposure (0–1). */
  usShare: number;
  /** Reference baseline (US share of global market cap). */
  baseline: number;
  /** Deviation from baseline in percentage points (positive = home bias). */
  deltaPp: number;
  /** Coarse level. */
  level: HomeBiasLevel;
}

/**
 * Compute home-bias reading from a list of holding positions. Pure.
 *
 * Levels (delta pp above baseline):
 *   < +10pp     neutral
 *   +10 to +30  moderate
 *   > +30pp     extreme
 *
 * Returns null when the portfolio has zero equity weight (e.g. all
 * cash) — there's no denominator.
 */
export function computeHomeBias(
  positions: HoldingPosition[],
  baseline: number = US_GLOBAL_MARKET_CAP_WEIGHT,
): HomeBiasReading | null {
  if (positions.length === 0) return null;
  const totalWeight = positions.reduce(
    (acc, p) => acc + (Number.isFinite(p.weight) ? p.weight : 0),
    0,
  );
  if (totalWeight <= 0) return null;
  const usWeight = positions
    .filter((p) => p.isUs ?? isUsListed(p.ticker))
    .reduce((acc, p) => acc + (Number.isFinite(p.weight) ? p.weight : 0), 0);
  const usShare = usWeight / totalWeight;
  const deltaPp = (usShare - baseline) * 100;
  let level: HomeBiasLevel;
  if (deltaPp > 30) level = "extreme";
  else if (deltaPp > 10) level = "moderate";
  else level = "neutral";
  return {
    usShare: Math.round(usShare * 1000) / 1000,
    baseline,
    deltaPp: Math.round(deltaPp * 10) / 10,
    level,
  };
}

export interface SectorWeightSnapshot {
  /** ISO date the snapshot was captured. */
  capturedAt: string;
  /** Sector → weight (0–1 fraction of equity). */
  weights: Record<string, number>;
}

export type ConcentrationTrend = "rising" | "stable" | "falling";

export interface ConcentrationDriftReading {
  /** Latest top-3 sector combined weight (0–1). */
  currentTop3: number;
  /** Earliest top-3 sector combined weight in the window. */
  priorTop3: number;
  /** Change in pp (positive = concentration rising). */
  deltaPp: number;
  /** Coarse trend. */
  trend: ConcentrationTrend;
  /** The three sectors driving the latest top-3 reading. */
  topSectors: string[];
}

/**
 * Sum the three largest sector weights in a snapshot. Returns 0 +
 * empty array when the snapshot has no sectors.
 */
function topThreeWeight(weights: Record<string, number>): {
  total: number;
  sectors: string[];
} {
  const entries = Object.entries(weights)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1]);
  const top3 = entries.slice(0, 3);
  const total = top3.reduce((acc, [, v]) => acc + v, 0);
  return { total, sectors: top3.map(([s]) => s) };
}

/**
 * Compute the concentration-drift reading from a series of sector
 * snapshots. Compares the earliest snapshot in the window to the
 * latest. Pure.
 *
 * Trend bands:
 *   delta > +5pp    rising
 *   delta < -5pp    falling
 *   else            stable
 *
 * Returns null when fewer than 2 snapshots are supplied.
 */
export function computeConcentrationDrift(
  snapshots: SectorWeightSnapshot[],
): ConcentrationDriftReading | null {
  if (snapshots.length < 2) return null;
  const sorted = snapshots
    .slice()
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  const earliestTop3 = topThreeWeight(earliest.weights);
  const latestTop3 = topThreeWeight(latest.weights);
  if (earliestTop3.total === 0 || latestTop3.total === 0) return null;
  const deltaPp = (latestTop3.total - earliestTop3.total) * 100;
  let trend: ConcentrationTrend;
  if (deltaPp > 5) trend = "rising";
  else if (deltaPp < -5) trend = "falling";
  else trend = "stable";
  return {
    currentTop3: Math.round(latestTop3.total * 1000) / 1000,
    priorTop3: Math.round(earliestTop3.total * 1000) / 1000,
    deltaPp: Math.round(deltaPp * 10) / 10,
    trend,
    topSectors: latestTop3.sectors,
  };
}

export interface RecentRecommendation {
  /** Ticker of the recommendation. */
  ticker: string;
  /** Action (BUY / HOLD / SELL); we only count BUYs / ADDs as "chases". */
  recommendation: string;
  /** YTD return at the time of the recommendation, fractional. */
  ytdReturnAtTime: number | null;
}

export type RecencyChaseLevel = "low" | "moderate" | "high";

export interface RecencyChaseReading {
  /** Number of "chase" recommendations (BUY into a YTD-winner). */
  chaseCount: number;
  /** Total recommendations evaluated. */
  totalCount: number;
  /** Chase fraction (0–1). */
  chaseRate: number;
  /** Coarse level. */
  level: RecencyChaseLevel;
}

const CHASE_THRESHOLD_YTD = 0.10; // YTD ≥ 10% = "winner"

/**
 * Counts how many of the user's recent recommendations BUY into
 * tickers that were already YTD winners (>= 10% YTD at recommendation
 * time). Pure.
 *
 * Levels:
 *   chaseRate >= 0.6   high
 *   chaseRate >= 0.3   moderate
 *   else               low
 *
 * Returns null when fewer than 3 recommendations have a usable YTD
 * reading (sample too small to draw a conclusion).
 */
export function computeRecencyChase(
  recommendations: RecentRecommendation[],
): RecencyChaseReading | null {
  const usable = recommendations.filter(
    (r) => r.ytdReturnAtTime !== null && Number.isFinite(r.ytdReturnAtTime),
  );
  if (usable.length < 3) return null;
  const buys = usable.filter((r) => /^(BUY|ADD|STRONG_BUY)$/i.test(r.recommendation));
  if (buys.length === 0) return null;
  const chases = buys.filter(
    (r) => (r.ytdReturnAtTime ?? 0) >= CHASE_THRESHOLD_YTD,
  );
  const chaseRate = chases.length / buys.length;
  let level: RecencyChaseLevel;
  if (chaseRate >= 0.6) level = "high";
  else if (chaseRate >= 0.3) level = "moderate";
  else level = "low";
  return {
    chaseCount: chases.length,
    totalCount: buys.length,
    chaseRate: Math.round(chaseRate * 100) / 100,
    level,
  };
}

export interface BehavioralAudit {
  homeBias: HomeBiasReading | null;
  concentrationDrift: ConcentrationDriftReading | null;
  recencyChase: RecencyChaseReading | null;
}
