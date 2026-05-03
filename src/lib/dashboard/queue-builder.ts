// src/lib/dashboard/queue-builder.ts
// Phase 1 Decision Queue composer. Pure read of existing data sources
// via the queue-sources adapter; no AI calls, no new heuristics. Spec §6.
//
// Inputs:
//   - decision_queue_state (per-user filter / freshness state)
//   - getReviewSummary(userId)  — adapter over portfolio-review + broker
//   - listUnactionedOutcomes(userId) — recs with completed outcomes but
//                                       userAction still null
//
// Output:
//   - QueueItem[] sorted by urgencyScore DESC, with snoozed/dismissed/done
//     items filtered out and firstSurfacedAt freshness preserved.
//
// year_pace_review is always emitted so an empty-state user still gets a
// positive item to engage with.

import { pool } from "../db";
import { log, errorInfo } from "../log";
import {
  STATIC_IMPACT,
  computeUrgencyScore,
  resolveHorizonTag,
} from "./urgency";
import { renderTemplate } from "./headline-template";
import {
  getReviewSummary,
  listUnactionedOutcomes,
  type ReviewSummary,
  type UnactionedOutcome,
} from "./queue-sources";
import { getQualityScores } from "./metrics/quality-loader";
import type { QualityScores } from "./metrics/quality";
import { getTickerMomentum } from "./metrics/momentum-loader";
import { getKellyFraction } from "./metrics/kelly-loader";
import { getPortfolioValue } from "./metrics/risk-loader";
import { getRevisionBreadth } from "./metrics/revision-breadth-loader";
import {
  formatRev6Chip,
  type RevisionBreadth,
} from "./metrics/revision-breadth";
import { getClusterBuyingSignals } from "./metrics/insider-cluster-loader";
import {
  formatClusterDollars,
  type ClusterSignal,
} from "./metrics/insider-cluster";
import { getShortInterestVelocities } from "./metrics/short-interest-loader";
import {
  formatVelocityChip,
  type ShortVelocityReading,
} from "./metrics/short-interest";
import { targetAllocation } from "./goals";
import type {
  QueueItem,
  ItemTypeKey,
  QueueChip,
  QueueItemStatus,
} from "./types";

interface QueueStateRow {
  item_key: string;
  status: QueueItemStatus;
  firstSurfacedAt: string | Date;
  snoozeUntil: string | Date | null;
}

interface RawItem {
  itemKey: string;
  itemType: ItemTypeKey;
  ticker: string | null;
  hoursToEvent: number | null;
  templateData: Record<string, string | number | null | undefined>;
  chips: QueueChip[];
  payload?: Record<string, unknown>;
}

const HOURS_PER_DAY = 24;

function toIso(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * HOURS_PER_DAY)));
}

function deepLink(
  itemType: ItemTypeKey,
  ticker: string | null,
  payload: Record<string, unknown> = {},
): { href: string; label: string } {
  // Routing model (2026-05-02): the workspace is a single dashboard
  // page (`/app`) that switches inner views via `?view=<id>`, except
  // for the standalone routes /app/history, /app/r/[id], /app/settings,
  // /app/year-outlook which DO live at their own paths. The previous
  // hrefs `/app/research?...` and `/app/portfolio?...` returned 404
  // → BetterAuth's proxy treated them as missing and bounced users
  // to /sign-in, which surfaced as "click does nothing / sends me
  // to login." Use `?view=<id>` for in-shell views.
  switch (itemType) {
    case "broker_reauth":
      return { href: "/app/settings#brokerage", label: "Reauthorize" };
    case "concentration_breach_severe":
    case "concentration_breach_moderate":
    case "stale_rec_held":
    case "stale_rec_watched":
    case "catalyst_prep_imminent":
    case "catalyst_prep_upcoming":
      return {
        href: ticker
          ? `/app?view=research&ticker=${encodeURIComponent(ticker)}`
          : "/app?view=research",
        label: "Open thesis",
      };
    case "outcome_action_mark":
      return {
        href: payload.recommendationId
          ? `/app/r/${payload.recommendationId}`
          : "/app/history",
        label: "Mark outcome",
      };
    case "cash_idle":
      return { href: "/app?view=portfolio", label: "Allocate" };
    case "year_pace_review":
      return { href: "/app/history", label: "View pace" };
    case "quality_decline":
      return {
        href: ticker
          ? `/app?view=research&ticker=${encodeURIComponent(ticker)}`
          : "/app?view=research",
        label: "Open thesis",
      };
    case "goals_setup":
      return { href: "/app/settings/goals", label: "Set goals" };
    case "rebalance_drift":
      return { href: "/app?view=portfolio", label: "View allocation" };
    case "tax_harvest":
      return { href: "/app?view=portfolio&hint=tax-harvest", label: "Review losses" };
    case "cluster_buying":
      return {
        href: ticker
          ? `/app?view=research&ticker=${encodeURIComponent(ticker)}`
          : "/app?view=research",
        label: "Open thesis",
      };
  }
}

