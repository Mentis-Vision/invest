// src/lib/dashboard/types.ts
// Shared types for the actionable dashboard (Phase 1).
// Spec: docs/superpowers/specs/2026-05-02-actionable-dashboard-phase-1-design.md

export type HorizonTag = "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "THIS_YEAR";

export type ItemTypeKey =
  | "broker_reauth"
  | "concentration_breach_severe"
  | "concentration_breach_moderate"
  | "catalyst_prep_imminent"
  | "catalyst_prep_upcoming"
  | "stale_rec_held"
  | "stale_rec_watched"
  | "outcome_action_mark"
  | "cash_idle"
  | "year_pace_review"
  | "quality_decline"
  | "goals_setup"
  | "rebalance_drift"
  | "tax_harvest"
  | "cluster_buying";

export type QueueItemStatus = null | "snoozed" | "dismissed" | "done";

export type DismissReason =
  | "already_handled"
  | "disagree"
  | "not_applicable"
  | "other";

export interface QueueChip {
  label: string;       // e.g. "TQ", "conc"
  value: string;       // e.g. "41", "8.4%"
  tooltipKey?: string; // matches CHIP_DEFINITIONS key
}

export interface QueueItem {
  itemKey: string;
  itemType: ItemTypeKey;
  ticker: string | null;
  title: string;
  body: string;
  horizon: HorizonTag;
  urgencyScore: number;
  impact: number;
  timeDecay: number;
  freshnessDecay: number;
  chips: QueueChip[];
  primaryActionHref: string;
  primaryActionLabel: string;
  firstSurfacedAt: string;
  status: QueueItemStatus;
  snoozeUntil: string | null;
}

export interface HeadlineCache {
  itemKey: string;
  rendered: QueueItem;
  cachedAt: string;
}

export const HORIZON_COLOR: Record<HorizonTag, string> = {
  TODAY: "var(--sell)",
  THIS_WEEK: "var(--decisive)",
  THIS_MONTH: "var(--hold)",
  THIS_YEAR: "var(--buy)",
};

// ── Phase 5 dashboard redesign types ──

export interface BenchmarkComparison {
  key: string;       // preset slug ("sp500") or custom ticker ("ARKK")
  label: string;     // human-readable
  deltaPct: number;  // portfolio − benchmark over chosen window, fraction
}

export interface TickerMover {
  ticker: string;
  changePct: number;  // signed fraction (0.023 = +2.3%)
}

export interface HeroSparklinePoint {
  date: string;       // ISO date
  value: number;      // portfolio total $ on that date
}

export interface HeroData {
  totalValue: number | null;
  dayChange: { dollars: number; pct: number } | null;
  mtdPct: number | null;
  ytdPct: number | null;
  benchmarks: BenchmarkComparison[];
  sparkline: HeroSparklinePoint[];
  topMovers: TickerMover[];
  asOf: string | null;
}
