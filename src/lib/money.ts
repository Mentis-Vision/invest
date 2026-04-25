/**
 * Money-precision utilities.
 *
 * Why this module exists:
 *   JavaScript's `number` is float64. Summing many float values —
 *   `$1,234.56 + $789.12 + ...` — accumulates sub-cent drift that
 *   displays as totals like `$X.99999` or sector percentages that
 *   don't quite sum to 100. For a read-only financial app that's a
 *   trust killer even though no money moves.
 *
 * Design choice: cents-integer bookkeeping, NOT Decimal.js.
 *   Our data enters as float (from Plaid SDK, SnapTrade SDK, pg driver)
 *   and exits as float (JSON to client, Intl.NumberFormat to DOM).
 *   Inserting a Decimal type at the boundaries would touch every DB
 *   read and every serialize site. The actual drift symptoms localize
 *   to summation and percent math, so we fix those with pure functions
 *   that round to cents during aggregation and compute percents in a
 *   single step.
 *
 * All functions are pure, stateless, USD-agnostic (the unit doesn't
 * matter — they only care that "cents" = 100 sub-units of the display
 * unit). No dependencies.
 *
 * Invariants worth knowing:
 *   sumMoney(0.1, 0.2)                  === 0.3    // not 0.30000000000000004
 *   normalizeWeights([1,1,1]).sum       === 100
 *   normalizeWeights([1,1,1])           === [33.3, 33.3, 33.4]
 *   percentOf(1, 3)                     === 33.3  (1dp)
 */

/**
 * Sum money values with cents-integer precision. Null/undefined/
 * non-finite entries are skipped silently (common pattern when
 * holdings have missing `lastValue` or similar optional fields).
 *
 * Each addend is rounded to cents BEFORE summing so drift can't
 * accumulate across a long list of positions. The returned number
 * is exact to 2dp for any input values that are exact to 2dp.
 */
export function sumMoney(
  ...values: Array<number | null | undefined>
): number {
  let cents = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    cents += Math.round(v * 100);
  }
  return cents / 100;
}

/**
 * Share of `part` in `whole`, returned as a percent (0–100) rounded
 * to `digits` decimal places. Single rounding — no cumulative drift.
 *
 * Returns 0 when `whole` is 0 or non-finite (the "empty portfolio"
 * safe fallback; callers should decide whether to display that or
 * a dash).
 */
export function percentOf(
  part: number,
  whole: number,
  digits: number = 1
): number {
  if (!Number.isFinite(whole) || whole === 0) return 0;
  const raw = (part / whole) * 100;
  const m = 10 ** digits;
  return Math.round(raw * m) / m;
}

/**
 * Convert an array of part values into percents that sum to EXACTLY
 * 100 at `digits` precision. Uses the largest-remainder method
 * (a.k.a. Hamilton method) — the most common convention for
 * allocating display percentages that "must sum to 100."
 *
 * Preserves the input order. Handles zero/empty whole by returning
 * zeros. Non-finite parts are treated as 0.
 *
 * Visual note: [1, 1, 1] at 1dp yields [33.3, 33.3, 33.4], not
 * [33.3, 33.3, 33.3]. The extra 0.1 lands on whichever bucket had
 * the largest post-rounding remainder — ties broken by index.
 */
export function normalizeWeights(
  parts: Array<number | null | undefined>,
  digits: number = 1
): number[] {
  const sanitized = parts.map((p) =>
    p == null || !Number.isFinite(p) ? 0 : p
  );
  const whole = sanitized.reduce((sum, p) => sum + p, 0);
  if (whole === 0 || !Number.isFinite(whole)) {
    return sanitized.map(() => 0);
  }

  const scale = 10 ** digits;
  // Work in "ten-thousandths" (or whatever digits scale) so the
  // post-rounding residual is an integer count of scale units.
  const target = 100 * scale;
  const rawScaled = sanitized.map((p) => (p / whole) * target);
  const floored = rawScaled.map(Math.floor);
  const flooredSum = floored.reduce((a, b) => a + b, 0);

  // Remainder to distribute — each bucket gets at most +1 unit at
  // this precision, in order of largest residual.
  let remaining = Math.round(target) - flooredSum;
  const remainders = rawScaled
    .map((r, i) => ({ i, r: r - Math.floor(r) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);

  const result = [...floored];
  for (const { i } of remainders) {
    if (remaining <= 0) break;
    result[i] += 1;
    remaining -= 1;
  }

  return result.map((n) => n / scale);
}

/**
 * Round a money value to exact cents. Safe for equality comparisons
 * and display. Internally: `Math.round(v * 100) / 100`, which is the
 * standard way to quash float artifacts on a single value.
 *
 * Use sparingly — prefer `sumMoney` for aggregates and the display
 * layer (`Intl.NumberFormat`) for formatting.
 */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
