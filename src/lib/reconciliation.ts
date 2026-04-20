import { pool } from "./db";
import { log, errorInfo } from "./log";
import crypto from "node:crypto";

/**
 * Nightly reconciliation of broker trades against self-reported
 * actions, plus auto-creation of ad-hoc rows for orphan trades.
 *
 * Runs after both SnapTrade and Plaid syncs have pulled fresh data
 * from the last 48 hours.
 *
 * Actual column names (verified against Neon schema 2026-04-19):
 *
 *   trade table:
 *     - executedAt (timestamp) — NOT tradeDate
 *     - type       (text)      — NOT side
 *     - shares     (numeric)   — NOT quantity
 *
 *   plaid_transaction table:
 *     - tradeDate  (date)      ✓
 *     - type       (text)      ✓
 *     - quantity   (numeric, nullable)  ✓
 *     - ticker     (text, nullable) — must filter IS NOT NULL
 *
 * Thresholds:
 *   - Match window: trade date within [rec.createdAt, rec.createdAt + 7 days]
 *   - Same direction (SELL-vs-trim / BUY-vs-add) required for a match
 *   - Amount mismatch threshold: ±10% on shares or percentage
 */

const MATCH_WINDOW_DAYS = 7;
const MISMATCH_THRESHOLD = 0.1;

