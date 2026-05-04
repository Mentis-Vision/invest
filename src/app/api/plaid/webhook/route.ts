import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import {
  verifyPlaidWebhook,
  syncHoldings,
  syncTransactions,
  plaidConfigured,
} from "@/lib/plaid";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";
import { enqueueJob } from "@/lib/broker-history/queue";

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

  // Observability: every webhook attempt is recorded in
  // `plaid_webhook_event` regardless of verify/handler outcome.
  // Populated throughout the flow; persisted exactly once in the
  // finally block below. Fire-and-forget — a DB hiccup must never
  // block webhook delivery because Plaid only retries on 5xx, and
  // retries on observability-write-failure would be wrong.
  const eventRow: {
    verified: boolean;
    itemId: string | null;
    webhookType: string | null;
    webhookCode: string | null;
    errorReason: string | null;
    payloadSample: string | null;
  } = {
    verified: false,
    itemId: null,
    webhookType: null,
    webhookCode: null,
    errorReason: null,
    payloadSample: null,
  };

  try {
    const verify = await verifyPlaidWebhook(raw, signature);
    if (!verify.ok) {
      eventRow.errorReason = (verify.reason ?? "verify failed").slice(0, 500);
      // Keep the raw body on failures — it's the only place we can
      // later inspect a sender claiming to be Plaid. Plaid webhook
      // bodies never contain access tokens (only item_id + scope
      // codes), so the 500-char cap + CHECK constraint is safe.
      eventRow.payloadSample = raw.slice(0, 500);
      log.warn("plaid.webhook", "rejected", { reason: verify.reason });
      return NextResponse.json({ error: "unverified" }, { status: 401 });
    }
    eventRow.verified = true;

    let body: PlaidWebhookBody;
    try {
      body = JSON.parse(raw) as PlaidWebhookBody;
    } catch {
      eventRow.errorReason = "bad json";
      eventRow.payloadSample = raw.slice(0, 500);
      return NextResponse.json({ error: "bad json" }, { status: 400 });
    }

    const { webhook_type: wType, webhook_code: wCode, item_id: itemId } = body;
    eventRow.webhookType = wType ?? null;
    eventRow.webhookCode = wCode ?? null;
    eventRow.itemId = itemId ?? null;

    if (!wType || !wCode || !itemId) {
      eventRow.errorReason = "missing fields";
      eventRow.payloadSample = raw.slice(0, 500);
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
      eventRow.errorReason = "unknown item";
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

          // On HISTORICAL_UPDATE, Plaid is signalling the first
          // historical transaction pull is ready. Enqueue a
          // full_backfill job for every account on this item so the
          // broker-history worker (every 5 min) picks it up and
          // reconstructs the historical snapshot timeline. The 90-day
          // syncTransactions above only covers recent activity — this
          // schedules the deeper 24-month pull via the loader.
          if (wCode === "HISTORICAL_UPDATE") {
            const { rows: accts } = await pool.query<{
              plaidAccountId: string;
            }>(
              `SELECT "plaidAccountId"
               FROM "plaid_account"
               WHERE "userId" = $1 AND "itemId" = $2`,
              [userId, itemId]
            );
            // waitUntil so the enqueue completes after we ack the
            // webhook — Plaid only retries on 5xx and we don't want a
            // queue-write hiccup to cascade into webhook retries.
            waitUntil(
              (async () => {
                let enqueued = 0;
                for (const a of accts) {
                  try {
                    await enqueueJob(
                      userId,
                      "plaid",
                      a.plaidAccountId,
                      "full_backfill"
                    );
                    enqueued++;
                  } catch (err) {
                    log.warn(
                      "plaid.webhook",
                      "broker-history enqueue failed",
                      {
                        userId,
                        plaidAccountId: a.plaidAccountId,
                        ...errorInfo(err),
                      }
                    );
                  }
                }
                log.info("plaid.webhook", "enqueued full_backfill", {
                  userId,
                  itemId,
                  accountCount: accts.length,
                  enqueued,
                });
              })()
            );
          }
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
              [body.error?.error_message ?? wCode, itemId]
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
      const msg = err instanceof Error ? err.message : "handler failed";
      eventRow.errorReason = msg.slice(0, 500);
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
  } finally {
    // Persist exactly once per request. `waitUntil` registers the
    // Promise with Vercel's Fluid Compute runtime so it is allowed
    // to complete after the response is sent but before the function
    // instance can be suspended. Without this wrapper a bare
    // fire-and-forget Promise can be frozen mid-flight and silently
    // lose the event row.
    //
    // The INSERT itself still cannot block webhook delivery — errors
    // only affect admin visibility (backstopped by the warn log).
    waitUntil(
      pool
        .query(
          `INSERT INTO "plaid_webhook_event"
             (id, verified, "itemId", "webhookType", "webhookCode",
              "errorReason", "payloadSample")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            crypto.randomUUID(),
            eventRow.verified,
            eventRow.itemId,
            eventRow.webhookType,
            eventRow.webhookCode,
            eventRow.errorReason,
            eventRow.payloadSample,
          ]
        )
        .catch((err) => {
          log.warn("plaid.webhook", "event persist failed", errorInfo(err));
        })
    );
  }
}
