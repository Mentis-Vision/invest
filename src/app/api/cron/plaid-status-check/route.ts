import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";
import { sendEmail, renderEmailTemplate } from "@/lib/email";
import {
  createLinkToken,
  plaidConfigured,
  plaidEnvName,
} from "@/lib/plaid";
import { DEMO_USER_EMAIL } from "@/lib/admin";

/**
 * Daily Plaid status heartbeat — 09:00 UTC (5am ET).
 *
 * What it does, in order:
 *   1. Synthetic health check — attempt `createLinkToken` against the
 *      founder's user id. If this 400/500s, our Plaid integration is
 *      broken (credentials rotated, client_id revoked, etc.) and the
 *      founder needs to act.
 *   2. Fleet rollup — count Plaid Items by status, fleet-level sync
 *      freshness, webhook activity in the last 24h, verify-failure
 *      count from the event log.
 *   3. Assemble a single ops email to the founder with:
 *      - Health status (green / red)
 *      - Counts to the admin dashboard
 *      - Direct link to the OAuth institutions status page in Plaid's
 *        dashboard (the page where Schwab / Fidelity / Vanguard /
 *        Robinhood registration states show Active / Pending / Action
 *        Required).
 *
 * The email is sent every day regardless — a daily heartbeat also
 * surfaces "the cron stopped running" as "I didn't get my email." A
 * silent monitor is worse than a chatty one.
 *
 * Why not poll per-institution status directly: Plaid does not expose
 * a client-specific per-institution enablement API. The `activity/
 * status/oauth-institutions` dashboard surface is HTML-rendered from
 * internal state that isn't available to us. So we do the two things
 * we CAN do — proving our integration still works and showing the
 * admin where to click — and leave the institution-level sign-off to
 * the human.
 */

export const maxDuration = 120;

const FOUNDER_EMAIL = "sang@mentisvision.com";
const PLAID_STATUS_URL =
  "https://dashboard.plaid.com/activity/status/oauth-institutions";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron.plaid-status", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!plaidConfigured()) {
    log.warn("cron.plaid-status", "plaid not configured, skipping");
    return NextResponse.json({ skipped: "plaid_not_configured" });
  }

  const started = Date.now();

  // 1. Health check — is linkTokenCreate still working?
  const healthResult = await probePlaidHealth();

  // 2. Fleet rollup
  const fleet = await collectFleetStats();

  // 3. Send digest
  try {
    const { subject, html } = renderDigest({
      health: healthResult,
      fleet,
      env: plaidEnvName(),
    });
    const res = await sendEmail({
      to: FOUNDER_EMAIL,
      subject,
      html,
      tags: [{ name: "category", value: "ops_digest" }],
    });
    if (!res.ok && !res.skipped) {
      log.error("cron.plaid-status", "email send failed", { to: FOUNDER_EMAIL });
    }
  } catch (err) {
    log.error("cron.plaid-status", "digest render/send failed", errorInfo(err));
  }

  const durationMs = Date.now() - started;
  log.info("cron.plaid-status", "run complete", {
    healthy: healthResult.healthy,
    durationMs,
    activeItems: fleet.activeItems,
    needsAttention: fleet.needsAttention,
  });

  return NextResponse.json({
    ok: true,
    healthy: healthResult.healthy,
    durationMs,
    fleet,
  });
}

// ─── Health check ─────────────────────────────────────────────────────

type HealthResult = {
  healthy: boolean;
  message: string;
  plaidErrorCode?: string;
};