export async function reconcileUser(userId: string): Promise<{
  matched: number;
  adHocCreated: number;
  mismatches: number;
}> {
  // Pull unreconciled recs (self-reported but not yet verified against a trade)
  const { rows: recs } = await pool.query<{
    id: string;
    ticker: string;
    recommendation: string;
    selfReportedAmount: string | null;
    createdAt: Date;
    userActionAt: Date | null;
  }>(
    `SELECT id, ticker, recommendation, "selfReportedAmount",
            "createdAt", "userActionAt"
     FROM "recommendation"
     WHERE "userId" = $1
       AND "userAction" IS NOT NULL
       AND "reconciliationStatus" = 'self_reported_only'
       AND "createdAt" >= NOW() - INTERVAL '30 days'`,
    [userId]
  );

  // Pull recent trades from SnapTrade (trade table) and Plaid (plaid_transaction).
  // Actual column names differ from the plan spec — see header comment above.
  const { rows: trades } = await pool.query<{
    tradeDate: Date;
    ticker: string;
    side: string;
    quantity: number;
    source: string;
  }>(
    `SELECT "executedAt" AS "tradeDate",
            ticker,
            type AS side,
            shares AS quantity,
            'snaptrade' AS source
     FROM "trade"
     WHERE "userId" = $1
       AND "executedAt" >= NOW() - INTERVAL '14 days'
     UNION ALL
     SELECT "tradeDate"::timestamp AS "tradeDate",
            ticker,
            type AS side,
            COALESCE(quantity, 0) AS quantity,
            'plaid' AS source
     FROM "plaid_transaction"
     WHERE "userId" = $1
       AND "tradeDate" >= NOW() - INTERVAL '14 days'
       AND ticker IS NOT NULL`,
    [userId]
  );

  let matched = 0;
  let adHocCreated = 0;
  let mismatches = 0;
  const claimedTradeKeys = new Set<string>();

  for (const rec of recs) {
    const windowEnd = new Date(rec.createdAt.getTime() + MATCH_WINDOW_DAYS * 864e5);
    const direction = rec.recommendation.toUpperCase().includes("SELL")
      ? "sell"
      : rec.recommendation.toUpperCase().includes("BUY")
        ? "buy"
        : null;

    const match = trades.find(
      (t) =>
        t.ticker === rec.ticker &&
        t.tradeDate >= rec.createdAt &&
        t.tradeDate <= windowEnd &&
        (direction === null || t.side.toLowerCase().includes(direction)) &&
        !claimedTradeKeys.has(`${t.ticker}-${t.tradeDate.toISOString()}`)
    );

    if (!match) continue;
    claimedTradeKeys.add(`${match.ticker}-${match.tradeDate.toISOString()}`);
    matched++;

    const actualQty = Number(match.quantity);
    const selfQty = parseSelfReportedQty(rec.selfReportedAmount);
    let status: "verified" | "mismatch_more" | "mismatch_less" = "verified";
    if (selfQty != null && actualQty > 0) {
      const diff = (actualQty - selfQty) / selfQty;
      if (diff > MISMATCH_THRESHOLD) status = "mismatch_more";
      else if (diff < -MISMATCH_THRESHOLD) status = "mismatch_less";
    }
    if (status !== "verified") mismatches++;

    await pool.query(
      `UPDATE "recommendation"
       SET "actualAmount" = $1,
           "reconciliationStatus" = $2,
           "reconciledAt" = NOW()
       WHERE id = $3`,
      [actualQty, status, rec.id]
    );
  }

  // Any trade not matched to a rec → create an ad-hoc row so the Journal
  // reflects every portfolio change, even ones the user didn't log first.
  for (const t of trades) {
    const key = `${t.ticker}-${t.tradeDate.toISOString()}`;
    if (claimedTradeKeys.has(key)) continue;

    // Skip if an ad_hoc row already exists for this exact ticker + date
    const tradeDateStr = t.tradeDate.toISOString().slice(0, 10);
    const { rows: dup } = await pool.query(
      `SELECT 1 FROM "recommendation"
       WHERE "userId" = $1
         AND ticker = $2
         AND source = 'ad_hoc'
         AND "dataAsOf"::date = $3::date
       LIMIT 1`,
      [userId, t.ticker, tradeDateStr]
    );
    if (dup.length > 0) continue;

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO "recommendation"
        (id, "userId", ticker, recommendation, confidence, consensus,
         "priceAtRec", summary, "analysisJson", "dataAsOf",
         source, "actualAmount", "reconciliationStatus", "reconciledAt")
       VALUES ($1,$2,$3,$4,'high','ad_hoc',0,$5,'{}'::jsonb,$6,
               'ad_hoc',$7,'actual_only',NOW())`,
      [
        id,
        userId,
        t.ticker,
        t.side.toUpperCase().includes("SELL") ? "SELL" : "BUY",
        `Ad-hoc trade: ${t.side} ${t.quantity} ${t.ticker}`,
        t.tradeDate,
        Number(t.quantity),
      ]
    );
    adHocCreated++;
  }

  log.info("reconciliation", "user processed", {
    userId,
    matched,
    adHocCreated,
    mismatches,
  });

  return { matched, adHocCreated, mismatches };
}

function parseSelfReportedQty(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*shares/i);
  if (m) return Number(m[1]);
  return null;
}

export async function reconcileAllUsers(): Promise<{
  users: number;
  totals: { matched: number; adHocCreated: number; mismatches: number };
}> {
  // Union of users with any broker trade in the last 14 days.
  // trade uses executedAt; plaid_transaction uses tradeDate.
  const { rows } = await pool.query<{ userId: string }>(
    `SELECT DISTINCT "userId"
     FROM "trade"
     WHERE "executedAt" >= NOW() - INTERVAL '14 days'
     UNION
     SELECT DISTINCT "userId"
     FROM "plaid_transaction"
     WHERE "tradeDate" >= NOW() - INTERVAL '14 days'
       AND ticker IS NOT NULL`
  );

  const totals = { matched: 0, adHocCreated: 0, mismatches: 0 };
  for (const r of rows) {
    try {
      const res = await reconcileUser(r.userId);
      totals.matched += res.matched;
      totals.adHocCreated += res.adHocCreated;
      totals.mismatches += res.mismatches;
    } catch (err) {
      log.warn("reconciliation", "user failed", {
        userId: r.userId,
        ...errorInfo(err),
      });
    }
  }
  return { users: rows.length, totals };
}