/**
 * Build the standard set of quality chips for a ticker that has at
 * least one populated quality score. Skips chips for `null` scores
 * so the layered chip row doesn't render empty values.
 */
function qualityChips(scores: QualityScores | null): QueueChip[] {
  if (!scores) return [];
  const chips: QueueChip[] = [];
  if (scores.piotroski !== null) {
    chips.push({
      label: "F-Score",
      value: `${scores.piotroski}/9`,
      tooltipKey: "F-Score",
    });
  }
  if (scores.altmanZ !== null) {
    chips.push({
      label: "Z",
      value: scores.altmanZ.toFixed(1),
      tooltipKey: "Z",
    });
  }
  if (scores.beneishM !== null) {
    chips.push({
      label: "M",
      value: scores.beneishM.toFixed(1),
      tooltipKey: "M",
    });
  }
  if (scores.sloanAccruals !== null) {
    chips.push({
      label: "accruals",
      value: `${(scores.sloanAccruals * 100).toFixed(1)}%`,
      tooltipKey: "accruals",
    });
  }
  return chips;
}

async function loadStateRows(
  userId: string,
): Promise<Map<string, QueueStateRow>> {
  const map = new Map<string, QueueStateRow>();
  try {
    const result = await pool.query<QueueStateRow>(
      `SELECT item_key, status, "firstSurfacedAt", "snoozeUntil"
       FROM decision_queue_state
       WHERE "userId" = $1`,
      [userId],
    );
    for (const row of result.rows) map.set(row.item_key, row);
  } catch (err) {
    log.warn("queue-builder", "loadStateRows failed", {
      userId,
      ...errorInfo(err),
    });
  }
  return map;
}

