// src/lib/dashboard/year-outlook.ts
//
// Pure display helpers for the Phase 3 Batch G "Year Outlook" surface
// at /app/year-outlook.
//
// Splits the rendering math out of the React tree so it's unit-testable
// without booting React / DOM / recharts. Three jobs:
//
//   1. formatPacingNarrative — turn a `PacingProjection` (the FV /
//      gap / required-CAGR triple from goals.ts) into the plain-English
//      headline + sub-line the PacingCard renders. Handles the "no
//      goals", "in the past", "on pace", and "behind" branches so the
//      card itself stays a thin layout component.
//
//   2. computeGlidepathDrift — given an actual stock allocation
//      percent (whole-percent number 0..100) and a `TargetAllocation`
//      bucket triple, return the three deltas + a drift label. The
//      label is what the GlidepathVisualizer surfaces underneath the
//      donut.
//
//   3. buildProjectionSeries — sample the future-value formula at one
//      year intervals between now and the target date so the
//      PacingCard's recharts <LineChart> has a real series to plot.
//      Sampling annually (rather than monthly) keeps the chart
//      readable on a card-sized viewport and matches the granularity
//      of the requiredAnnualReturn solve.
//
// Zero side effects, zero I/O. Tested in year-outlook.test.ts.

import type { PacingProjection } from "./goals";
import type { TargetAllocation } from "./goals";
import type { UserGoals } from "./goals-loader";

export interface PacingNarrative {
  /** Big headline number, e.g. "$1.2M projected by 2050". Empty when no goals. */
  headline: string;
  /** Color-encoded sub-line (on pace / behind by $X). */
  status: string;
  /** "buy" | "sell" | "muted" — drives Editorial-Warm color. */
  tone: "buy" | "sell" | "muted";
  /** Required CAGR vs expected baseline, formatted "6.2% (vs 7%)". */
  cagrLine: string;
  /** "X years to target" — clamps to "today" when 0. */
  yearsLine: string;
}

const EXPECTED_BASELINE_PCT = 7;

function fmtMoneyShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Turn a `PacingProjection` + the user's `targetDate` into the four
 * lines the PacingCard surfaces.
 *
 * Branches:
 *   - goals incomplete → "Set your goals" empty-state narrative
 *   - yearsRemaining === 0 → past-due target, compare current vs target
 *   - on pace                → green; "$X projected by YYYY"
 *   - behind                 → rust; surface the dollar gap
 *
 * The required-CAGR line clamps absurd values (>50% / <-50%) to "—"
 * because the binary search returns the search bounds in those
 * degenerate cases and rendering "+100%" would mislead more than help.
 */
export function formatPacingNarrative(
  projection: PacingProjection | null,
  targetDate: string | null,
): PacingNarrative {
  if (!projection || !targetDate) {
    return {
      headline: "Set your goals to see pacing",
      status: "Add target wealth + target date to project your trajectory.",
      tone: "muted",
      cagrLine: "",
      yearsLine: "",
    };
  }

  const targetYear = (() => {
    const d = new Date(targetDate);
    if (Number.isNaN(d.getTime())) return null;
    return d.getUTCFullYear();
  })();

  // Past-due target — collapse the math to a current-vs-target snap.
  if (projection.yearsRemaining === 0) {
    return {
      headline: `${fmtMoneyShort(projection.projectedValue)} reached`,
      status: projection.onTrack
        ? "Target reached or in the past."
        : `Behind by ${fmtMoneyShort(Math.abs(projection.gapDollars))}`,
      tone: projection.onTrack ? "buy" : "sell",
      cagrLine: "",
      yearsLine: "Target date passed",
    };
  }

  const headline = `${fmtMoneyShort(projection.projectedValue)} projected${
    targetYear ? ` by ${targetYear}` : ""
  }`;

  const status = projection.onTrack
    ? "On pace."
    : `Behind by ${fmtMoneyShort(Math.abs(projection.gapDollars))}`;

  const cagrPct = projection.requiredAnnualReturn * 100;
  const cagrLine =
    Math.abs(cagrPct) > 50
      ? `Required CAGR: — (vs ${EXPECTED_BASELINE_PCT}% baseline)`
      : `Required CAGR: ${cagrPct.toFixed(1)}% (vs ${EXPECTED_BASELINE_PCT}% baseline)`;

  const years = projection.yearsRemaining;
  const yearsLine =
    years < 1
      ? "Less than a year to target"
      : `${years.toFixed(1)} years to target`;

  return {
    headline,
    status,
    tone: projection.onTrack ? "buy" : "sell",
    cagrLine,
    yearsLine,
  };
}

export interface GlidepathDrift {
  /** Actual - target, in percentage points, for each bucket. */
  stocksDriftPp: number;
  bondsDriftPp: number;
  cashDriftPp: number;
  /** "+8pp stocks above target" or "On target" when |max| ≤ 1pp. */
  label: string;
  /** Bucket whose absolute drift is the largest — drives label phrasing. */
  worstBucket: "stocks" | "bonds" | "cash" | null;
}

