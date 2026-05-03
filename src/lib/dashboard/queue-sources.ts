// src/lib/dashboard/queue-sources.ts
// Thin adapter layer between queue-builder.ts and the underlying data
// modules (portfolio-review, recommendation_outcome). Exposes the rich
// shape that queue-builder needs without modifying source modules.
//
// In Phase 1 the underlying portfolio-review pipeline does not yet
// produce concentration breaches, cash-idle, upcoming catalysts, or
// stale-rec lists in a structured form — those are computed by later
// passes. For now this adapter returns the fields it can derive cheaply
// and leaves the rest undefined; queue-builder treats undefined as
// "not present" and skips the corresponding item type.
//
// Tests mock this module directly so the queue-builder's composition
// logic can be exercised against arbitrary input shapes without standing
// up the full portfolio-review pipeline.

import { pool } from "../db";
import { log, errorInfo } from "../log";
import { getCachedPortfolioReview } from "../portfolio-review";

export interface ReviewBreach {
  ticker: string;
  weight: number;
  cap: number;
  nextEvent?: string | null;
  tradeQuality?: number;
}

export interface ReviewCatalyst {
  ticker: string;
  eventName: string | null;
  eventDate: string;
  daysToEvent: number;
  priorReaction?: string | null;
  currentPct?: number;
}

export interface ReviewStaleRec {
  ticker: string;
  recommendationId: string;
  daysAgo: number;
  moveSinceRec: string | number;
  originalVerdict: string;
  priceAtRec: number;
  isHeld: boolean;
}

export interface ReviewCashIdle {
  amount: number;
  daysIdle: number;
  numCandidates?: number;
}

export type BrokerStatus =
  | "active"
  | "reauth_required"
  | "disconnected"
  | "none";

export interface ReviewSummary {
  brokerStatus: BrokerStatus;
  brokerName?: string | null;
  holdings: Array<{ ticker: string; weight: number }>;
  concentrationBreaches: ReviewBreach[];
  upcomingCatalysts: ReviewCatalyst[];
  staleRecs: ReviewStaleRec[];
  cashIdle: ReviewCashIdle | null;
  portfolioYtdPct?: number;
  spyYtdPct?: number;
}

export interface UnactionedOutcome {
  recommendationId: string;
  ticker: string;
  outcomeMove: number;
  outcomeVerdict: string;
  originalDate: string;
  originalVerdict: string;
}

/**
 * Build the queue-builder's view of a user's portfolio state.
 *
 * Reads the cached daily portfolio review (zero AI cost — same row the
 * dashboard already uses) and infers broker status from Plaid + SnapTrade
 * connection rows. Other rich fields default to empty / null in Phase 1
 * and are filled in by later phases.
 */
export async function getReviewSummary(
  userId: string,
): Promise<ReviewSummary | null> {
  // Phase 1: derive broker status from connection state. Even without a
  // cached review row we still want broker_reauth to surface, so this
  // runs unconditionally.
  const brokerStatus = await deriveBrokerStatus(userId);
  const review = await getCachedPortfolioReview(userId).catch(() => null);

  if (!review && brokerStatus.status === "none") {
    // No data at all — caller will fall through to the always-on
    // year_pace_review item.
    return null;
  }

  return {
    brokerStatus: brokerStatus.status,
    brokerName: brokerStatus.brokerName,
    holdings: [],
    concentrationBreaches: [],
    upcomingCatalysts: [],
    staleRecs: [],
    cashIdle: null,
    portfolioYtdPct: undefined,
    spyYtdPct: undefined,
  };
}

async function deriveBrokerStatus(
  userId: string,
): Promise<{ status: BrokerStatus; brokerName: string | null }> {
  try {
    const { rows: plaidItems } = await pool.query<{
      status: string;
      institutionName: string | null;
    }>(
      `SELECT status, "institutionName"
         FROM "plaid_item"
        WHERE "userId" = $1 AND status <> 'removed'
        ORDER BY "createdAt" DESC`,
      [userId],
    );

    const reauth = plaidItems.find((p) => p.status === "login_required");
    if (reauth) {
      return {
        status: "reauth_required",
        brokerName: reauth.institutionName,
      };
    }

    const { rows: snaptrade } = await pool.query<{ id: string }>(
      `SELECT id FROM "snaptrade_connection" WHERE "userId" = $1 LIMIT 1`,
      [userId],
    );

    if (plaidItems.length === 0 && snaptrade.length === 0) {
      return { status: "none", brokerName: null };
    }
    return {
      status: "active",
      brokerName: plaidItems[0]?.institutionName ?? null,
    };
  } catch (err) {
    log.warn("queue-sources", "deriveBrokerStatus failed", {
      userId,
      ...errorInfo(err),
    });
    return { status: "none", brokerName: null };
  }
}

/**
 * Recommendations whose latest evaluated outcome has not yet been
 * marked by the user (`recommendation.userAction IS NULL`). These
 * surface as "outcome_action_mark" items in the Decision Queue,
 * prompting the user to confirm whether they took/ignored the call.
 */
export async function listUnactionedOutcomes(
  userId: string,
): Promise<UnactionedOutcome[]> {
  try {
    const { rows } = await pool.query<{
      recommendationId: string;
      ticker: string;
      percentMove: string | number | null;
      verdict: string | null;
      createdAt: Date;
      recommendation: string;
    }>(
      `SELECT r.id              AS "recommendationId",
              r.ticker          AS ticker,
              r.recommendation  AS recommendation,
              r."createdAt"     AS "createdAt",
              o."percentMove"   AS "percentMove",
              o.verdict         AS verdict
         FROM "recommendation" r
         JOIN "recommendation_outcome" o ON o."recommendationId" = r.id
        WHERE r."userId" = $1
          AND r."userAction" IS NULL
          AND o.status = 'completed'
        ORDER BY o."evaluatedAt" DESC NULLS LAST
        LIMIT 25`,
      [userId],
    );
    return rows.map((r) => ({
      recommendationId: r.recommendationId,
      ticker: r.ticker,
      outcomeMove:
        r.percentMove !== null && r.percentMove !== undefined
          ? Number(r.percentMove) / 100
          : 0,
      outcomeVerdict: r.verdict ?? "scored",
      originalDate: r.createdAt
        ? r.createdAt.toISOString().slice(0, 10)
        : "earlier",
      originalVerdict: r.recommendation ?? "HOLD",
    }));
  } catch (err) {
    log.warn("queue-sources", "listUnactionedOutcomes failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}
