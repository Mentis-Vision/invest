// src/lib/dashboard/metrics/revision-breadth.ts
//
// Pure analyst-revision-breadth math (REV6).
//
// Finnhub's `/stock/recommendation` endpoint returns a monthly
// snapshot per ticker:
//   { period: "2025-12-01", strongBuy, buy, hold, sell, strongSell }
//
// We collapse each row into a single "bullishness" integer and
// then compute month-over-month deltas across the trailing 6
// months. An UP delta counts as one upgrade; DOWN as one
// downgrade. The chip surfaces +U / -D and a ratio.
//
// Why bullishness rather than per-analyst tracking? Finnhub
// publishes the *aggregate* count, not individual analyst-level
// changes. Month-over-month delta is the cleanest signal we can
// derive from that shape and matches how Bloomberg's REV/RUSS
// indicators are computed.

export interface AnalystRecommendation {
  /** YYYY-MM-DD or YYYY-MM. Sortable string. */
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface RevisionBreadth {
  /** Net upgrades counted month-over-month over the lookback. */
  upgrades: number;
  /** Net downgrades counted month-over-month over the lookback. */
  downgrades: number;
  /** Upgrades − downgrades. */
  netRevisions: number;
  /** Upgrades / (upgrades + downgrades). 0..1. Null when both 0. */
  ratio: number | null;
  /** Months of history actually consumed. */
  observations: number;
}

/**
 * Collapse one monthly recommendation row into a single
 * "bullishness" integer:
 *   strongBuy  → +2
 *   buy        → +1
 *   hold       →  0
 *   sell       → -1
 *   strongSell → -2
 */
function bullishness(rec: AnalystRecommendation): number {
  return (
    2 * rec.strongBuy +
    1 * rec.buy +
    -1 * rec.sell +
    -2 * rec.strongSell
  );
}

/**
 * Compute REV6 over the trailing N months (default 6). The input
 * may be in any order; we sort ascending by `period` internally.
 *
 * Returns zeroed results when the input has fewer than 2 rows
 * (need at least one month-over-month delta to compute breadth).
 */
export function computeRev6(
  history: AnalystRecommendation[],
  months = 6,
): RevisionBreadth {
  if (history.length < 2) {
    return { upgrades: 0, downgrades: 0, netRevisions: 0, ratio: null, observations: 0 };
  }
  const sorted = history.slice().sort((a, b) => a.period.localeCompare(b.period));
  const slice = sorted.slice(-Math.max(months + 1, 2));
  let upgrades = 0;
  let downgrades = 0;
  for (let i = 1; i < slice.length; i++) {
    const delta = bullishness(slice[i]) - bullishness(slice[i - 1]);
    if (delta > 0) upgrades++;
    else if (delta < 0) downgrades++;
  }
  const total = upgrades + downgrades;
  return {
    upgrades,
    downgrades,
    netRevisions: upgrades - downgrades,
    ratio: total === 0 ? null : upgrades / total,
    observations: slice.length - 1,
  };
}

/**
 * Format the breadth into the chip value, e.g. "+5/-2" for the
 * trailing 6 months. Null returns are caller-side; this function
 * is a stable formatter.
 */
export function formatRev6Chip(breadth: RevisionBreadth): string {
  return `+${breadth.upgrades}/-${breadth.downgrades}`;
}
