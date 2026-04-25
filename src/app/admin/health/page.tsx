import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { pool } from "@/lib/db";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Link2,
  Radio,
} from "lucide-react";

/**
 * Admin health dashboard.
 *
 * Founder-only operational view. Everything rendered server-side off
 * direct SQL queries — no client fetching, no auth-on-the-client
 * round-trip. Loads fast and is impossible to accidentally expose to
 * regular users via client-side routing (the requireAdmin guard is
 * evaluated on every request).
 *
 * What it answers in one glance:
 *   - Are any users stuck post-link? (the red flag section)
 *   - Are Plaid connections healthy overall?
 *   - Is holdings data fresh across the fleet?
 *   - What's the user + connection baseline?
 *
 * Mirrors the shape of /api/admin/health so the page can be replaced
 * with a client component later if we need interactivity (drill-in,
 * force-resync buttons, etc.).
 */

export const dynamic = "force-dynamic";

type HealthData = {
  generatedAt: string;
  plaidItems: {
    byStatus: Array<{ status: string; count: number }>;
    topInstitutions: Array<{ institutionName: string | null; count: number }>;
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
    itemsWithWebhooks: number;
    itemsNeverReceivedWebhook: number;
    itemsStaleWebhooks: number;
    mostRecentWebhookAt: string | null;
    eventsLast24h: number;
    eventsLast7d: number;
    verifyFailuresLast24h: number;
    verifyFailuresLast7d: number;
    failureRatePct: number | null;
    failureRate7dPct: number | null;
  };
  snaptrade: { totalConnections: number; disabled: number };
  users: { total: number; withBrokerage: number; activeLast7d: number };
};