async function probePlaidHealth(): Promise<HealthResult> {
  // Probe with a founder-owned userId from the DB — avoids creating
  // synthetic records in Plaid's logs against ids that don't map to
  // any real user. If the founder row doesn't exist, fall back to a
  // deterministic probe id.
  let probeUserId = "health-check-probe";
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM "user" WHERE email = $1 LIMIT 1`,
      [FOUNDER_EMAIL]
    );
    if (rows[0]?.id) probeUserId = rows[0].id;
  } catch {
    /* non-fatal; fall through with the probe id */
  }

  try {
    const token = await createLinkToken({ userId: probeUserId });
    return {
      healthy: true,
      message: `linkTokenCreate succeeded (prefix ${token.slice(0, 20)}…)`,
    };
  } catch (err) {
    const plaidData =
      (err as { response?: { data?: unknown } })?.response?.data ?? null;
    const plaidError = plaidData as {
      error_code?: string;
      error_message?: string;
    } | null;
    return {
      healthy: false,
      message:
        plaidError?.error_message ??
        (err instanceof Error ? err.message : "unknown Plaid error"),
      plaidErrorCode: plaidError?.error_code,
    };
  }
}

// ─── Fleet stats ──────────────────────────────────────────────────────

type FleetStats = {
  activeItems: number;
  loginRequired: number;
  syncFailed: number;
  removed: number;
  itemsWithStaleWebhook: number;
  eventsLast24h: number;
  verifyFailuresLast24h: number;
  usersWithBrokerage: number;
  needsAttention: number;
};

async function collectFleetStats(): Promise<FleetStats> {
  const emptyStats: FleetStats = {
    activeItems: 0,
    loginRequired: 0,
    syncFailed: 0,
    removed: 0,
    itemsWithStaleWebhook: 0,
    eventsLast24h: 0,
    verifyFailuresLast24h: 0,
    usersWithBrokerage: 0,
    needsAttention: 0,
  };

  try {
    const [itemRows, webhookRows, eventRows, userRows] = await Promise.all([
      pool.query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::int AS count FROM "plaid_item"
         GROUP BY status`
      ),
      pool.query<{ stale: string }>(
        `SELECT COUNT(*)::int AS stale
           FROM "plaid_item"
          WHERE status <> 'removed'
            AND "createdAt" < NOW() - INTERVAL '14 days'
            AND ("lastWebhookAt" IS NULL
                 OR "lastWebhookAt" < NOW() - INTERVAL '14 days')`
      ),
      pool.query<{
        eventsLast24h: string;
        verifyFailuresLast24h: string;
      }>(
        `SELECT
           COUNT(*)::int AS "eventsLast24h",
           COUNT(*) FILTER (WHERE verified = false)::int AS "verifyFailuresLast24h"
         FROM "plaid_webhook_event"
         WHERE "receivedAt" > NOW() - INTERVAL '24 hours'`
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(DISTINCT u.id)::int AS count
           FROM "user" u
          WHERE u.email <> $1
            AND EXISTS (
              SELECT 1 FROM "plaid_item" p
              WHERE p."userId" = u.id AND p.status <> 'removed'
            )`,
        [DEMO_USER_EMAIL]
      ),
    ]);

    const stats = { ...emptyStats };
    for (const r of itemRows.rows) {
      const n = Number(r.count);
      if (r.status === "active") stats.activeItems = n;
      else if (r.status === "login_required") stats.loginRequired = n;
      else if (r.status === "sync_failed") stats.syncFailed = n;
      else if (r.status === "removed") stats.removed = n;
    }
    stats.itemsWithStaleWebhook = Number(webhookRows.rows[0]?.stale ?? 0);
    stats.eventsLast24h = Number(eventRows.rows[0]?.eventsLast24h ?? 0);
    stats.verifyFailuresLast24h = Number(
      eventRows.rows[0]?.verifyFailuresLast24h ?? 0
    );
    stats.usersWithBrokerage = Number(userRows.rows[0]?.count ?? 0);
    stats.needsAttention =
      stats.loginRequired +
      stats.syncFailed +
      stats.itemsWithStaleWebhook +
      stats.verifyFailuresLast24h;
    return stats;
  } catch (err) {
    log.error("cron.plaid-status", "fleet query failed", errorInfo(err));
    return emptyStats;
  }
}

// ─── Email rendering ──────────────────────────────────────────────────

function renderDigest(input: {
  health: HealthResult;
  fleet: FleetStats;
  env: string;
}): { subject: string; html: string } {
  const { health, fleet, env } = input;

  const statusIcon = health.healthy ? "✅" : "❌";
  const subject = health.healthy
    ? fleet.needsAttention > 0
      ? `Plaid: ${fleet.needsAttention} item${
          fleet.needsAttention === 1 ? "" : "s"
        } needs attention`
      : `Plaid: all clear (${fleet.activeItems} active Item${
          fleet.activeItems === 1 ? "" : "s"
        })`
    : `Plaid: INTEGRATION BROKEN — ${health.plaidErrorCode ?? "unknown error"}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:18px">Plaid daily status · ${env}</h2>

    <p style="margin:0 0 16px">
      <strong>${statusIcon} Integration health:</strong>
      ${escape(health.message)}
    </p>

    ${
      fleet.needsAttention === 0
        ? `<p style="margin:0 0 16px;color:#15803d">
             No items need attention today.
           </p>`
        : `<p style="margin:0 0 16px;color:#b45309">
             <strong>${fleet.needsAttention} item${
               fleet.needsAttention === 1 ? "" : "s"
             } needs attention.</strong>
           </p>`
    }

    <table style="border-collapse:collapse;font-size:13px;margin-bottom:16px">
      <tr><td style="padding:4px 12px 4px 0">Users with a linked brokerage</td>
          <td style="padding:4px 0"><strong>${fleet.usersWithBrokerage}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0">Active Plaid Items</td>
          <td style="padding:4px 0"><strong>${fleet.activeItems}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#b45309">Needs re-auth</td>
          <td style="padding:4px 0;color:#b45309"><strong>${fleet.loginRequired}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#b45309">Sync failed</td>
          <td style="padding:4px 0;color:#b45309"><strong>${fleet.syncFailed}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#dc2626">Items with webhook silence &gt;14d</td>
          <td style="padding:4px 0;color:#dc2626"><strong>${fleet.itemsWithStaleWebhook}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0">Webhooks received (24h)</td>
          <td style="padding:4px 0"><strong>${fleet.eventsLast24h}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#dc2626">Verify failures (24h)</td>
          <td style="padding:4px 0;color:#dc2626"><strong>${fleet.verifyFailuresLast24h}</strong></td></tr>
    </table>

    <p style="margin:0 0 8px;font-size:13px">
      <strong>Manual checks</strong>
    </p>
    <ul style="margin:0 0 16px;padding-left:20px;font-size:13px;line-height:1.6">
      <li>
        Plaid institution registration status (Schwab, Fidelity, Vanguard,
        Robinhood, E*TRADE):
        <a href="${PLAID_STATUS_URL}" style="color:#2D5F3F">Open Plaid dashboard</a>
      </li>
      <li>
        Live operational view:
        <a href="https://clearpathinvest.app/admin/health" style="color:#2D5F3F">clearpathinvest.app/admin/health</a>
      </li>
    </ul>

    ${
      !health.healthy
        ? `<p style="margin:16px 0 0;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:13px;color:#991b1b">
             <strong>⚠ Action required.</strong> linkTokenCreate is failing.
             Users cannot link new brokerages until this is resolved. Check
             Plaid dashboard → API keys, rotation status, and any recent
             Plaid incidents.
           </p>`
        : ""
    }
  `;

  const html = renderEmailTemplate({
    preview: subject,
    body,
    footnote:
      "This digest runs daily. You're receiving it because you're the founder on file.",
  });

  return { subject, html };
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