/**
 * Compare actual stock-allocation share (whole percent 0..100) and
 * the target triple, then describe the worst-drifting bucket.
 *
 * Conventions:
 *   - actualStocksPct is sourced from `deriveStockAllocationPct`
 *     (queue-sources.ts), the same number the rebalance_drift queue
 *     item uses, so the visualizer agrees with the queue card.
 *   - We currently lack a separate bonds-vs-cash split in the
 *     warehouse — for the Year Outlook v1 we model "non-stock" as a
 *     single bucket allocated proportionally to the target's bonds
 *     and cash shares. That keeps the donut honest about what we
 *     actually know vs. assume. (TODO when bond/cash classification
 *     lands: source the actual triple instead.)
 *   - "On target" drift threshold is ±1pp because anything tighter
 *     is noise from rounding the target buckets to whole-percent.
 */
export function computeGlidepathDrift(
  actualStocksPct: number | null,
  target: TargetAllocation,
): GlidepathDrift {
  if (actualStocksPct === null || !Number.isFinite(actualStocksPct)) {
    return {
      stocksDriftPp: 0,
      bondsDriftPp: 0,
      cashDriftPp: 0,
      label: "Allocation unknown",
      worstBucket: null,
    };
  }
  const stocksDriftPp = actualStocksPct - target.stocksPct;

  // Split the non-stock remainder proportionally between bonds and
  // cash so the three deltas always sum to 0pp, matching the
  // donut's visual share.
  const nonStock = 100 - actualStocksPct;
  const targetNonStock = target.bondsPct + target.cashPct;
  const bondsShare =
    targetNonStock > 0 ? target.bondsPct / targetNonStock : 0.5;
  const actualBondsPct = nonStock * bondsShare;
  const actualCashPct = nonStock - actualBondsPct;
  const bondsDriftPp = actualBondsPct - target.bondsPct;
  const cashDriftPp = actualCashPct - target.cashPct;

  const drifts: Array<{ bucket: "stocks" | "bonds" | "cash"; pp: number }> = [
    { bucket: "stocks", pp: stocksDriftPp },
    { bucket: "bonds", pp: bondsDriftPp },
    { bucket: "cash", pp: cashDriftPp },
  ];
  drifts.sort((a, b) => Math.abs(b.pp) - Math.abs(a.pp));
  const worst = drifts[0];

  if (Math.abs(worst.pp) <= 1) {
    return {
      stocksDriftPp,
      bondsDriftPp,
      cashDriftPp,
      label: "On target",
      worstBucket: worst.bucket,
    };
  }

  const direction = worst.pp > 0 ? "above" : "below";
  const label = `${worst.pp > 0 ? "+" : ""}${worst.pp.toFixed(0)}pp ${
    worst.bucket
  } ${direction} target`;

  return {
    stocksDriftPp,
    bondsDriftPp,
    cashDriftPp,
    label,
    worstBucket: worst.bucket,
  };
}

export interface ProjectionSeriesPoint {
  /** Calendar year of the sample. */
  year: number;
  /** Future value of the portfolio at that year, in dollars. */
  value: number;
}

/**
 * Build a one-row-per-year future-value series so the PacingCard's
 * recharts LineChart has a real trajectory to plot.
 *
 *   FV(t) = PV(1+r)^t + PMT_yr * (((1+r)^t - 1) / r)
 *
 * Same formula as goals.ts — we don't import its private `futureValue`
 * to keep this module dependency-free. Sampling is annual (years +
 * value), which is plenty granular for a 10-30 year horizon at the
 * card's pixel width.
 *
 * Returns at most ~50 points; if `yearsRemaining` is past-due (≤ 0)
 * we return a single { year: now, value: currentValue } sample so the
 * card can still render a non-empty series.
 */
export function buildProjectionSeries(
  currentValue: number,
  monthlyContribution: number,
  yearsRemaining: number,
  expectedAnnualReturn = 0.07,
): ProjectionSeriesPoint[] {
  const startYear = new Date().getUTCFullYear();
  if (
    !Number.isFinite(currentValue) ||
    !Number.isFinite(monthlyContribution) ||
    !Number.isFinite(yearsRemaining) ||
    yearsRemaining <= 0
  ) {
    return [{ year: startYear, value: Math.max(0, currentValue || 0) }];
  }
  const years = Math.min(50, Math.ceil(yearsRemaining));
  const r = expectedAnnualReturn;
  const safeR = Math.abs(r) < 1e-9 ? (r >= 0 ? 1e-9 : -1e-9) : r;
  const pmtYear = monthlyContribution * 12;

  const out: ProjectionSeriesPoint[] = [];
  for (let t = 0; t <= years; t++) {
    const fv =
      currentValue * Math.pow(1 + r, t) +
      pmtYear * ((Math.pow(1 + r, t) - 1) / safeR);
    out.push({ year: startYear + t, value: fv });
  }
  return out;
}

/**
 * Helper for the page composer: figure out whether the user has the
 * minimum goals filled to render a real PacingCard. Three required
 * fields: `targetWealth`, `targetDate`, and `currentAge`. The
 * PacingCard falls back to an empty-state CTA when this returns false.
 */
export function hasPacingInputs(goals: UserGoals | null): boolean {
  if (!goals) return false;
  return (
    typeof goals.targetWealth === "number" &&
    Number.isFinite(goals.targetWealth) &&
    goals.targetWealth > 0 &&
    typeof goals.targetDate === "string" &&
    goals.targetDate.length > 0 &&
    typeof goals.currentAge === "number" &&
    Number.isFinite(goals.currentAge) &&
    goals.currentAge > 0
  );
}
