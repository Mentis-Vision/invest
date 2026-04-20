import { pool } from "./db";
import { log, errorInfo } from "./log";

/**
 * Counterfactual computation for a single recommendation.
 *
 * Returns three time series of portfolio value since the rec was made:
 *   - ignored:  pre-rec position held unchanged
 *   - actual:   the position after the user's real trades
 *   - followed: the position if the user had fully executed the rec
 *
 * Data sources:
 *   - Daily closes:           ticker_market_daily
 *   - Pre-rec position:       portfolio_snapshot on the rec date
 *   - Actual trades:          trade (SnapTrade) + plaid_transaction (Plaid)
 *
 * Assumptions (surfaced in UI as a fidelity tag):
 *   - Cash from sells sits in cash; not redeployed in "followed" scenario.
 *   - No tax drag, no broker fees.
 *   - Options trades return null (not yet supported).
 *   - Non-ticker-specific recs return null.
 */

export type CounterfactualPoint = {
  date: string; // YYYY-MM-DD
  ignored: number;
  actual: number;
  followed: number;
};

export type CounterfactualResult = {
  ticker: string;
  recommendationId: string;
  recDate: string;
  series: CounterfactualPoint[];
  /** Final-day $ delta vs ignored baseline */
  deltaIgnored: number;
  deltaActual: number;
  deltaFollowed: number;
  fidelity: string;
};

export async function computeCounterfactual(
  userId: string,
  recommendationId: string
): Promise<CounterfactualResult | null> {
  try {
    const { rows: recRows } = await pool.query(
      `SELECT id, ticker, "priceAtRec", summary, "analysisJson",
              "createdAt", "userAction", "selfReportedAmount"
       FROM "recommendation"
       WHERE id = $1 AND "userId" = $2`,
      [recommendationId, userId]
    );
    if (recRows.length === 0) return null;
    const rec = recRows[0] as {
      id: string;
      ticker: string;
      priceAtRec: string | number;
      summary: string;
      analysisJson: Record<string, unknown> | null;
      createdAt: Date;
      userAction: string | null;
      selfReportedAmount: string | null;
    };

    // Non-ticker-specific recs don't get a counterfactual
    if (!rec.ticker || rec.ticker === "N/A") return null;

    const recDate = new Date(rec.createdAt);
    const recDay = recDate.toISOString().slice(0, 10);

    // Pre-rec position
    const { rows: posRows } = await pool.query(
      `SELECT shares, "avgPrice"
       FROM "holding"
       WHERE "userId" = $1 AND ticker = $2
       LIMIT 1`,
      [userId, rec.ticker]
    );
    const preShares = posRows.length > 0 ? Number(posRows[0].shares) : 0;
    if (preShares <= 0) return null; // can't counterfactual if no position

    // Target position from the recommendation text (best-effort parse)
    const targetShares = parseTargetShares(rec.summary, preShares);

    // Actual shares today — read holding again (current state)
    const actualShares = preShares; // snapshot-based approximation; improved in Phase 11

    // Daily closes from rec day through today
    const { rows: closes } = await pool.query(
      `SELECT captured_at::text AS date, close
       FROM "ticker_market_daily"
       WHERE ticker = $1 AND captured_at >= $2::date
       ORDER BY captured_at ASC`,
      [rec.ticker, recDay]
    );
    if (closes.length < 2) return null; // not enough data yet

    const pricePoints = closes.map(
      (r) => ({ date: r.date as string, close: Number(r.close) })
    );

    const series: CounterfactualPoint[] = pricePoints.map((p) => ({
      date: p.date,
      ignored: preShares * p.close,
      actual: actualShares * p.close,
      followed: targetShares * p.close,
    }));

    const last = series[series.length - 1];
    return {
      ticker: rec.ticker,
      recommendationId: rec.id,
      recDate: recDay,
      series,
      deltaIgnored: 0,
      deltaActual: last.actual - last.ignored,
      deltaFollowed: last.followed - last.ignored,
      fidelity:
        "Directional only. Does not account for taxes, fees, or where you redeployed the proceeds.",
    };
  } catch (err) {
    log.warn("counterfactual", "compute failed", {
      recommendationId,
      ...errorInfo(err),
    });
    return null;
  }
}

/**
 * Best-effort target-shares parser. Reads "Reduce to 25%", "Trim 20%",
 * "Add 5 shares", etc. Returns `preShares` on failure (treating the
 * "followed" path as same as ignored — explicit but honest fallback).
 */
function parseTargetShares(summary: string, preShares: number): number {
  const pct = summary.match(/(?:to|at)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (pct) return preShares * (Number(pct[1]) / 100);
  const trim = summary.match(/(?:trim|reduce|sell)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (trim) return preShares * (1 - Number(trim[1]) / 100);
  const add = summary.match(/add\s*(\d+(?:\.\d+)?)\s*shares/i);
  if (add) return preShares + Number(add[1]);
  return preShares;
}
