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
          ? `/app/research?ticker=${encodeURIComponent(ticker)}`
          : "/app/research",
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
      return { href: "/app/portfolio", label: "Allocate" };
    case "year_pace_review":
      return { href: "/app/history", label: "View pace" };
    case "quality_decline":
      return {
        href: ticker
          ? `/app/research?ticker=${encodeURIComponent(ticker)}`
          : "/app/research",
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

  // Quality decline runs last among emitters so we can collect the
  // score map and use it to enrich existing items' chip rows in a
  // single pass.
  const qualityByTicker = await buildQualityDeclineAndCollect(review, raw);
  enrichWithQualityChips(raw, qualityByTicker);

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
