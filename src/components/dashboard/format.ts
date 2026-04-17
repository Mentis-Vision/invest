/**
 * Shared formatters for the dashboard — used across every widget and
 * drill panel so numbers render consistently. Tabular-mono friendly.
 */

export function money(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12)
    return `${n < 0 ? "-" : ""}$${(abs / 1e12).toFixed(digits)}T`;
  if (abs >= 1e9)
    return `${n < 0 ? "-" : ""}$${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6)
    return `${n < 0 ? "-" : ""}$${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3)
    return `${n < 0 ? "-" : ""}$${(abs / 1e3).toFixed(digits)}K`;
  return `${n < 0 ? "-" : ""}$${abs.toFixed(digits)}`;
}

/** Money, no abbreviation. Used for the hero value where full digits matter. */
export function moneyFull(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

/** Ratio (0..1) → signed percentage string, e.g. 0.0348 → "+3.48%". */
export function pctSigned(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = n * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

/** Already-%-scale number (e.g. 3.48 means 3.48%) → signed percent string. */
export function pctRawSigned(
  n: number | null | undefined,
  digits = 2
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

/** Pure positive percentage; used when sign is implicit. */
export function pct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** Returns the semantic color variable based on direction. */
export function tone(
  delta: number | null | undefined
): "up" | "down" | "flat" {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 1e-6)
    return "flat";
  return delta > 0 ? "up" : "down";
}

/**
 * ISO date → relative-ish human label: "today", "yesterday", "3d ago",
 * "Mar 12". Used for "last synced" and similar freshness tags.
 */
export function freshness(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Time-of-day based greeting. */
export function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Late night";
}
