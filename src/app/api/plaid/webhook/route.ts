import { NextRequest, NextResponse } from "next/server";
import {
  verifyPlaidWebhook,
  syncHoldings,
  syncTransactions,
  plaidConfigured,
} from "@/lib/plaid";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/plaid/webhook
 *
 * Plaid fires webhooks for:
 *   - INVESTMENTS_TRANSACTIONS — new transactions available
 *   - HOLDINGS: DEFAULT_UPDATE — holdings refreshed (daily cron)
 *   - ITEM: ERROR / PENDING_EXPIRATION / LOGIN_REQUIRED
 *
 * We handle them by looking up the user from `itemId` and re-syncing
 * the relevant surface. Webhook signatures are ES256 JWT-verified
 * via `verifyPlaidWebhook`. Unverified webhooks are rejected in
 * production; sandbox allows unverified with an env opt-in.
 *
 * Webhooks are the ONLY free way to keep data fresh. Don't add a
 * manual Refresh button — it triggers the $0.12/call refresh endpoint.
 */

type PlaidWebhookBody = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string; error_message?: string } | null;
  new_transactions?: number;
  removed_transactions?: string[];
};

export async function POST(req: NextRequest) {
  if (!plaidConfigured()) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  // We need the raw body (not the parsed JSON) to verify the JWT
  // body-hash claim. Read once, parse once.
  const raw = await req.text();
  const signature = req.headers.get("plaid-verification");

  const verify = await verifyPlaidWebhook(raw, signature);
  if (!verify.ok) {
    log.warn("plaid.webhook", "rejected", { reason: verify.reason });
    return NextResponse.json(
      { error: "unverified" },
      { status: 401 }
    );
  }

  let body: PlaidWebhookBody;
  try {
    body = JSON.parse(raw) as PlaidWebhookBody;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const { webhook_type: wType, webhook_code: wCode, item_id: itemId } = body;
  if (!wType || !wCode || !itemId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // Resolve userId from itemId. If we don't own this item (already
  // removed, or webhook for a stale item), 200-OK silently — Plaid
  // retries on 5xx but not 4xx/2xx.
  const { rows } = await pool.query(
    `SELECT "userId" FROM "plaid_item"
     WHERE "itemId" = $1 AND "status" <> 'removed'
     LIMIT 1`,
    [itemId]
  );
  if (rows.length === 0) {
    log.info("plaid.webhook", "unknown item (already removed?)", { itemId });
    return NextResponse.json({ ok: true });
  }
  const userId = (rows[0] as { userId: string }).userId;

  // Record the last-webhook timestamp regardless of what we do with it
  await pool
    .query(
      `UPDATE "plaid_item" SET "lastWebhookAt" = NOW(), "updatedAt" = NOW()
       WHERE "itemId" = $1`,
      [itemId]
    )
    .catch(() => {});

  log.info("plaid.webhook", "received", {
    userId,
    itemId,
    wType,
    wCode,
  });

  try {
    switch (wType) {
      case "INVESTMENTS_TRANSACTIONS": {
        // `DEFAULT_UPDATE` → new txs. `HISTORICAL_UPDATE` → first pull.
        // For both, pull last 90 days to be safe.
        await syncTransactions(userId, itemId, 90);
        // Also re-sync holdings — they often shift with transactions.
        await syncHoldings(userId, itemId);
        break;
      }
      case "HOLDINGS": {
        await syncHoldings(userId, itemId);
        break;
      }
      case "ITEM": {
        if (wCode === "ERROR" || wCode === "LOGIN_REQUIRED") {
          await pool.query(
            `UPDATE "plaid_item"
             SET "status" = 'login_required',
                 "statusDetail" = $1,
                 "updatedAt" = NOW()
             WHERE "itemId" = $2`,
            [
              body.error?.error_message ?? wCode,
              itemId,
            ]
          );
        } else if (wCode === "PENDING_EXPIRATION") {
          await pool.query(
            `UPDATE "plaid_item"
             SET "statusDetail" = 'access expiring — reauth to keep syncing',
                 "updatedAt" = NOW()
             WHERE "itemId" = $1`,
            [itemId]
          );
        }
        break;
      }
      default:
        // Unknown webhook type. Log for visibility but don't error —
        // new webhook types ship periodically; don't want retries.
        log.info("plaid.webhook", "ignored type", { wType, wCode });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("plaid.webhook", "handler failed", {
      userId,
      itemId,
      wType,
      wCode,
      ...errorInfo(err),
    });
    // 500 lets Plaid retry — they back off automatically up to 3×.
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
