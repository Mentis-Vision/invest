import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { syncHoldings, syncTransactions, removePlaidItem } from "@/lib/plaid";
import { log, errorInfo } from "@/lib/log";

/**
 * GET  /api/plaid/items
 *   List the current user's linked Plaid Items. Shows status,
 *   institution, last sync / webhook timestamps, and how many
 *   holdings are attributed to each. Never returns the access_token.
 *
 * POST /api/plaid/items  { action: "sync", itemId }
 *   Force a holdings + transactions re-sync for one of the user's
 *   own Items. Subject to rate-limit (max once per 5 minutes per Item)
 *   so users can't spam this into a spend spike.
 *
 * POST /api/plaid/items  { action: "remove", itemId }
 *   Disconnect the Item (calls Plaid's /item/remove, marks local
 *   status = removed, wipes Plaid-sourced holdings for that Item).
 *   `/item/remove` is FREE — it's the only reliable way to stop
 *   the $0.35/Item/month subscription charge.
 */

type PlaidItemRow = {
  id: string;
  itemId: string;
  institutionName: string | null;
  status: string;
  statusDetail: string | null;
  lastSyncedAt: Date | null;
  lastWebhookAt: Date | null;
  createdAt: Date;
  holdingsCount: number;
};

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         p.id, p."itemId", p."institutionName", p.status, p."statusDetail",
         p."lastSyncedAt", p."lastWebhookAt", p."createdAt",
         COALESCE((
           SELECT COUNT(*)::int FROM "holding" h
           WHERE h."userId" = p."userId"
             AND h.source = 'plaid'
             AND h."plaidAccountId" IN (
               SELECT "plaidAccountId" FROM "plaid_account"
               WHERE "itemId" = p."itemId"
             )
         ), 0) AS "holdingsCount"
       FROM "plaid_item" p
       WHERE p."userId" = $1 AND p.status <> 'removed'
       ORDER BY p."createdAt" DESC`,
      [session.user.id]
    );

    const items = (rows as PlaidItemRow[]).map((r) => ({
      id: r.id,
      itemId: r.itemId,
      institutionName: r.institutionName,
      status: r.status,
      statusDetail: r.statusDetail,
      lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
      lastWebhookAt: r.lastWebhookAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      holdingsCount: r.holdingsCount,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    log.error("plaid.items.list", "failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not list connections." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: unknown; itemId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;
  const itemId = typeof body.itemId === "string" ? body.itemId : null;
  if (!itemId) {
    return NextResponse.json({ error: "itemId required" }, { status: 400 });
  }

  // Ownership check
  const { rows: own } = await pool.query(
    `SELECT id FROM "plaid_item"
     WHERE "userId" = $1 AND "itemId" = $2`,
    [session.user.id, itemId]
  );
  if (own.length === 0) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (action === "remove") {
    try {
      await removePlaidItem(session.user.id, itemId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      log.error("plaid.items.remove", "failed", {
        userId: session.user.id,
        itemId,
        ...errorInfo(err),
      });
      return NextResponse.json(
        { error: "Could not disconnect." },
        { status: 500 }
      );
    }
  }

  if (action === "sync") {
    // Cheap rate-gate: reject if last sync was <5 min ago. Prevents
    // a user from mashing the button and driving up compute.
    const { rows: tr } = await pool.query(
      `SELECT "lastSyncedAt" FROM "plaid_item"
       WHERE "itemId" = $1`,
      [itemId]
    );
    const last = (tr[0] as { lastSyncedAt: Date | null } | undefined)
      ?.lastSyncedAt;
    if (last && Date.now() - last.getTime() < 5 * 60 * 1000) {
      const waitSec = Math.ceil(
        (5 * 60 * 1000 - (Date.now() - last.getTime())) / 1000
      );
      return NextResponse.json(
        {
          error: `Recently synced. Try again in ${waitSec}s.`,
          retryAfterSec: waitSec,
        },
        { status: 429, headers: { "Retry-After": String(waitSec) } }
      );
    }
    try {
      const hres = await syncHoldings(session.user.id, itemId);
      const tres = await syncTransactions(session.user.id, itemId, 30);
      return NextResponse.json({
        ok: true,
        holdings: hres.holdings,
        transactions: tres.inserted,
      });
    } catch (err) {
      log.error("plaid.items.sync", "failed", {
        userId: session.user.id,
        itemId,
        ...errorInfo(err),
      });
      return NextResponse.json(
        { error: "Could not sync." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
