// src/lib/dashboard/metrics/monte-carlo.ts
//
// Bootstrap Monte-Carlo simulation of a portfolio against the user's
// retirement / target-wealth goal.
//
// Method:
//   For each of `paths` (default 10,000) trials, draw `yearsRemaining
//   * 252` daily returns with replacement from `returnsHistory` and
//   roll the portfolio forward day-by-day. Every 21st trading day a
//   monthly contribution is added (assumes ~21 business days / mo).
//   The terminal value of each path is recorded; success-probability
//   is the fraction of paths whose terminal value ≥ target.
//
// Outputs:
//   - successProbability: 0..1
//   - percentiles: p10 / p25 / p50 / p75 / p90 of terminal values
//   - paths: optional — only the p10/p50/p90 paths kept for the fan
//     chart, downsampled to weekly cadence to keep the wire payload
//     small (~52 points/year). Skipped when `keepPaths` is false.
//
// Determinism:
//   Accepts a `seed` param. When set, the PRNG is Mulberry32 seeded
//   from the integer; otherwise we wrap Math.random. Seeded mode
//   makes the unit tests stable; production runs leave seed
//   undefined so the user sees the natural distribution.
//
// Failure / null behavior:
//   This module is pure — it never returns null. The caller decides
//   whether `returnsHistory` is large enough to meaningfully
//   bootstrap (we recommend ≥50 samples). If `paths` or
//   `yearsRemaining` are non-positive, the loop runs zero times and
//   we return an empty result with successProbability = 0.

const TRADING_DAYS_PER_YEAR = 252;
const TRADING_DAYS_PER_MONTH = 21;
/** Coarse weekly cadence for fan-chart downsampling. */
const FAN_CHART_STEP = 5;

export interface MonteCarloInput {
  /** Starting portfolio value, dollars. */
  currentValue: number;
  /** Monthly contribution, dollars. Applied every 21 trading days. */
  monthlyContribution: number;
  /** Target wealth at the goal date, dollars. */
  targetValue: number;
  /** Years from now to the goal date. Fractional OK. */
  yearsRemaining: number;
  /**
   * Daily return history (fractional, 0.01 = +1%) to bootstrap from.
   * Pass the user's realized portfolio returns (preferred) or a
   * benchmark series. Caller decides which.
   */
  returnsHistory: number[];
  /** Number of MC paths. Default 10,000. */
  paths?: number;
  /** PRNG seed for deterministic runs. Optional. */
  seed?: number;
  /** Keep p10/p50/p90 paths for the fan chart. Default true. */
  keepPaths?: boolean;
}

export interface MonteCarloPercentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MonteCarloPath {
  /** Trading-day index (0 = today). */
  day: number;
  /** Portfolio value, dollars. */
  value: number;
}

export interface MonteCarloResult {
  /** Probability of finishing at or above target. 0..1. */
  successProbability: number;
  /** Terminal-value distribution percentiles. */
  percentiles: MonteCarloPercentiles;
  /** p10 / p50 / p90 paths (downsampled), for the fan chart. */
  paths: {
    p10: MonteCarloPath[];
    p50: MonteCarloPath[];
    p90: MonteCarloPath[];
  } | null;
  /** Echoed for downstream rendering. */
  meta: {
    paths: number;
    yearsRemaining: number;
    sampleSize: number;
  };
}

const EMPTY_RESULT: MonteCarloResult = {
  successProbability: 0,
  percentiles: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
  paths: null,
  meta: { paths: 0, yearsRemaining: 0, sampleSize: 0 },
};

/**
 * Mulberry32 — small, fast, deterministic PRNG. Sufficient quality
 * for MC bootstrapping; we don't need crypto-grade.
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

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(q * (sorted.length - 1))),
  );
  return sorted[idx];
}

/**
 * Run the Monte-Carlo simulation.
 *
 * Implementation note: rather than storing every path's full daily
 * series (10k paths × ~7,500 days = ~75M floats), we only keep the
 * terminal value of each path AND a small set of "candidate" paths
 * we sample to be the fan-chart representatives. We then re-sort
 * those candidates by terminal value and pick the p10 / p50 / p90.
 * The candidate count caps memory at FAN_CANDIDATES * days * 8 bytes.
 */
