// src/lib/dashboard/metrics/regime.ts
//
// Pure math + classification logic for the Phase 2 Market Regime
// composite. Combines a small set of "is the tape under stress?"
// signals into a single label that the dashboard renders as a
// context tile.
//
// Design notes:
//   * Every input is `number | null` — the loader graceully fills in
//     the signals it can fetch and passes null for the rest. The
//     classifier ignores nulls in its accumulator, so a partial
//     signal set still produces a meaningful label rather than
//     collapsing to NEUTRAL just because (say) put/call data isn't
//     wired.
//   * The accumulator is a small integer rather than a probability:
//     the dashboard surfaces a 4-bucket label, not a continuous
//     score, and the integer ladder makes the thresholds easy to
//     reason about and easy to test.
//   * `reasons` is the same length-N list of human-readable strings
//     that drove the score — the tile renders these as sub-rows so
//     the user can see *why* the regime is what it is.
//
// FOMC calendar: hardcoded in this module because no first-class
// public free API exposes the dates. Update annually from
// federalreserve.gov/monetarypolicy/fomccalendars.htm. Each entry
// is the *second* day of the two-day meeting (the rate-decision
// announcement); we add a 14:00 ET marker so "today" still counts
// for tiles rendered earlier in the day on FOMC day itself.

export type RegimeLabel = "RISK_ON" | "NEUTRAL" | "FRAGILE" | "STRESS";

export interface RegimeSignals {
  /** Latest VIXCLS close. null when FRED is unavailable. */
  vixLevel: number | null;
  /**
   * Term-structure ratio = VIX9D / VIXCLS. < 1 = contango (calm),
   * > 1 = backwardation (stress). null when either leg is missing.
   */
  vixTermRatio: number | null;
  /**
   * Days until the next FOMC announcement. 0 = today is FOMC day.
   * 999 = no future date in the hardcoded calendar (sentinel; the
   * classifier ignores it via the > 0 / <= 3 guard).
   */
  daysToFOMC: number;
  /**
   * Equity put/call ratio. > 1.0 = puts dominate (defensive),
   * < 0.7 = call-heavy (greed). null when no data source is wired.
   */
  putCallRatio: number | null;
}

export interface RegimeClassification {
  label: RegimeLabel;
  reasons: string[];
}

/**
 * Classify the market regime from a bag of signals. Pure function;
 * no I/O. The accumulator semantics:
 *
 *   stress >= 4   STRESS    (multiple risk-off signals stacking)
 *   stress >= 2   FRAGILE   (one strong signal or two weak ones)
 *   stress >= -1  NEUTRAL   (default / mixed)
 *   else          RISK_ON   (clear risk-on tape)
 *
 * The choice of integer weights mirrors the spec — VIX backwardation
 * is the strongest single tell (+2) because it implies the front of
 * the term curve is pricing more vol than the back, which only
 * happens in genuine drawdowns.
 */
export function classifyRegime(
  signals: RegimeSignals,
): RegimeClassification {
  const reasons: string[] = [];
  let stress = 0;

  // VIX term structure (strongest single signal).
  if (signals.vixTermRatio !== null && Number.isFinite(signals.vixTermRatio)) {
    if (signals.vixTermRatio > 1.05) {
      stress += 2;
      reasons.push(
        `VIX backwardation ${signals.vixTermRatio.toFixed(2)}`,
      );
    } else if (signals.vixTermRatio < 0.92) {
      stress -= 1;
      reasons.push(
        `Steep contango ${signals.vixTermRatio.toFixed(2)}`,
      );
    }
  }

  // VIX absolute level — coarser but always available when FRED works.
  if (signals.vixLevel !== null && Number.isFinite(signals.vixLevel)) {
    if (signals.vixLevel > 30) {
      stress += 2;
      reasons.push(`VIX ${signals.vixLevel.toFixed(1)}`);
    } else if (signals.vixLevel > 20) {
      stress += 1;
      reasons.push(`VIX elevated ${signals.vixLevel.toFixed(1)}`);
    } else if (signals.vixLevel < 12) {
      stress -= 1;
      reasons.push(`VIX subdued ${signals.vixLevel.toFixed(1)}`);
    }
  }

  // FOMC proximity — the 3-day window around an announcement is when
  // headline-driven moves dominate fundamentals.
  if (signals.daysToFOMC >= 0 && signals.daysToFOMC <= 3) {
    stress += 1;
    reasons.push(`FOMC in ${signals.daysToFOMC}d`);
  }

  // Put/call ratio — only contributes when wired.
  if (signals.putCallRatio !== null && Number.isFinite(signals.putCallRatio)) {
    if (signals.putCallRatio > 1.2) {
      stress += 1;
      reasons.push(`P/C ratio ${signals.putCallRatio.toFixed(2)}`);
    } else if (signals.putCallRatio < 0.7) {
      stress -= 1;
      reasons.push(`P/C ratio low ${signals.putCallRatio.toFixed(2)}`);
    }
  }

  let label: RegimeLabel;
  if (stress >= 4) label = "STRESS";
  else if (stress >= 2) label = "FRAGILE";
  else if (stress >= -1) label = "NEUTRAL";
  else label = "RISK_ON";

  return { label, reasons };
}

// ─── FOMC calendar ───────────────────────────────────────────────────────
//
// Live calendar is fetched from federalreserve.gov via fomc-fetcher.ts;
// the loader (regime-loader.ts) pre-fetches once per render and feeds
// the resulting array into daysToNextFOMC() below. The pure helper
// remains synchronous and dependency-free so existing tests continue
// to call it inline without async plumbing.
//
// Each date is the *second* day of the two-day meeting (the rate-
// decision announcement day) in ISO YYYY-MM-DD form, sorted ascending.
//
// FOMC_FALLBACK_CALENDAR is a small pinned baseline used only when the
// live fetch fails on a cold instance. We keep it deliberately short
// (current + next year if known) so it doesn't drift far from reality
// before someone notices. The fetcher is the source of truth.

export const FOMC_FALLBACK_CALENDAR = [
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-10",
  "2026-07-29",
  "2026-09-16",
  "2026-10-28",
  "2026-12-09",
];

/**
 * Returns the number of *calendar* days from `today` (UTC) until the
 * next FOMC announcement, inclusive of today. 0 means the next
 * announcement is today; 1 means tomorrow; 999 is the sentinel for
 * "no future date in the supplied calendar" so callers can fall back
 * cleanly without throwing.
 *
 * `dates` defaults to the pinned fallback calendar so legacy
 * consumers and unit tests don't need to thread the live fetch
 * through.
 */
export function daysToNextFOMC(
  today: Date = new Date(),
  dates: string[] = FOMC_FALLBACK_CALENDAR,
): number {
  // Floor `today` to UTC midnight so partial-day comparisons don't
  // flip the result based on the hour the dashboard renders.
  const todayMidnightUTC = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  for (const d of dates) {
    const fomcMidnightUTC = Date.UTC(
      Number(d.slice(0, 4)),
      Number(d.slice(5, 7)) - 1,
      Number(d.slice(8, 10)),
    );
    const diffDays = Math.round(
      (fomcMidnightUTC - todayMidnightUTC) / (1000 * 60 * 60 * 24),
    );
    if (diffDays >= 0) return diffDays;
  }
  return 999;
}
