import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import crypto from "node:crypto";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/journal/strategy-action
 *
 * Records a user's action on today's Next Move as a recommendation
 * row with source='strategy'. The Next Move text, ticker, rationale,
 * and the review date are snapshotted so the row stands on its own
 * even after portfolio_review_daily ages out.
 *
 * Body: {
 *   action: "took" | "partial" | "ignored",
 *   note?: string,
 *   selfReportedAmount?: string,
 *   actionText: string,
 *   rationale: string,
 *   ticker: string | null,
 *   consensus?: string
 * }
 *
 * Snooze and Dismiss state-only flips still use the existing
 * /api/portfolio-review/next-move-state endpoint — they don't
 * create journal rows.
 */

const VALID_ACTIONS = new Set(["took", "partial", "ignored"]);

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    action?: unknown;
    note?: unknown;
    selfReportedAmount?: unknown;
    actionText?: unknown;
    rationale?: unknown;
    ticker?: unknown;
    consensus?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "action must be took | partial | ignored" },
      { status: 400 }
    );
  }

  const actionText =
    typeof body.actionText === "string" ? body.actionText.slice(0, 500) : null;
  if (!actionText) {
    return NextResponse.json({ error: "actionText required" }, { status: 400 });
  }

  const rationale =
    typeof body.rationale === "string" ? body.rationale.slice(0, 2000) : null;
  const ticker =
    typeof body.ticker === "string" ? body.ticker.toUpperCase().slice(0, 10) : null;
  const note =
    typeof body.note === "string" && body.note.trim() !== ""
      ? body.note.trim().slice(0, 500)
      : null;
  const selfReportedAmount =
    typeof body.selfReportedAmount === "string" &&
    body.selfReportedAmount.trim() !== ""
      ? body.selfReportedAmount.trim().slice(0, 200)
      : null;
  const consensus =
    typeof body.consensus === "string" ? body.consensus.slice(0, 50) : "strategy_move";

  const id = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO "recommendation"
        (id, "userId", ticker, recommendation, confidence, consensus,
         "priceAtRec", summary, "analysisJson", "dataAsOf",
         "source", "sourcePortfolioReviewDate",
         "userAction", "userNote", "userActionAt",
         "selfReportedAmount", "reconciliationStatus")
       VALUES ($1, $2, $3, $4, 'high', $5, 0, $6, $7::jsonb, NOW(),
               'strategy', CURRENT_DATE,
               $8, $9, NOW(),
               $10, 'self_reported_only')`,
      [
        id,
        session.user.id,
        ticker ?? "N/A",
        inferRecommendationVerb(actionText),
        consensus,
        actionText,
        JSON.stringify({ source: "strategy", rationale, actionText, ticker }),
        action,
        note,
        selfReportedAmount,
      ]
    );
    log.info("journal.strategy-action", "saved", {
      userId: session.user.id,
      ticker,
      action,
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    log.error("journal.strategy-action", "insert failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not save action." },
      { status: 500 }
    );
  }
}

function inferRecommendationVerb(actionText: string): string {
  const first = actionText.trim().split(/[\s:]/)[0].toUpperCase();
  if (["REDUCE", "TRIM", "SELL"].includes(first)) return "SELL";
  if (["ADD", "INCREASE", "BUY"].includes(first)) return "BUY";
  if (["HOLD", "REVIEW"].includes(first)) return "HOLD";
  return "HOLD";
}
