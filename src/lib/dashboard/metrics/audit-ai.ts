// src/lib/dashboard/metrics/audit-ai.ts
//
// Pure track-record math for the public-facing "Audit Your AI" card.
//
// Inputs:
//   - recommendations:  ordered list of BUY recs (most recent first)
//   - outcomes:         the same list's matching outcome rows
//                       (priceAtRec, priceAtCheck, evaluatedAt, lens)
//   - benchmark:        per-rec SPY start/end prices for alpha calc
//
// Outputs:
//   - totalBuys:               total BUYs that have evaluated outcomes
//   - beatBenchmarkPct:        share whose 30d price return ≥ SPY return
//                              over the same window. 0..1.
//   - pValue:                  one-sided binomial p-value vs random
//                              (probability of seeing this many or more
//                              wins under H0 = 0.5). Lower = stronger
//                              evidence the lens beats coin-flips.
//   - perModelAttribution:     hit-rate per lens (claude / gpt / gemini)
//                              when the verdict can be attributed to a
//                              specific lens. Sparse — null entries for
//                              lenses with no attributable BUYs.
//
// Implementation notes:
//   * "Beat SPY" is defined as the BUY's realized 30d return being
//     greater than or equal to SPY's 30d return over the same window.
//     That's the convention `public-track-record.ts` already uses.
//   * The binomial p-value uses an exact summation up to N=200; for
//     larger N we use a normal approximation. 100 BUYs (the spec's
//     headline) sits comfortably in the exact regime.
//   * Per-model attribution: for each rec, we look at the analyses
//     array — if exactly one lens issued the BUY (the others said
//     HOLD/SELL), credit that lens. If multiple lenses issued BUY,
//     credit each that did. If no lens output is parseable, we skip.
//     This is a coarse but defensible per-lens hit-rate.

export interface OutcomeRecord {
  recommendationId: string;
  /** "BUY" / "HOLD" / "SELL" — what the supervisor returned. */
  recommendation: string;
  priceAtRec: number;
  priceAtCheck: number | null;
  spyStart: number | null;
  spyEnd: number | null;
  /**
   * Per-lens recommendations. Sparse — keys absent when the model
   * output couldn't be parsed.
   */
  perLensRecs?: Partial<Record<"claude" | "gpt" | "gemini", string>>;
}

export type LensId = "claude" | "gpt" | "gemini";

export interface PerLensHitRate {
  /** Number of BUYs evaluable on this lens. */
  evaluated: number;
  /** Hit count: lens-flagged BUYs that beat SPY at 30d. */
  hits: number;
  /** Hit rate. Null when evaluated === 0. */
  hitRate: number | null;
}

export interface TrackRecordResult {
  totalBuys: number;
  beatBenchmarkPct: number;
  /** P-value of (hits ≥ observed | H0=0.5). */
  pValue: number;
  perModelAttribution: Record<LensId, PerLensHitRate>;
  /** Window the math covered, days. */
  windowDays: number;
}

const ZERO_PER_LENS: PerLensHitRate = { evaluated: 0, hits: 0, hitRate: null };

const EMPTY: TrackRecordResult = {
  totalBuys: 0,
  beatBenchmarkPct: 0,
  pValue: 1,
  perModelAttribution: {
    claude: { ...ZERO_PER_LENS },
    gpt: { ...ZERO_PER_LENS },
    gemini: { ...ZERO_PER_LENS },
  },
  windowDays: 30,
};

/** Binomial coefficient C(n, k) with safe-int growth via log-multiplication. */
function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