export function runSimulation(input: MonteCarloInput): MonteCarloResult {
  const {
    currentValue,
    monthlyContribution,
    targetValue,
    yearsRemaining,
    returnsHistory,
    paths = 10000,
    seed,
    keepPaths = true,
  } = input;

  if (
    !Number.isFinite(currentValue) ||
    !Number.isFinite(monthlyContribution) ||
    !Number.isFinite(targetValue) ||
    !Number.isFinite(yearsRemaining) ||
    yearsRemaining <= 0 ||
    paths <= 0 ||
    returnsHistory.length === 0
  ) {
    return EMPTY_RESULT;
  }

  const days = Math.max(1, Math.round(yearsRemaining * TRADING_DAYS_PER_YEAR));
  const sample = returnsHistory.filter((r) => Number.isFinite(r));
  if (sample.length === 0) return EMPTY_RESULT;

  const rng = seed !== undefined ? makePrng(seed) : Math.random;

  // Pick a small number of candidate paths to keep their full series.
  const FAN_CANDIDATES = Math.min(200, paths);
  const candidateStride = Math.max(1, Math.floor(paths / FAN_CANDIDATES));
  const candidateTrace: number[][] = []; // path index → trace array
  const candidateTerminal: { idx: number; terminal: number }[] = [];

  const terminals: number[] = new Array(paths);
  let successes = 0;

  for (let p = 0; p < paths; p++) {
    let value = currentValue;
    const isCandidate = p % candidateStride === 0 && candidateTrace.length < FAN_CANDIDATES;
    const trace: number[] | null = isCandidate ? new Array(days + 1) : null;
    if (trace) trace[0] = value;

    for (let d = 1; d <= days; d++) {
      const r = sample[Math.floor(rng() * sample.length)];
      value *= 1 + r;
      if (d % TRADING_DAYS_PER_MONTH === 0) value += monthlyContribution;
      if (trace) trace[d] = value;
    }

    terminals[p] = value;
    if (value >= targetValue) successes++;
    if (trace) {
      candidateTrace.push(trace);
      candidateTerminal.push({ idx: candidateTrace.length - 1, terminal: value });
    }
  }

  const sorted = terminals.slice().sort((a, b) => a - b);
  const percentiles: MonteCarloPercentiles = {
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
  };

  let pathsOut: MonteCarloResult["paths"] = null;
  if (keepPaths && candidateTerminal.length >= 3) {
    const sortedCandidates = candidateTerminal
      .slice()
      .sort((a, b) => a.terminal - b.terminal);
    const pickAt = (q: number) => {
      const idx = Math.min(
        sortedCandidates.length - 1,
        Math.max(0, Math.floor(q * (sortedCandidates.length - 1))),
      );
      return sortedCandidates[idx].idx;
    };
    const downsample = (trace: number[]): MonteCarloPath[] => {
      const out: MonteCarloPath[] = [];
      for (let d = 0; d < trace.length; d += FAN_CHART_STEP) {
        out.push({ day: d, value: trace[d] });
      }
      // Always include final point.
      const last = trace.length - 1;
      if (out.length === 0 || out[out.length - 1].day !== last) {
        out.push({ day: last, value: trace[last] });
      }
      return out;
    };
    pathsOut = {
      p10: downsample(candidateTrace[pickAt(0.1)]),
      p50: downsample(candidateTrace[pickAt(0.5)]),
      p90: downsample(candidateTrace[pickAt(0.9)]),
    };
  }

  return {
    successProbability: successes / paths,
    percentiles,
    paths: pathsOut,
    meta: {
      paths,
      yearsRemaining,
      sampleSize: sample.length,
    },
  };
}
