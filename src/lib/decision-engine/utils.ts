import type {
  DecisionAction,
  ScoreDirection,
} from "./types";

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function safeDivide(
  numerator: number,
  denominator: number
): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return null;
  }
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function pctChange(
  start: number | null,
  end: number | null
): number | null {
  if (!isFiniteNumber(start) || !isFiniteNumber(end) || start === 0) {
    return null;
  }
  return ((end - start) / start) * 100;
}

export function formatDecisionAction(action: DecisionAction): string {
  switch (action) {
    case "HIGH_CONVICTION_CANDIDATE":
      return "High-Conviction Candidate";
    case "BUY_CANDIDATE":
      return "Buy Candidate";
    case "HOLD_WATCH":
      return "Hold / Watch";
    case "REDUCE_REVIEW":
      return "Reduce / Review";
    case "AVOID":
      return "Avoid";
    case "INSUFFICIENT_DATA":
      return "Insufficient Data";
  }
}

export function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function scoreDirection(score: number): ScoreDirection {
  if (score >= 60) return "BULLISH";
  if (score <= 40) return "BEARISH";
  return "NEUTRAL";
}

export function roundNullable(
  value: number | null,
  digits = 2
): number | null {
  if (!isFiniteNumber(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
