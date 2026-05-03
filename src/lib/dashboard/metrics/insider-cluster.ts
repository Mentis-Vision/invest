// src/lib/dashboard/metrics/insider-cluster.ts
//
// Pure math + classification for the Phase 4 Batch K1 Form 4 insider
// cluster signal. Detects "cluster buying" — three or more distinct
// insiders making material open-market purchases within a rolling
// 14-day window. Coordinated buying by multiple insiders is one of
// the strongest insider-information signals because it requires
// independent action from independent legal-personality individuals,
// and historically correlates with positive 30-day forward returns.
//
// Filter rules (from spec):
//   * Code "P" only — open-market purchases. We deliberately ignore:
//       - "S" sales (negative signal handled elsewhere)
//       - "A" awards (compensation, not signal)
//       - "M"/"X" option exercises (mechanical)
//       - "F" tax withholding, "G" gifts, "I" discretionary
//   * 10b5-1 plans excluded — those are pre-scheduled and carry no
//     dispositional intent. We detect via `is10b5_1` flag the loader
//     surfaces from the Form 4 footnote section.
//   * $100k minimum per transaction — filters insider-cosmetic
//     buys that don't move the needle. Aggregate per insider in the
//     window — multiple smaller buys by the same insider sum.
//   * 3+ distinct insiders — by `filerName` after canonicalization.
//
// Pure module: no I/O, no fetches. The loader feeds in a
// pre-collected transaction list; this module decides whether the
// list contains a cluster.

export interface Form4Transaction {
  /** Insider's reporting name. Used to count distinct buyers. */
  filerName: string | null;
  /** ISO date the transaction was executed. */
  transactionDate: string | null;
  /** Form 4 transaction code. "P" = open-market purchase. */
  transactionCode: string | null;
  /** True when filed as part of a 10b5-1 trading plan. */
  is10b5_1?: boolean;
  /** USD value of the transaction; null when shares × price unknown. */
  approxDollarValue: number | null;
  /** True when the filer holds an officer role. */
  isOfficer?: boolean;
  /** True when the filer holds a board seat. */
  isDirector?: boolean;
}

export interface ClusterSignal {
  /** Earliest transaction date in the cluster window (ISO). */
  windowStart: string;
  /** Latest transaction date in the cluster window (ISO). */
  windowEnd: string;
  /** Distinct insider names participating. */
  insiderNames: string[];
  /** Aggregate USD across the cluster (sum of approxDollarValue). */
  totalDollars: number;
  /** Number of insiders in the cluster (>= 3). */
  insiderCount: number;
  /** Number of qualifying transactions in the cluster. */
  transactionCount: number;
}

const MIN_INSIDERS = 3;
const MIN_DOLLARS_PER_INSIDER = 100_000;
const WINDOW_DAYS = 14;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

function canonicalName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  // Collapse whitespace, lowercase. SEC sometimes reports "Smith, John"
  // and other times "JOHN SMITH" — we normalize both axes.
  return trimmed.toLowerCase().replace(/[,]/g, " ").replace(/\s+/g, " ");
}

function parseDateMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Detect cluster-buying signals in a list of Form 4 transactions for a
 * single ticker. Returns one ClusterSignal per non-overlapping 14-day
 * window where at least three distinct insiders bought $100k+ each
 * (aggregated within the window per insider).
 *
 * Implementation: sort all qualifying transactions by date, then
 * sweep a rolling window. For each anchor transaction, find all
 * transactions whose date is within `WINDOW_DAYS` afterward, sum
 * per-insider, count insiders crossing the dollar threshold, and
 * emit a cluster when the count clears `MIN_INSIDERS`. Returned
 * clusters do not overlap — once a cluster is emitted, the sweep
 * advances past its `windowEnd`.
 *
 * Returns `[]` when no qualifying activity exists.
 */
export function detectClusterBuying(
  transactions: Form4Transaction[],
): ClusterSignal[] {
  // Filter step 1: code "P", non-10b5-1, has a parseable date.
  const eligible = transactions
    .filter((t) => t.transactionCode === "P")
    .filter((t) => t.is10b5_1 !== true)
    .map((t) => ({
      ...t,
      _ms: parseDateMs(t.transactionDate),
      _name: canonicalName(t.filerName),
    }))
    .filter((t) => t._ms !== null && t._name !== null) as Array<
    Form4Transaction & { _ms: number; _name: string }
  >;

  if (eligible.length === 0) return [];

  // Sort earliest-first so window sweep is monotone.
  eligible.sort((a, b) => a._ms - b._ms);

  const out: ClusterSignal[] = [];
  let cursor = 0;

  while (cursor < eligible.length) {
    const anchor = eligible[cursor];
    const windowEndMs = anchor._ms + WINDOW_MS;

    // Collect every transaction in the rolling window.
    const inWindow: Array<Form4Transaction & { _ms: number; _name: string }> = [];
    for (let i = cursor; i < eligible.length; i++) {
      if (eligible[i]._ms > windowEndMs) break;
      inWindow.push(eligible[i]);
    }

    // Aggregate dollars per insider name.
    const perInsider = new Map<string, number>();
    for (const t of inWindow) {
      const dollars = Number.isFinite(t.approxDollarValue ?? NaN)
        ? Math.max(0, t.approxDollarValue ?? 0)
        : 0;
      perInsider.set(t._name, (perInsider.get(t._name) ?? 0) + dollars);
    }

    // Count insiders at/over the per-insider threshold.
    const qualifyingInsiders: string[] = [];
    for (const [name, total] of perInsider.entries()) {
      if (total >= MIN_DOLLARS_PER_INSIDER) qualifyingInsiders.push(name);
    }

    if (qualifyingInsiders.length >= MIN_INSIDERS) {
      const txnsInCluster = inWindow.filter((t) =>
        qualifyingInsiders.includes(t._name),
      );
      const totalDollars = txnsInCluster.reduce(
        (acc, t) => acc + (t.approxDollarValue ?? 0),
        0,
      );
      const lastMs = txnsInCluster[txnsInCluster.length - 1]._ms;
      out.push({
        windowStart: new Date(anchor._ms).toISOString().slice(0, 10),
        windowEnd: new Date(lastMs).toISOString().slice(0, 10),
        insiderNames: qualifyingInsiders.slice().sort(),
        totalDollars: Math.round(totalDollars),
        insiderCount: qualifyingInsiders.length,
        transactionCount: txnsInCluster.length,
      });
      // Advance past the cluster window so subsequent emits don't
      // overlap with the same anchor.
      cursor =
        eligible.findIndex((t) => t._ms > lastMs) === -1
          ? eligible.length
          : eligible.findIndex((t) => t._ms > lastMs);
      if (cursor === -1) cursor = eligible.length;
    } else {
      cursor++;
    }
  }

  return out;
}

/**
 * Format a cluster's total dollar amount for the queue chip /
 * headline body. "$1.4M", "$420k", "$120k" — never raw cents.
 */
export function formatClusterDollars(totalDollars: number): string {
  const abs = Math.abs(totalDollars);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(abs / 1_000)}k`;
  return `$${Math.round(abs)}`;
}