function logBinomCoef(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/**
 * Probability of observing ≥ `hits` successes in `n` trials at
 * p=0.5 (a fair coin). One-sided test.
 */
function binomialUpperTail(hits: number, n: number): number {
  if (n <= 0) return 1;
  if (hits <= 0) return 1;
  if (hits > n) return 0;
  // Exact for n ≤ 200.
  if (n <= 200) {
    let total = 0;
    for (let k = hits; k <= n; k++) {
      const logProb = logBinomCoef(n, k) + n * Math.log(0.5);
      total += Math.exp(logProb);
    }
    return Math.min(1, Math.max(0, total));
  }
  // Normal approximation with continuity correction.
  const mean = n * 0.5;
  const sd = Math.sqrt(n * 0.5 * 0.5);
  const z = (hits - 0.5 - mean) / sd;
  // Survival = 1 - Φ(z). Use Abramowitz formula.
  return 0.5 * erfc(z / Math.SQRT2);
}

/** Complementary error function — Abramowitz & Stegun 7.1.26 approximation. */
function erfc(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  const erf = sign * y;
  return Math.max(0, Math.min(2, 1 - erf));
}

export interface ComputeTrackRecordInput {
  outcomes: OutcomeRecord[];
  /** Window in days the outcomes were evaluated at (for display). */
  windowDays?: number;
  /** Cap how many of the most recent BUYs we consider. */
  limit?: number;
}

/**
 * Compute the track-record over the given outcome set.
 *
 * The function expects the caller to have already filtered to BUY
 * recs with completed outcomes — we pass through whatever's
 * supplied.
 */
export function computeTrackRecord(
  input: ComputeTrackRecordInput,
): TrackRecordResult {
  const windowDays = input.windowDays ?? 30;
  const limit = input.limit ?? 100;
  const buys = input.outcomes
    .filter(
      (o) =>
        o.recommendation === "BUY" &&
        Number.isFinite(o.priceAtRec) &&
        o.priceAtRec > 0 &&
        o.priceAtCheck !== null &&
        Number.isFinite(o.priceAtCheck),
    )
    .slice(0, limit);

  if (buys.length === 0) return { ...EMPTY, windowDays };

  let hits = 0;
  let benchmarkEvaluable = 0;
  const perLens: Record<LensId, { evaluated: number; hits: number }> = {
    claude: { evaluated: 0, hits: 0 },
    gpt: { evaluated: 0, hits: 0 },
    gemini: { evaluated: 0, hits: 0 },
  };

  for (const o of buys) {
    if (
      o.spyStart === null ||
      o.spyEnd === null ||
      !Number.isFinite(o.spyStart) ||
      !Number.isFinite(o.spyEnd) ||
      o.spyStart <= 0
    ) {
      continue;
    }
    benchmarkEvaluable++;
    const recReturn = (o.priceAtCheck! - o.priceAtRec) / o.priceAtRec;
    const benchReturn = (o.spyEnd - o.spyStart) / o.spyStart;
    const won = recReturn >= benchReturn;
    if (won) hits++;

    if (o.perLensRecs) {
      for (const lens of ["claude", "gpt", "gemini"] as LensId[]) {
        const rec = o.perLensRecs[lens];
        if (rec === "BUY") {
          perLens[lens].evaluated++;
          if (won) perLens[lens].hits++;
        }
      }
    }
  }

  const beatBenchmarkPct = benchmarkEvaluable > 0 ? hits / benchmarkEvaluable : 0;
  const pValue = binomialUpperTail(hits, benchmarkEvaluable);

  const perModelAttribution: Record<LensId, PerLensHitRate> = {
    claude: {
      evaluated: perLens.claude.evaluated,
      hits: perLens.claude.hits,
      hitRate:
        perLens.claude.evaluated > 0
          ? perLens.claude.hits / perLens.claude.evaluated
          : null,
    },
    gpt: {
      evaluated: perLens.gpt.evaluated,
      hits: perLens.gpt.hits,
      hitRate:
        perLens.gpt.evaluated > 0 ? perLens.gpt.hits / perLens.gpt.evaluated : null,
    },
    gemini: {
      evaluated: perLens.gemini.evaluated,
      hits: perLens.gemini.hits,
      hitRate:
        perLens.gemini.evaluated > 0
          ? perLens.gemini.hits / perLens.gemini.evaluated
          : null,
    },
  };

  return {
    totalBuys: benchmarkEvaluable,
    beatBenchmarkPct,
    pValue,
    perModelAttribution,
    windowDays,
  };
}