async function loadHealth(): Promise<HealthData> {
  // Same queries as /api/admin/health — run directly so the page
  // loads in one server hop instead of fetching its own API.
  const [
    statusRows,
    instRows,
    stuckRows,
    lagRows,
    webhookRows,
    eventRows,
    snaptradeRows,
    userRows,
  ] = await Promise.all([
      pool.query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::int AS count FROM "plaid_item"
         GROUP BY status ORDER BY count DESC`
      ),
      pool.query<{ institutionName: string | null; count: string }>(
        `SELECT "institutionName", COUNT(*)::int AS count
           FROM "plaid_item" WHERE status <> 'removed'
          GROUP BY "institutionName" ORDER BY count DESC LIMIT 10`
      ),
      pool.query<{
        userId: string;
        email: string | null;
        institutionName: string | null;
        itemStatus: string;
        itemCreatedAt: Date;
        lastWebhookAt: Date | null;
        holdings: number;
      }>(
        `SELECT p."userId", u.email, p."institutionName",
                p.status AS "itemStatus", p."createdAt" AS "itemCreatedAt",
                p."lastWebhookAt",
                COALESCE((SELECT COUNT(*)::int FROM "holding" h
                          WHERE h."userId" = p."userId" AND h.source = 'plaid'), 0) AS holdings
           FROM "plaid_item" p
           JOIN "user" u ON u.id = p."userId"
          WHERE p.status IN ('active','sync_failed','login_required')
            AND p."createdAt" < NOW() - INTERVAL '30 minutes'
            AND u.email <> 'demo@clearpathinvest.app'
            AND NOT EXISTS (
              SELECT 1 FROM "holding" h
              WHERE h."userId" = p."userId" AND h.source = 'plaid'
            )
          ORDER BY p."createdAt" DESC LIMIT 50`
      ),
      pool.query<{ bucket: string; count: string }>(
        `SELECT CASE
            WHEN "lastSyncedAt" IS NULL THEN 'never'
            WHEN NOW() - "lastSyncedAt" < INTERVAL '1 hour' THEN '1h'
            WHEN NOW() - "lastSyncedAt" < INTERVAL '6 hours' THEN '6h'
            WHEN NOW() - "lastSyncedAt" < INTERVAL '24 hours' THEN '24h'
            WHEN NOW() - "lastSyncedAt" < INTERVAL '7 days' THEN '7d'
            ELSE 'older' END AS bucket,
            COUNT(*)::int AS count
          FROM "plaid_item" WHERE status <> 'removed' GROUP BY bucket`
      ),
      pool.query<{
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
      ),
      pool.query<{
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
      ),
      pool.query<{ total: string; disabled: string }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE disabled = true)::int AS disabled
           FROM "snaptrade_connection"`
      ),
      pool.query<{
        total: string;
        withBrokerage: string;
        activeLast7d: string;
      }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (
                  WHERE EXISTS (SELECT 1 FROM "plaid_item" p
                                WHERE p."userId" = u.id AND p.status <> 'removed')
                     OR EXISTS (SELECT 1 FROM "snaptrade_connection" s
                                WHERE s."userId" = u.id AND s.disabled = false)
                )::int AS "withBrokerage",
                COUNT(*) FILTER (
                  WHERE EXISTS (SELECT 1 FROM "session" se
                                WHERE se."userId" = u.id
                                  AND se."expiresAt" > NOW() - INTERVAL '7 days')
                )::int AS "activeLast7d"
           FROM "user" u WHERE u.email <> 'demo@clearpathinvest.app'`
      ),
    ]);

  const lag = {
    lessThan1h: 0,
    lessThan6h: 0,
    lessThan24h: 0,
    lessThan7d: 0,
    older: 0,
    neverSynced: 0,
  };
  for (const r of lagRows.rows) {
    const n = Number(r.count);
    if (r.bucket === "1h") lag.lessThan1h = n;
    else if (r.bucket === "6h") lag.lessThan6h = n;
    else if (r.bucket === "24h") lag.lessThan24h = n;
    else if (r.bucket === "7d") lag.lessThan7d = n;
    else if (r.bucket === "older") lag.older = n;
    else if (r.bucket === "never") lag.neverSynced = n;
  }

  return {
    generatedAt: new Date().toISOString(),
    plaidItems: {
      byStatus: statusRows.rows.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
      topInstitutions: instRows.rows.map((r) => ({
        institutionName: r.institutionName,
        count: Number(r.count),
      })),
    },
    stuckUsers: stuckRows.rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      institutionName: r.institutionName,
      itemStatus: r.itemStatus,
      itemCreatedAt: r.itemCreatedAt.toISOString(),
      lastWebhookAt: r.lastWebhookAt?.toISOString() ?? null,
      holdings: Number(r.holdings),
    })),
    syncLag: lag,
    webhookHealth: (() => {
      const eventsLast24h = Number(eventRows.rows[0]?.eventsLast24h ?? 0);
      const eventsLast7d = Number(eventRows.rows[0]?.eventsLast7d ?? 0);
      const verifyFailuresLast24h = Number(
        eventRows.rows[0]?.verifyFailuresLast24h ?? 0
      );
      const verifyFailuresLast7d = Number(
        eventRows.rows[0]?.verifyFailuresLast7d ?? 0
      );
      const failureRatePct =
        eventsLast24h > 0
          ? Math.round((verifyFailuresLast24h / eventsLast24h) * 1000) / 10
          : null;
      const failureRate7dPct =
        eventsLast7d > 0
          ? Math.round((verifyFailuresLast7d / eventsLast7d) * 1000) / 10
          : null;
      return {
        itemsWithWebhooks: Number(
          webhookRows.rows[0]?.itemsWithWebhooks ?? 0
        ),
        itemsNeverReceivedWebhook: Number(
          webhookRows.rows[0]?.itemsNeverReceivedWebhook ?? 0
        ),
        itemsStaleWebhooks: Number(
          webhookRows.rows[0]?.itemsStaleWebhooks ?? 0
        ),
        mostRecentWebhookAt:
          webhookRows.rows[0]?.mostRecentWebhookAt?.toISOString() ?? null,
        eventsLast24h,
        eventsLast7d,
        verifyFailuresLast24h,
        verifyFailuresLast7d,
        failureRatePct,
        failureRate7dPct,
      };
    })(),
    snaptrade: {
      totalConnections: Number(snaptradeRows.rows[0]?.total ?? 0),
      disabled: Number(snaptradeRows.rows[0]?.disabled ?? 0),
    },
    users: {
      total: Number(userRows.rows[0]?.total ?? 0),
      withBrokerage: Number(userRows.rows[0]?.withBrokerage ?? 0),
      activeLast7d: Number(userRows.rows[0]?.activeLast7d ?? 0),
    },
  };
}

export default async function AdminHealthPage() {
  const guard = await requireAdmin();
  if (!guard.ok) {
    redirect(guard.status === 401 ? "/sign-in" : "/app");
  }

  const data = await loadHealth();
  const stale =
    data.syncLag.lessThan24h + data.syncLag.lessThan7d + data.syncLag.older;
  const hasStuck = data.stuckUsers.length > 0;
  const webhookAlerts =
    data.webhookHealth.itemsStaleWebhooks +
    data.webhookHealth.itemsNeverReceivedWebhook;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Operational Health
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Founder-only. Updated {new Date(data.generatedAt).toLocaleString()}.
          </p>
        </div>
        <a
          href="/api/admin/health"
          className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          target="_blank"
          rel="noopener"
        >
          Raw JSON
        </a>
      </div>

      {/* ── Top KPI row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          icon={Link2}
          label="Users with brokerage"
          value={`${data.users.withBrokerage} / ${data.users.total}`}
          sub={`${data.users.activeLast7d} active last 7d`}
        />
        <Kpi
          icon={CheckCircle2}
          label="Plaid items healthy"
          value={String(
            data.plaidItems.byStatus.find((r) => r.status === "active")
              ?.count ?? 0
          )}
          sub="status=active"
        />
        <Kpi
          icon={AlertTriangle}
          label="Stuck users"
          value={String(data.stuckUsers.length)}
          sub="Linked 30+ min ago, no holdings"
          tone={hasStuck ? "warn" : undefined}
        />
        <Kpi
          icon={Clock}
          label="Holdings stale >24h"
          value={String(stale)}
          sub="Needs sync refresh"
          tone={stale > 0 ? "warn" : undefined}
        />
      </div>

      {/* ── Webhook alerts (red flag if >0) ─────────────────────── */}
      {webhookAlerts > 0 && (
        <div className="mt-4 rounded-lg border border-[var(--sell,theme(colors.red.500))]/40 bg-[var(--sell,theme(colors.red.500))]/5 p-4">
          <div className="flex items-start gap-3">
            <Radio className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--sell,theme(colors.red.600))]" />
            <div>
              <div className="text-[14px] font-semibold">
                Webhook silence — {webhookAlerts} item
                {webhookAlerts === 1 ? "" : "s"} affected
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {data.webhookHealth.itemsNeverReceivedWebhook} never received
                a webhook (Item older than 7d). {" "}
                {data.webhookHealth.itemsStaleWebhooks} last webhook is more
                than 14 days old. Likely causes: JWT verification rejecting
                legit webhooks, Plaid retry exhausted, or webhook URL not
                reachable. Check logs for{" "}
                <code className="rounded bg-secondary/50 px-1 font-mono text-[11px]">
                  plaid.webhook rejected
                </code>
                .
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Stuck users (red flag) ──────────────────────────────── */}
      {hasStuck && (
        <section className="mt-8">
          <h2 className="text-[14px] font-semibold text-[var(--sell,theme(colors.red.600))]">
            Stuck users — {data.stuckUsers.length}
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Linked a brokerage &gt;30 min ago but have zero Plaid holdings.
            Each of these would email support if they noticed.
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[12px]">
              <thead className="bg-secondary/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Institution</th>
                  <th className="px-3 py-2 text-left">Item status</th>
                  <th className="px-3 py-2 text-left">Linked</th>
                  <th className="px-3 py-2 text-left">Last webhook</th>
                </tr>
              </thead>
              <tbody>
                {data.stuckUsers.map((u) => (
                  <tr
                    key={u.userId}
                    className="border-t border-border/50 hover:bg-secondary/20"
                  >
                    <td className="px-3 py-2 font-mono">{u.email ?? "—"}</td>
                    <td className="px-3 py-2">
                      {u.institutionName ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill value={u.itemStatus} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatAgo(u.itemCreatedAt)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {u.lastWebhookAt
                        ? formatAgo(u.lastWebhookAt)
                        : "never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Plaid items + sync lag ──────────────────────────────── */}
      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-[14px] font-semibold">Plaid items by status</h2>
          <ul className="mt-3 space-y-1 text-[13px]">
            {data.plaidItems.byStatus.map((r) => (
              <li
                key={r.status}
                className="flex items-center justify-between border-b border-border/40 py-1.5"
              >
                <span className="flex items-center gap-2">
                  <StatusPill value={r.status} />
                </span>
                <span className="font-mono">{r.count}</span>
              </li>
            ))}
            {data.plaidItems.byStatus.length === 0 && (
              <li className="text-muted-foreground">No Plaid items yet.</li>
            )}
          </ul>
        </div>
        <div>
          <h2 className="text-[14px] font-semibold">Sync lag (Plaid)</h2>
          <ul className="mt-3 space-y-1 text-[13px]">
            <LagRow label="< 1 hour" count={data.syncLag.lessThan1h} tone="ok" />
            <LagRow label="< 6 hours" count={data.syncLag.lessThan6h} tone="ok" />
            <LagRow label="< 24 hours" count={data.syncLag.lessThan24h} tone="warn" />
            <LagRow label="< 7 days" count={data.syncLag.lessThan7d} tone="warn" />
            <LagRow label="older" count={data.syncLag.older} tone="bad" />
            <LagRow
              label="never synced"
              count={data.syncLag.neverSynced}
              tone="bad"
            />
          </ul>
        </div>
      </section>

      {/* ── Webhook baseline ────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="text-[14px] font-semibold">Webhook delivery</h2>

        {/* True verification failure rate — earlier signal than the
            heuristic stale-item thresholds below. Show both 24h (fast
            alert) and 7d (smoldering trend). */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <FailureRateCard
            label="Verify failure rate (24h)"
            ratePct={data.webhookHealth.failureRatePct}
            numerator={data.webhookHealth.verifyFailuresLast24h}
            denominator={data.webhookHealth.eventsLast24h}
          />
          <FailureRateCard
            label="Verify failure rate (7d)"
            ratePct={data.webhookHealth.failureRate7dPct}
            numerator={data.webhookHealth.verifyFailuresLast7d}
            denominator={data.webhookHealth.eventsLast7d}
          />
        </div>

        <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Per-item heuristics (legacy)
        </div>
        <ul className="mt-2 grid gap-1 text-[13px] md:grid-cols-2">
          <li className="flex items-center justify-between border-b border-border/40 py-1.5">
            <span>Items that received a webhook</span>
            <span className="font-mono">
              {data.webhookHealth.itemsWithWebhooks}
            </span>
          </li>
          <li className="flex items-center justify-between border-b border-border/40 py-1.5">
            <span>Most recent webhook</span>
            <span className="font-mono text-muted-foreground">
              {data.webhookHealth.mostRecentWebhookAt
                ? formatAgo(data.webhookHealth.mostRecentWebhookAt)
                : "never"}
            </span>
          </li>
          <li className="flex items-center justify-between border-b border-border/40 py-1.5">
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--sell,theme(colors.red.500))]" />
              Never received webhook (&gt;7d old Item)
            </span>
            <span className="font-mono">
              {data.webhookHealth.itemsNeverReceivedWebhook}
            </span>
          </li>
          <li className="flex items-center justify-between border-b border-border/40 py-1.5">
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--hold,theme(colors.amber.500))]" />
              Last webhook &gt;14d ago
            </span>
            <span className="font-mono">
              {data.webhookHealth.itemsStaleWebhooks}
            </span>
          </li>
        </ul>
      </section>

      {/* ── Top institutions + SnapTrade baseline ───────────────── */}
      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-[14px] font-semibold">
            Top institutions (Plaid, active)
          </h2>
          <ul className="mt-3 space-y-1 text-[13px]">
            {data.plaidItems.topInstitutions.map((r, i) => (
              <li
                key={`${r.institutionName ?? "unknown"}-${i}`}
                className="flex items-center justify-between border-b border-border/40 py-1.5"
              >
                <span>{r.institutionName ?? "(unknown)"}</span>
                <span className="font-mono">{r.count}</span>
              </li>
            ))}
            {data.plaidItems.topInstitutions.length === 0 && (
              <li className="text-muted-foreground">None yet.</li>
            )}
          </ul>
        </div>
        <div>
          <h2 className="text-[14px] font-semibold">SnapTrade</h2>
          <ul className="mt-3 space-y-1 text-[13px]">
            <li className="flex items-center justify-between border-b border-border/40 py-1.5">
              <span>Total connections</span>
              <span className="font-mono">
                {data.snaptrade.totalConnections}
              </span>
            </li>
            <li className="flex items-center justify-between border-b border-border/40 py-1.5">
              <span>Disabled</span>
              <span className="font-mono">{data.snaptrade.disabled}</span>
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}

function FailureRateCard({
  label,
  ratePct,
  numerator,
  denominator,
}: {
  label: string;
  ratePct: number | null;
  numerator: number;
  denominator: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span
          className={`font-mono text-[18px] font-semibold ${
            (ratePct ?? 0) > 5
              ? "text-[var(--sell,theme(colors.red.600))]"
              : ""
          }`}
        >
          {ratePct === null ? "—" : `${ratePct.toFixed(1)}%`}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {numerator} failed / {denominator} total
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Link2;
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "bad";
}) {
  const ring =
    tone === "warn"
      ? "border-[var(--hold,theme(colors.amber.500))]/40"
      : tone === "bad"
        ? "border-[var(--sell,theme(colors.red.500))]/40"
        : "border-border";
  const iconTone =
    tone === "warn"
      ? "text-[var(--hold,theme(colors.amber.600))]"
      : tone === "bad"
        ? "text-[var(--sell,theme(colors.red.600))]"
        : "text-muted-foreground";
  return (
    <div className={`rounded-lg border bg-card p-4 ${ring}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${iconTone}`} />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-2 font-mono text-[22px] font-semibold leading-none tracking-tight">
        {value}
      </div>
      {sub && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">{sub}</div>
      )}
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const tone =
    value === "active"
      ? "bg-[var(--buy,theme(colors.emerald.500))]/10 text-[var(--buy,theme(colors.emerald.700))]"
      : value === "login_required"
        ? "bg-[var(--hold,theme(colors.amber.500))]/10 text-[var(--hold,theme(colors.amber.700))]"
        : value === "sync_failed"
          ? "bg-[var(--sell,theme(colors.red.500))]/10 text-[var(--sell,theme(colors.red.700))]"
          : "bg-secondary text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {value}
    </span>
  );
}

function LagRow({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "ok" | "warn" | "bad";
}) {
  const dotTone =
    tone === "ok"
      ? "bg-[var(--buy,theme(colors.emerald.500))]"
      : tone === "warn"
        ? "bg-[var(--hold,theme(colors.amber.500))]"
        : "bg-[var(--sell,theme(colors.red.500))]";
  return (
    <li className="flex items-center justify-between border-b border-border/40 py-1.5">
      <span className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${dotTone}`} />
        {label}
      </span>
      <span className="font-mono">{count}</span>
    </li>
  );
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
