// src/lib/dashboard/urgency.ts
// Pure functions for ranking Decision Queue items.
// Spec §7.

import type { ItemTypeKey, HorizonTag } from "./types";

export const STATIC_IMPACT: Record<ItemTypeKey, number> = {
  broker_reauth: 100,
  concentration_breach_severe: 90,
  concentration_breach_moderate: 70,
  catalyst_prep_imminent: 80,
  catalyst_prep_upcoming: 50,
  stale_rec_held: 60,
  stale_rec_watched: 30,
  outcome_action_mark: 40,
  cash_idle: 50,
  year_pace_review: 30,
  quality_decline: 50,
  goals_setup: 60,
  rebalance_drift: 50,
  tax_harvest: 40,
  cluster_buying: 60,
};

export function computeTimeDecay(hoursToEvent: number | null): number {
  if (hoursToEvent === null) return 0.1;
  if (hoursToEvent <= 24) return 1.0;
  if (hoursToEvent <= 24 * 7) return 0.7;
  if (hoursToEvent <= 24 * 30) return 0.4;
  return 0.2;
}

export function computeFreshnessDecay(daysSinceSurfaced: number): number {
  if (daysSinceSurfaced <= 0) return 1.0;
  if (daysSinceSurfaced <= 3) return 0.85;
  if (daysSinceSurfaced <= 7) return 0.6;
  return 0.3;
}

export interface UrgencyInput {
  impact: number;
  hoursToEvent: number | null;
  daysSinceSurfaced: number;
}

export function computeUrgencyScore(input: UrgencyInput): number {
  return (
    input.impact *
    computeTimeDecay(input.hoursToEvent) *
    computeFreshnessDecay(input.daysSinceSurfaced)
  );
}

export interface HorizonInput {
  impact: number;
  hoursToEvent: number | null;
}

export function resolveHorizonTag(input: HorizonInput): HorizonTag {
  if (input.impact >= 90) return "TODAY";
  if (input.hoursToEvent !== null) {
    if (input.hoursToEvent <= 24) return "TODAY";
    if (input.hoursToEvent <= 24 * 7) return "THIS_WEEK";
    if (input.hoursToEvent <= 24 * 30) return "THIS_MONTH";
    return "THIS_YEAR";
  }
  if (input.impact >= 60) return "THIS_WEEK";
  if (input.impact >= 40) return "THIS_MONTH";
  return "THIS_YEAR";
}
