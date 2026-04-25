import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/admin/health
 *
 * Founder-only operational snapshot of the Plaid + SnapTrade fleet.
 * Aggregates signals that indicate "something is wrong" before any
 * user emails support:
 *
 *   - Plaid items grouped by status (active, login_required,
 *     sync_failed, removed). Counts + sample institutions.
 *   - Stuck users: linked a brokerage but have zero holdings after
 *     30+ minutes — indicates a sync failure we haven't surfaced.
 *   - Sync lag distribution: how fresh holding data is across users.
 *   - SnapTrade connection count (baseline coverage).
 *   - User totals: total, with at least one linked brokerage, active
 *     in last 7 days.
 *
 * All numbers only — no PII leaves this endpoint, just aggregates and
 * anonymous user IDs for investigation (where needed).
 */
export const revalidate = 0;

type HealthPayload = {
  generatedAt: string;
  plaidItems: {
    byStatus: Array<{ status: string; count: number }>;
    topInstitutions: Array<{
      institutionName: string | null;
      count: number;
    }>;
  };
  stuckUsers: Array<{
    userId: string;
    email: string | null;
    institutionName: string | null;
    itemStatus: string;
    itemCreatedAt: string;
    lastWebhookAt: string | null;
    holdings: number;
  }>;
  syncLag: {
    lessThan1h: number;
    lessThan6h: number;
    lessThan24h: number;
    lessThan7d: number;
    older: number;
    neverSynced: number;
  };
  webhookHealth: {
    /** Active items that have received at least one webhook. */
    itemsWithWebhooks: number;
    /** Active items that have NEVER received a webhook (>7 days old). */
    itemsNeverReceivedWebhook: number;
    /** Active items with last webhook >14 days ago. Silent-failure signal. */
    itemsStaleWebhooks: number;
    /** Most recent webhook across any item. */
    mostRecentWebhookAt: string | null;
    /** True webhook event counts from the plaid_webhook_event log. */
    eventsLast24h: number;
    eventsLast7d: number;
    verifyFailuresLast24h: number;
    verifyFailuresLast7d: number;
    /** % of last 24h attempts that failed JWT verification. null when no
     *  events in the window. Red alert above ~5%. */
    failureRatePct: number | null;
    /** % of last 7d attempts that failed JWT verification. null when no
     *  events in the window. Detects smoldering issues below the 24h
     *  threshold. */
    failureRate7dPct: number | null;
  };
  snaptrade: {
    totalConnections: number;
    disabled: number;
  };
  users: {
    total: number;
    withBrokerage: number;
    activeLast7d: number;
  };
};

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: guard.status }
    );
  }

  try {
    // ─── Plaid items by status ────────────────────────────────────
    const { rows: statusRows } = await pool.query<{
      status: string;
      count: string;
    }>(
      `SELECT status, COUNT(*)::int AS count
         FROM "plaid_item"
        GROUP BY status
        ORDER BY count DESC`
    );

    // ─── Top institutions (Plaid) ─────────────────────────────────
    const { rows: instRows } = await pool.query<{
      institutionName: string | null;
      count: string;
    }>(
      `SELECT "institutionName", COUNT(*)::int AS count
         FROM "plaid_item"
        WHERE status <> 'removed'
        GROUP BY "institutionName"
        ORDER BY count DESC
        LIMIT 10`
    );

    // ─── Stuck users: active Item, created >30 min ago, no holdings
    //     Excludes the demo user to avoid false alerts.
    const { rows: stuckRows } = await pool.query<{
      userId: string;
      email: string | null;
      institutionName: string | null;
      itemStatus: string;
      itemCreatedAt: Date;
      lastWebhookAt: Date | null;
      holdings: number;
    }>(
      `SELECT p."userId", u.email,
              p."institutionName",
              p.status AS "itemStatus",
              p."createdAt" AS "itemCreatedAt",
              p."lastWebhookAt",
              COALESCE((
                SELECT COUNT(*)::int FROM "holding" h
                WHERE h."userId" = p."userId" AND h.source = 'plaid'
              ), 0) AS holdings
         FROM "plaid_item" p
         JOIN "user" u ON u.id = p."userId"
        WHERE p.status IN ('active', 'sync_failed', 'login_required')
          AND p."createdAt" < NOW() - INTERVAL '30 minutes'
          AND u.email <> 'demo@clearpathinvest.app'
          AND NOT EXISTS (
            SELECT 1 FROM "holding" h
            WHERE h."userId" = p."userId" AND h.source = 'plaid'
          )
        ORDER BY p."createdAt" DESC
        LIMIT 50`
    );

    // ─── Sync lag distribution (Plaid items only) ─────────────────
    const { rows: lagRows } = await pool.query<{
      bucket: string;
      count: string;
    }>(
      `SELECT
         CASE
           WHEN "lastSyncedAt" IS NULL THEN 'never'
           WHEN NOW() - "lastSyncedAt" < INTERVAL '1 hour' THEN '1h'
           WHEN NOW() - "lastSyncedAt" < INTERVAL '6 hours' THEN '6h'
           WHEN NOW() - "lastSyncedAt" < INTERVAL '24 hours' THEN '24h'
           WHEN NOW() - "lastSyncedAt" < INTERVAL '7 days' THEN '7d'
           ELSE 'older'
         END AS bucket,
         COUNT(*)::int AS count
       FROM "plaid_item"
       WHERE status <> 'removed'
       GROUP BY bucket`
    );

    const lag = {
      lessThan1h: 0,
      lessThan6h: 0,
      lessThan24h: 0,
      lessThan7d: 0,
      older: 0,
      neverSynced: 0,
    };
    for (const r of lagRows) {
      const n = Number(r.count);
      if (r.bucket === "1h") lag.lessThan1h = n;
      else if (r.bucket === "6h") lag.lessThan6h = n;
      else if (r.bucket === "24h") lag.lessThan24h = n;
      else if (r.bucket === "7d") lag.lessThan7d = n;
      else if (r.bucket === "older") lag.older = n;
      else if (r.bucket === "never") lag.neverSynced = n;
    }

    // ─── Webhook health ───────────────────────────────────────────
    //
    // Detects silent Plaid webhook failures. A Plaid Item older than
    // 14 days with no recent webhook = likely our /api/plaid/webhook
    // is rejecting signatures (401'd, Plaid has given up retrying)
    // and we're quietly serving stale data. The "never received a
    // webhook after 7 days" case is the harshest version of the same
    // failure.
    const { rows: webhookRows } = await pool.query<{
      itemsWithWebhooks: string;
      itemsNeverReceivedWebhook: string;
      itemsStaleWebhooks: string;
      mostRecentWebhookAt: Date | null;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE "lastWebhookAt" IS NOT NULL)::int AS "itemsWithWebhooks",
         COUNT(*) FILTER (
           WHERE "lastWebhookAt" IS NULL
             AND "createdAt" < NOW() - INTERVAL '7 days'
             AND status <> 'removed'
         )::int AS "itemsNeverReceivedWebhook",
         COUNT(*) FILTER (
           WHERE "lastWebhookAt" < NOW() - INTERVAL '14 days'
             AND "createdAt" < NOW() - INTERVAL '14 days'
             AND status <> 'removed'
         )::int AS "itemsStaleWebhooks",
         MAX("lastWebhookAt") AS "mostRecentWebhookAt"
       FROM "plaid_item"`
    );

    // ─── True webhook event counts (plaid_webhook_event) ──────────
    //
    // The heuristic fields above use plaid_item.lastWebhookAt to
    // detect multi-week silence. These fields use the event log to
    // detect 24-hour failure SPIKES — specifically JWT verification
    // failures, which our old handler only log-warn'd. The two
    // signals are complementary; keep both.
    const { rows: eventRows } = await pool.query<{
      eventsLast24h: string;
      eventsLast7d: string;
      verifyFailuresLast24h: string;
      verifyFailuresLast7d: string;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE "receivedAt" > NOW() - INTERVAL '24 hours'
         )::int AS "eventsLast24h",
         COUNT(*)::int AS "eventsLast7d",
         COUNT(*) FILTER (
           WHERE verified = false
             AND "receivedAt" > NOW() - INTERVAL '24 hours'
         )::int AS "verifyFailuresLast24h",
         COUNT(*) FILTER (
           WHERE verified = false
         )::int AS "verifyFailuresLast7d"
       FROM "plaid_webhook_event"
       WHERE "receivedAt" > NOW() - INTERVAL '7 days'`
    );

    const eventsLast24h = Number(eventRows[0]?.eventsLast24h ?? 0);
    const eventsLast7d = Number(eventRows[0]?.eventsLast7d ?? 0);
    const verifyFailuresLast24h = Number(
      eventRows[0]?.verifyFailuresLast24h ?? 0
    );
    const verifyFailuresLast7d = Number(
      eventRows[0]?.verifyFailuresLast7d ?? 0
    );
    const failureRatePct =
      eventsLast24h > 0
        ? Math.round((verifyFailuresLast24h / eventsLast24h) * 1000) / 10
        : null;
    const failureRate7dPct =
      eventsLast7d > 0
        ? Math.round((verifyFailuresLast7d / eventsLast7d) * 1000) / 10
        : null;

    // ─── SnapTrade connection counts ──────────────────────────────
    const { rows: snaptradeRows } = await pool.query<{
      total: string;
      disabled: string;
    }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE disabled = true)::int AS disabled
       FROM "snaptrade_connection"`
    );

    // ─── User totals ──────────────────────────────────────────────
    const { rows: userRows } = await pool.query<{
      total: string;
      withBrokerage: string;
      activeLast7d: string;
    }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM "plaid_item" p
             WHERE p."userId" = u.id AND p.status <> 'removed'
           )
           OR EXISTS (
             SELECT 1 FROM "snaptrade_connection" s
             WHERE s."userId" = u.id AND s.disabled = false
           )
         )::int AS "withBrokerage",
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM "session" se
             WHERE se."userId" = u.id
               AND se."expiresAt" > NOW() - INTERVAL '7 days'
           )
         )::int AS "activeLast7d"
       FROM "user" u
       WHERE u.email <> 'demo@clearpathinvest.app'`
    );

    const payload: HealthPayload = {
      generatedAt: new Date().toISOString(),
      plaidItems: {
        byStatus: statusRows.map((r) => ({
          status: r.status,
          count: Number(r.count),
        })),
        topInstitutions: instRows.map((r) => ({
          institutionName: r.institutionName,
          count: Number(r.count),
        })),
      },
      stuckUsers: stuckRows.map((r) => ({
        userId: r.userId,
        email: r.email,
        institutionName: r.institutionName,
        itemStatus: r.itemStatus,
        itemCreatedAt: r.itemCreatedAt.toISOString(),
        lastWebhookAt: r.lastWebhookAt?.toISOString() ?? null,
        holdings: Number(r.holdings),
      })),
      syncLag: lag,
      webhookHealth: {
        itemsWithWebhooks: Number(webhookRows[0]?.itemsWithWebhooks ?? 0),
        itemsNeverReceivedWebhook: Number(
          webhookRows[0]?.itemsNeverReceivedWebhook ?? 0
        ),
        itemsStaleWebhooks: Number(webhookRows[0]?.itemsStaleWebhooks ?? 0),
        mostRecentWebhookAt:
          webhookRows[0]?.mostRecentWebhookAt?.toISOString() ?? null,
        eventsLast24h,
        eventsLast7d,
        verifyFailuresLast24h,
        verifyFailuresLast7d,
        failureRatePct,
        failureRate7dPct,
      },
      snaptrade: {
        totalConnections: Number(snaptradeRows[0]?.total ?? 0),
        disabled: Number(snaptradeRows[0]?.disabled ?? 0),
      },
      users: {
        total: Number(userRows[0]?.total ?? 0),
        withBrokerage: Number(userRows[0]?.withBrokerage ?? 0),
        activeLast7d: Number(userRows[0]?.activeLast7d ?? 0),
      },
    };

    return NextResponse.json(payload);
  } catch (err) {
    log.error("admin.health", "query failed", {
      userId: guard.userId,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not load health data." },
      { status: 500 }
    );
  }
}
