/**
 * Range helpers for the track-record performance chart.
 *
 * Lives outside the Next.js App Router route file because route files
 * may only export handler symbols (GET/POST/etc) and a fixed set of
 * config exports. Putting these helpers in a sibling module keeps the
 * route file compliant and lets tests import the functions directly.
 *
 * AGENTS.md hard rule #13 (trust tenet): supported ranges must reflect
 * actual data depth. Never bait the UI into rendering a range button
 * we cannot back with real snapshots.
 */

export const VALID_RANGES = [
  "30d",
  "ytd",
  "1y",
  "2y",
  "3y",
  "5y",
  "max",
] as const;
export type RangeKey = (typeof VALID_RANGES)[number];

export function isRangeKey(value: string | null): value is RangeKey {
  return !!value && (VALID_RANGES as readonly string[]).includes(value);
}

/**
 * Compute the start date a range covers, given the current day. Returns
 * null for `max` (no lower bound). Uses UTC for consistency with the
 * snapshot capturedAt slicing in the route handler.
 */
export function rangeStartDate(range: RangeKey, now: Date): Date | null {
  if (range === "max") return null;
  const d = new Date(now.getTime());
  if (range === "ytd") {
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }
  const days =
    range === "30d"
      ? 30
      : range === "1y"
        ? 365
        : range === "2y"
          ? 730
          : range === "3y"
            ? 1095
            : 1825; // 5y
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/**
 * Compute supportedRanges given the oldest snapshot date. A range is
 * supported when oldest ≤ that range's start date.
 *
 * `max` is always supported when ANY snapshots exist. The other ranges
 * include themselves only if the depth permits — never bait the UI to
 * render a button for data we don't have.
 */
export function computeSupportedRanges(
  oldestSnapshot: Date | null,
  now: Date = new Date()
): RangeKey[] {
  if (!oldestSnapshot) return [];
  const supported: RangeKey[] = [];
  for (const r of VALID_RANGES) {
    if (r === "max") {
      supported.push(r);
      continue;
    }
    const start = rangeStartDate(r, now);
    if (start && oldestSnapshot.getTime() <= start.getTime()) {
      supported.push(r);
    }
  }
  return supported;
}