async function upsertSurfaced(
  userId: string,
  itemKey: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO decision_queue_state ("userId", item_key, status, surface_count)
       VALUES ($1, $2, NULL, 1)
       ON CONFLICT ("userId", item_key)
       DO UPDATE SET surface_count = decision_queue_state.surface_count + 1,
                     "updatedAt" = NOW()`,
      [userId, itemKey],
    );
  } catch (err) {
    log.warn("queue-builder", "upsertSurfaced failed", {
      userId,
      itemKey,
      ...errorInfo(err),
    });
  }
}

function buildBrokerReauth(review: ReviewSummary | null, raw: RawItem[]): void {
  if (
    review?.brokerStatus === "reauth_required" ||
    review?.brokerStatus === "disconnected"
  ) {
    raw.push({
      itemKey: `broker_reauth:${review.brokerName ?? "broker"}`,
      itemType: "broker_reauth",
      ticker: null,
      hoursToEvent: 0,
      templateData: { brokerName: review.brokerName ?? "Your broker" },
      chips: [
        {
          label: "broker",
          value: review.brokerName ?? "linked",
          tooltipKey: "broker",
        },
      ],
    });
  }
}

function buildConcentrationBreaches(
  review: ReviewSummary | null,
  raw: RawItem[],
): void {
  for (const breach of review?.concentrationBreaches ?? []) {
    const ratio = breach.cap > 0 ? breach.weight / breach.cap : 0;
    const severe = ratio >= 2;
    const itemType: ItemTypeKey = severe
      ? "concentration_breach_severe"
      : "concentration_breach_moderate";
    raw.push({
      itemKey: `${itemType}:${breach.ticker}`,
      itemType,
      ticker: breach.ticker,
      hoursToEvent: severe ? 12 : HOURS_PER_DAY * 5,
      templateData: {
        deltaPp: Math.max(1, Math.round(breach.weight - breach.cap)),
        currentPct: breach.weight,
        minCapPct: breach.cap,
        maxCapPct: breach.cap + 1,
        nextEvent: breach.nextEvent ?? undefined,
      },
      chips: [
        {
          label: "conc",
          value: `${breach.weight.toFixed(1)}%`,
          tooltipKey: "conc",
        },
        ...(breach.tradeQuality !== undefined
          ? [
              {
                label: "TQ",
                value: String(breach.tradeQuality),
                tooltipKey: "TQ",
              },
            ]
          : []),
      ],
    });
  }
}

function buildCatalysts(review: ReviewSummary | null, raw: RawItem[]): void {
  for (const cat of review?.upcomingCatalysts ?? []) {
    const dte = cat.daysToEvent;
    if (dte === null || dte === undefined) continue;
    const itemType: ItemTypeKey =
      dte <= 7 ? "catalyst_prep_imminent" : "catalyst_prep_upcoming";
    raw.push({
      itemKey: `${itemType}:${cat.ticker}:${cat.eventDate}`,
      itemType,
      ticker: cat.ticker,
      hoursToEvent: dte * HOURS_PER_DAY,
      templateData: {
        eventName: cat.eventName ?? "earnings",
        eventDate: cat.eventDate,
        daysToEvent: dte,
        priorReaction: cat.priorReaction ?? undefined,
        currentPct: cat.currentPct ?? undefined,
      },
      chips: [
        { label: "T-", value: `${dte}d`, tooltipKey: "earnings" },
        ...(cat.priorReaction
          ? [
              {
                label: "prior-reaction",
                value: cat.priorReaction,
                tooltipKey: "prior-reaction",
              },
            ]
          : []),
      ],
    });
  }
}

function buildStaleRecs(review: ReviewSummary | null, raw: RawItem[]): void {
  for (const stale of review?.staleRecs ?? []) {
    const isHeld = stale.isHeld === true;
    const itemType: ItemTypeKey = isHeld ? "stale_rec_held" : "stale_rec_watched";
    raw.push({
      itemKey: `${itemType}:${stale.ticker}:${stale.recommendationId}`,
      itemType,
      ticker: stale.ticker,
      hoursToEvent: null,
      templateData: {
        daysAgo: stale.daysAgo,
        moveSinceRec: stale.moveSinceRec,
        originalVerdict: stale.originalVerdict,
        priceAtRec: stale.priceAtRec,
      },
      chips: [
        { label: "stale", value: `${stale.daysAgo}d`, tooltipKey: "stale" },
        {
          label: "since-rec",
          value: String(stale.moveSinceRec),
          tooltipKey: "since-rec",
        },
      ],
    });
  }
}

function buildOutcomes(
  outcomes: UnactionedOutcome[],
  raw: RawItem[],
): void {
  for (const outcome of outcomes) {
    raw.push({
      itemKey: `outcome_action_mark:${outcome.recommendationId}`,
      itemType: "outcome_action_mark",
      ticker: outcome.ticker,
      hoursToEvent: null,
      templateData: {
        originalDate: outcome.originalDate,
        originalVerdict: outcome.originalVerdict,
        outcomeMove: outcome.outcomeMove,
        outcomeVerdict: outcome.outcomeVerdict,
      },
      chips: [
        {
          label: "outcome",
          value: String(outcome.outcomeMove),
          tooltipKey: "outcome",
        },
      ],
      payload: { recommendationId: outcome.recommendationId },
    });
  }
}

function buildCashIdle(review: ReviewSummary | null, raw: RawItem[]): void {
  if (
    review?.cashIdle &&
    review.cashIdle.amount >= 500 &&
    review.cashIdle.daysIdle >= 14
  ) {
    raw.push({
      itemKey: "cash_idle:current",
      itemType: "cash_idle",
      ticker: null,
      hoursToEvent: null,
      templateData: {
        cashAmount: review.cashIdle.amount,
        daysIdle: review.cashIdle.daysIdle,
        numCandidates: review.cashIdle.numCandidates ?? 0,
      },
      chips: [
        {
          label: "cash",
          value: `$${review.cashIdle.amount.toLocaleString("en-US")}`,
          tooltipKey: "cash",
        },
        {
          label: "days-idle",
          value: `${review.cashIdle.daysIdle}d`,
          tooltipKey: "days-idle",
        },
      ],
    });
  }
}

/**
 * Emit a `quality_decline` item for any held ticker whose Piotroski
 * F-Score dropped by ≥2 points period-over-period. Returns the
 * per-ticker score map so other builders can enrich existing items
 * with the same chips without re-querying the warehouse.
 *
 * Held tickers come from `review.holdings`; if review is null we
 * skip the loop entirely (no holdings → nothing to flag).
 */
async function buildQualityDeclineAndCollect(
  review: ReviewSummary | null,
  raw: RawItem[],
): Promise<Map<string, QualityScores>> {
  const out = new Map<string, QualityScores>();
  const tickers = (review?.holdings ?? []).map((h) => h.ticker.toUpperCase());
  if (tickers.length === 0) return out;

  // Bound the warehouse round-trips — for very large portfolios this
  // would otherwise slow the queue render. 25 holdings covers the
  // 95th-percentile portfolio for the current beta cohort.
  const limited = tickers.slice(0, 25);

  const results = await Promise.all(
    limited.map(async (t) => {
      try {
        const scores = await getQualityScores(t);
        return { ticker: t, scores };
      } catch (err) {
        log.warn("queue-builder", "quality lookup failed", {
          ticker: t,
          ...errorInfo(err),
        });
        return { ticker: t, scores: null };
      }
    }),
  );

  for (const { ticker, scores } of results) {
    if (!scores) continue;
    out.set(ticker, scores);

    // quality_decline fires only when both Piotroski periods are
    // present and the score dropped ≥2 points.
    const cur = scores.piotroski;
    const prior = scores.priorPiotroski;
    if (cur === null || prior === null || prior === undefined) continue;
    const drop = prior - cur;
    if (drop < 2) continue;

    raw.push({
      itemKey: `quality_decline:${ticker}`,
      itemType: "quality_decline",
      ticker,
      hoursToEvent: null,
      templateData: {
        ticker,
        priorScore: prior,
        currentScore: cur,
        drop,
      },
      chips: qualityChips(scores),
    });
  }

  return out;
}

/**
 * For each existing raw item with a ticker, layer in any available
 * quality chips after the item-type's own chips. Mutates rawItems in
 * place. Skips quality_decline items themselves (they already have
 * the full quality chip row).
 */
function enrichWithQualityChips(
  raw: RawItem[],
  qualityByTicker: Map<string, QualityScores>,
): void {
  for (const r of raw) {
    if (!r.ticker) continue;
    if (r.itemType === "quality_decline") continue;
    const scores = qualityByTicker.get(r.ticker.toUpperCase());
    if (!scores) continue;
    const extra = qualityChips(scores);
    if (extra.length === 0) continue;
    r.chips = [...r.chips, ...extra];
  }
}

/**
 * Pull 12-1 momentum for every held ticker the user has, in a single
 * Promise.all. Returns a sparse map — tickers with <252 days of
 * warehouse history (or any other null state from the loader) are
 * simply absent. The caller layers the momentum chip onto every raw
 * item whose ticker is in the map.
 *
 * Bounded at the same 25-ticker ceiling we use for the quality loader
 * so very large portfolios don't slow the queue render.
 */
async function loadHoldingMomentum(
  review: ReviewSummary | null,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const tickers = (review?.holdings ?? []).map((h) =>
    h.ticker.toUpperCase(),
  );
  if (tickers.length === 0) return out;
  const limited = Array.from(new Set(tickers)).slice(0, 25);

  const results = await Promise.all(
    limited.map(async (t) => {
      try {
        const mom = await getTickerMomentum(t);
        return { ticker: t, mom };
      } catch (err) {
        log.warn("queue-builder", "momentum lookup failed", {
          ticker: t,
          ...errorInfo(err),
        });
        return { ticker: t, mom: null };
      }
    }),
  );

  for (const { ticker, mom } of results) {
    if (mom === null || !Number.isFinite(mom)) continue;
    out.set(ticker, mom);
  }
  return out;
}

/**
 * Format a fractional return as a signed percent string with a
 * single decimal place: 0.0823 → "+8.2%". Used by the momentum chip.
 */
function formatMomentumPct(value: number): string {
  const pct = value * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Layer the `mom +X%` chip onto every raw item whose ticker has a
 * computable 12-1 momentum value. Mutates raw in place. Safe to
 * call after enrichWithQualityChips — both append to r.chips.
 */
function enrichWithMomentumChips(
  raw: RawItem[],
  momentumByTicker: Map<string, number>,
): void {
  for (const r of raw) {
    if (!r.ticker) continue;
    const mom = momentumByTicker.get(r.ticker.toUpperCase());
    if (mom === undefined) continue;
    r.chips = [
      ...r.chips,
      {
        label: "mom",
        value: formatMomentumPct(mom),
        tooltipKey: "mom",
      },
    ];
  }
}

/**
 * Layer a Kelly chip onto stale_rec_held and catalyst_prep_imminent
 * items. We surface Kelly only on the items where it's most
 * actionable — a stale long the user might re-deploy into, or a
 * pre-catalyst position they might re-size. The chip is identical
 * across these item types (it's a per-user fraction, not per
 * ticker).
 *
 * `kellyFraction` is the per-user value pre-computed by the caller —
 * pass null to skip enrichment entirely (the user has too few
 * outcomes for a meaningful estimate).
 */
function enrichWithKellyChips(
  raw: RawItem[],
  kellyFraction: number | null,
): void {
  if (kellyFraction === null || !Number.isFinite(kellyFraction)) return;
  if (kellyFraction <= 0) return;
  const value = `${(kellyFraction * 100).toFixed(1)}%`;
  for (const r of raw) {
    if (
      r.itemType !== "stale_rec_held" &&
      r.itemType !== "catalyst_prep_imminent"
    ) {
      continue;
    }
    r.chips = [
      ...r.chips,
      {
        label: "Kelly ¼",
        value,
        tooltipKey: "Kelly",
      },
    ];
  }
}

/**
 * Phase 4 Batch J — load REV6 analyst-revision-breadth for every
 * raw item that would receive the chip (stale_rec_held +
 * catalyst_prep_imminent only). Bounded to 15 unique tickers per
 * render so a flurry of catalyst items doesn't spike Finnhub
 * usage; remainder simply don't get the chip.
 */
async function loadRevisionBreadthForActionableItems(
  raw: RawItem[],
): Promise<Map<string, RevisionBreadth>> {
  const out = new Map<string, RevisionBreadth>();
  const targets = new Set<string>();
  for (const r of raw) {
    if (
      r.ticker &&
      (r.itemType === "stale_rec_held" || r.itemType === "catalyst_prep_imminent")
    ) {
      targets.add(r.ticker.toUpperCase());
    }
  }
  if (targets.size === 0) return out;
  const limited = Array.from(targets).slice(0, 15);
  const results = await Promise.all(
    limited.map(async (ticker) => {
      try {
        const breadth = await getRevisionBreadth(ticker);
        return { ticker, breadth };
      } catch (err) {
        log.warn("queue-builder", "rev6 lookup failed", {
          ticker,
          ...errorInfo(err),
        });
        return { ticker, breadth: null };
      }
    }),
  );
  for (const { ticker, breadth } of results) {
    if (breadth === null) continue;
    out.set(ticker, breadth);
  }
  return out;
}

/**
 * Layer the rev6 chip onto every actionable raw item whose ticker
 * resolved a REV6 breadth value. Skips items where both upgrades
 * AND downgrades are zero — that "—/—" chip would be visual
 * noise without actionable signal.
 */
function enrichWithRev6Chips(
  raw: RawItem[],
  revisionByTicker: Map<string, RevisionBreadth>,
): void {
  for (const r of raw) {
    if (!r.ticker) continue;
    if (
      r.itemType !== "stale_rec_held" &&
      r.itemType !== "catalyst_prep_imminent"
    ) {
      continue;
    }
    const breadth = revisionByTicker.get(r.ticker.toUpperCase());
    if (!breadth) continue;
    if (breadth.upgrades === 0 && breadth.downgrades === 0) continue;
    r.chips = [
      ...r.chips,
      {
        label: "rev6",
        value: formatRev6Chip(breadth),
        tooltipKey: "rev6",
      },
    ];
  }
}

/**
 * Phase 3 Batch F — emit `goals_setup` when the user hasn't filled out
 * their goals yet, otherwise check for `rebalance_drift`.
 *
 *   - goals_setup fires when goals.targetWealth is null. Acts as a
 *     persistent nudge until the user runs through GoalsForm.
 *   - rebalance_drift fires when goals are set AND review has both a
 *     stockAllocationPct and the user's currentAge + riskTolerance, AND
 *     the absolute drift between current and target stock allocation
 *     exceeds 5pp. The dollar amount needed to rebalance is the user's
 *     non-cash portfolio value times the drift fraction.
 *
 * Because `getPortfolioValue` is an async DB read, this builder runs
 * outside the synchronous emit chain and is awaited explicitly by the
 * caller.
 */
async function buildGoalsAndRebalanceDrift(
  userId: string,
  review: ReviewSummary | null,
  raw: RawItem[],
): Promise<void> {
  const goals = review?.goals ?? null;

  // Goals-setup emit: no goals row at all, OR targetWealth not yet
  // set. We anchor the item key on a single literal so the same
  // dashboard surface always references the same decision_queue_state
  // row across renders.
  if (!goals?.targetWealth) {
    raw.push({
      itemKey: "goals_setup:initial",
      itemType: "goals_setup",
      ticker: null,
      hoursToEvent: null,
      templateData: {},
      chips: [],
    });
    return;
  }

  // Rebalance-drift emit: requires age + risk + allocation.
  if (
    goals.currentAge === null ||
    goals.riskTolerance === null ||
    review?.stockAllocationPct === null ||
    review?.stockAllocationPct === undefined
  ) {
    return;
  }

  const target = targetAllocation(goals.currentAge, goals.riskTolerance);
  const drift = Math.abs(review.stockAllocationPct - target.stocksPct);
  if (drift <= 5) return;

  const portfolioValue = await getPortfolioValue(userId).catch((err) => {
    log.warn("queue-builder", "getPortfolioValue failed", {
      userId,
      ...errorInfo(err),
    });
    return 0;
  });
  const rebalanceDollars = portfolioValue * (drift / 100);

  const now = new Date();
  raw.push({
    itemKey: `rebalance_drift:${now.getUTCFullYear()}-${now.getUTCMonth()}`,
    itemType: "rebalance_drift",
    ticker: null,
    hoursToEvent: null,
    templateData: {
      currentStockPct: review.stockAllocationPct,
      targetStockPct: target.stocksPct,
      rebalanceDollars,
    },
    chips: [
      { label: "drift", value: `${drift.toFixed(0)}pp`, tooltipKey: "drift" },
      {
        label: "target",
        value: `${target.stocksPct}%`,
        tooltipKey: "glidepath",
      },
    ],
  });
}

/**
 * Phase 3 Batch H — emit a single `tax_harvest` queue item when the
 * loader returns at least one harvestable position. The aggregate
 * loss across positions and the count drive the headline body.
 *
 * `harvestableLosses` is null-tolerant — if the loader degraded to
 * an empty array (cost basis missing across the portfolio, DB blip)
 * we simply skip the emit. The wash-sale disclaimer is rendered
 * downstream by the drill view + headline template, never inferred.
 */
function buildTaxHarvest(review: ReviewSummary | null, raw: RawItem[]): void {
  const losses = review?.harvestableLosses ?? [];
  if (losses.length === 0) return;
  const totalLoss = losses.reduce((acc, l) => acc + l.lossDollars, 0);
  const totalAbs = Math.abs(totalLoss);

  // Anchor the urgency window to the year-end tax cutoff. Setting
  // hoursToEvent to "hours until Dec 31" gives the urgency function a
  // real time signal (decays from 0.4 → 0.7 → 1.0 as Dec 31 approaches)
  // and keeps the horizon tag at THIS_YEAR for any month earlier than
  // November, matching the spec's "Year-tagged" intent.
  const now = new Date();
  const yearEnd = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59));
  const hoursToYearEnd = Math.max(
    1,
    Math.floor((yearEnd.getTime() - now.getTime()) / (60 * 60 * 1000)),
  );

  raw.push({
    itemKey: `tax_harvest:${new Date().getUTCFullYear()}`,
    itemType: "tax_harvest",
    ticker: null,
    hoursToEvent: hoursToYearEnd,
    templateData: {
      totalLossDollars: totalAbs,
      numPositions: losses.length,
    },
    chips: [
      {
        label: "loss",
        value: `-$${Math.round(totalAbs).toLocaleString("en-US")}`,
        tooltipKey: "loss",
      },
      {
        label: "positions",
        value: String(losses.length),
        tooltipKey: "loss",
      },
      {
        label: "wash-sale",
        value: "30d",
        tooltipKey: "wash-sale",
      },
    ],
  });
}

/**
 * Phase 4 Batch K3 — layer `short` (velocity) and `dtc` (days-to-
 * cover) chips onto every raw item whose ticker has a *material*
 * short-interest reading. Materiality threshold lives in the loader
 * (>20% velocity or >5 dtc); this function trusts whatever the
 * loader's map contains. Mutates raw in place.
 */
function enrichWithShortInterestChips(
  raw: RawItem[],
  byTicker: Map<string, ShortVelocityReading>,
): void {
  for (const r of raw) {
    if (!r.ticker) continue;
    const reading = byTicker.get(r.ticker.toUpperCase());
    if (!reading) continue;
    r.chips = [
      ...r.chips,
      {
        label: "short",
        value: formatVelocityChip(reading.velocityPct),
        tooltipKey: "short",
      },
      {
        label: "dtc",
        value: `${reading.daysToCover.toFixed(1)}d`,
        tooltipKey: "dtc",
      },
    ];
  }
}

/**
 * Phase 4 Batch K1 — emit a `cluster_buying` queue item per held
 * ticker that the loader returned a cluster signal for. The signal
 * is pre-filtered (>= 3 distinct insiders, $100k+ each, non-10b5-1)
 * so we trust whatever the loader hands us.
 *
 * Bounded by the loader's 25-ticker ceiling. Skips silently when
 * SEC EDGAR is unreachable — the signals map is simply empty.
 */
function buildClusterBuying(
  signalsByTicker: Map<string, ClusterSignal>,
  raw: RawItem[],
): void {
  for (const [ticker, signal] of signalsByTicker.entries()) {
    const totalLabel = formatClusterDollars(signal.totalDollars);
    // Compute window days from start→end (inclusive of both bounds).
    const startMs = Date.parse(signal.windowStart);
    const endMs = Date.parse(signal.windowEnd);
    const windowDays =
      Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(
            1,
            Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1,
          )
        : 14;
    raw.push({
      itemKey: `cluster_buying:${ticker}:${signal.windowStart}`,
      itemType: "cluster_buying",
      ticker,
      hoursToEvent: 24 * 7, // THIS_WEEK horizon
      templateData: {
        ticker,
        insiderCount: signal.insiderCount,
        totalDollarsLabel: totalLabel,
        windowDays,
      },
      chips: [
        {
          label: "insiders",
          value: String(signal.insiderCount),
          tooltipKey: "insiders",
        },
        {
          label: "cluster",
          value: totalLabel,
          tooltipKey: "cluster",
        },
        {
          label: "window",
          value: `${windowDays}d`,
          tooltipKey: "window",
        },
      ],
    });
  }
}

function buildYearPaceReview(
  review: ReviewSummary | null,
  raw: RawItem[],
): void {
  raw.push({
    itemKey: `year_pace_review:${new Date().getUTCFullYear()}`,
    itemType: "year_pace_review",
    ticker: null,
    hoursToEvent: null,
    templateData: {
      ytdPct: review?.portfolioYtdPct ?? 0,
      spyYtdPct: review?.spyYtdPct ?? 0,
    },
    chips: [
      {
        label: "pace",
        value: `${(review?.portfolioYtdPct ?? 0).toFixed(1)}%`,
        tooltipKey: "pace",
      },
    ],
  });
}

export async function buildQueueForUser(
  userId: string,
): Promise<QueueItem[]> {
  const [stateMap, review, outcomes] = await Promise.all([
    loadStateRows(userId),
    getReviewSummary(userId).catch((err) => {
      log.warn("queue-builder", "review fetch failed", {
        userId,
        ...errorInfo(err),
      });
      return null;
    }),
    listUnactionedOutcomes(userId).catch((err) => {
      log.warn("queue-builder", "outcomes fetch failed", {
        userId,
        ...errorInfo(err),
      });
      return [] as UnactionedOutcome[];
    }),
  ]);

  const raw: RawItem[] = [];

  buildBrokerReauth(review, raw);
  buildConcentrationBreaches(review, raw);
  buildCatalysts(review, raw);
  buildStaleRecs(review, raw);
  buildOutcomes(outcomes, raw);
  buildCashIdle(review, raw);
  buildYearPaceReview(review, raw);
  buildTaxHarvest(review, raw);
  // Phase 3 Batch F — async because the rebalance_drift emit needs the
  // non-cash portfolio value to compute the suggested rebalance amount.
  await buildGoalsAndRebalanceDrift(userId, review, raw);

  // Quality decline runs last among emitters so we can collect the
  // score map and use it to enrich existing items' chip rows in a
  // single pass.
  const qualityByTicker = await buildQualityDeclineAndCollect(review, raw);
  enrichWithQualityChips(raw, qualityByTicker);

  // Phase 2 science layer chips: 12-1 momentum (per held ticker)
  // + fractional Kelly position size (per user). Both run after
  // emitters so they only enrich existing items — they never
  // create new rows.
  const [momentumByTicker, kellyFraction] = await Promise.all([
    loadHoldingMomentum(review),
    getKellyFraction(userId).catch((err) => {
      log.warn("queue-builder", "kelly lookup failed", {
        userId,
        ...errorInfo(err),
      });
      return null;
    }),
  ]);
  enrichWithMomentumChips(raw, momentumByTicker);
  enrichWithKellyChips(raw, kellyFraction);

  // Phase 4 Batch J — REV6 analyst-revision-breadth chip on
  // stale_rec_held / catalyst_prep_imminent items. We fetch only
  // the tickers that will actually receive the chip so a 25-name
  // portfolio doesn't trigger 25 Finnhub calls when only a few
  // items will display them.
  const revisionByTicker = await loadRevisionBreadthForActionableItems(raw);
  enrichWithRev6Chips(raw, revisionByTicker);

  // Phase 4 Batch K1 — Form 4 insider cluster signal. Fetched per
  // held ticker (bounded at 25 by the loader). Emits its own
  // queue item rather than enriching existing items, so the user
  // sees an explicit "3 insiders bought $X of TICKER" headline.
  const heldTickers = (review?.holdings ?? []).map((h) =>
    h.ticker.toUpperCase(),
  );
  if (heldTickers.length > 0) {
    const clusterSignals = await getClusterBuyingSignals(heldTickers).catch(
      (err) => {
        log.warn("queue-builder", "cluster signals failed", {
          ...errorInfo(err),
        });
        return new Map<string, ClusterSignal>();
      },
    );
    buildClusterBuying(clusterSignals, raw);

    // Phase 4 Batch K3 — short-interest velocity chips. Loader filters
    // to *material* readings only, so the chip set stays signal-dense.
    // Returns an empty map until the FINRA cron is wired (deferred).
    const shortByTicker = await getShortInterestVelocities(heldTickers).catch(
      (err) => {
        log.warn("queue-builder", "short-interest fetch failed", {
          ...errorInfo(err),
        });
        return new Map<string, ShortVelocityReading>();
      },
    );
    enrichWithShortInterestChips(raw, shortByTicker);
  }

  // ---- finalize: filter state, score, sort ----
  const now = Date.now();
  const finalized: QueueItem[] = [];

  for (const r of raw) {
    const state = stateMap.get(r.itemKey);
    if (state?.status === "dismissed" || state?.status === "done") continue;
    if (
      state?.status === "snoozed" &&
      state.snoozeUntil &&
      new Date(toIso(state.snoozeUntil) ?? 0).getTime() > now
    ) {
      continue;
    }

    // Fire-and-forget surface tracking. We don't await — the queue must
    // render even if writes are degraded.
    void upsertSurfaced(userId, r.itemKey);

    const firstSurfacedAt =
      toIso(state?.firstSurfacedAt) ?? new Date().toISOString();
    const daysSinceSurfaced = daysSince(firstSurfacedAt);
    const impact = STATIC_IMPACT[r.itemType];
    const urgency = computeUrgencyScore({
      impact,
      hoursToEvent: r.hoursToEvent,
      daysSinceSurfaced,
    });
    const horizon = resolveHorizonTag({
      impact,
      hoursToEvent: r.hoursToEvent,
    });
    const link = deepLink(r.itemType, r.ticker, r.payload ?? {});
    const rendered = renderTemplate({
      itemType: r.itemType,
      ticker: r.ticker,
      data: r.templateData,
    });

    finalized.push({
      itemKey: r.itemKey,
      itemType: r.itemType,
      ticker: r.ticker,
      title: rendered.title,
      body: rendered.body,
      horizon,
      urgencyScore: urgency,
      impact,
      timeDecay: 0, // composite already applied to urgencyScore; kept for debug
      freshnessDecay: 0,
      chips: r.chips,
      primaryActionHref: link.href,
      primaryActionLabel: link.label,
      firstSurfacedAt,
      status: state?.status ?? null,
      snoozeUntil: toIso(state?.snoozeUntil),
    });
  }

  finalized.sort((a, b) => {
    if (b.urgencyScore !== a.urgencyScore) {
      return b.urgencyScore - a.urgencyScore;
    }
    return (
      new Date(b.firstSurfacedAt).getTime() -
      new Date(a.firstSurfacedAt).getTime()
    );
  });

  return finalized;
}
