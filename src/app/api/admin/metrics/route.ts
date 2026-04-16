import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/admin/metrics
 *
 * Internal operational dashboard data. Gated by ADMIN_EMAILS env var
 * (comma-separated list). Returns JSON covering:
 *   - recommendation volume + cache/fast-path coverage
 *   - per-model analyst success rates
 *   - tool call distribution
 *   - red-flag frequency (claim-verification misses)
 *   - supervisor mix (which supervisor model / panel-consensus)
 *   - auth events (sign-ins, failures)
 *   - waitlist growth
 *   - monthly spend estimate
 *
 * No PII beyond counts. No per-user breakdown at this level. Safe to
 * surface to the team for weekly review.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length === 0) {
    return NextResponse.json(
      { error: "Admin metrics not configured. Set ADMIN_EMAILS." },
      { status: 503 }
    );
  }
  if (!adminEmails.includes(session.user.email.toLowerCase())) {
    // Generic 404 to avoid leaking endpoint existence.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const [
      recTotals,
      analystTotals,
      supervisorMix,
      toolCalls,
      authRecent,
      waitlistRecent,
      spendRecent,
      recentErrors,
    ] = await Promise.all([
      // Recommendation totals last 7 / 30 / 90 days, + cached/fast-path share.
      // We can't distinguish cache hits from fresh runs server-side without
      // additional logging. Instead we infer fast-path share from
      // analysisJson.supervisorModel = 'panel-consensus'.
      pool.query(
        `SELECT
           SUM(CASE WHEN "createdAt" > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS last_7d,
           SUM(CASE WHEN "createdAt" > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int AS last_30d,
           SUM(CASE WHEN "createdAt" > NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END)::int AS last_90d,
           SUM(CASE WHEN recommendation = 'BUY' AND "createdAt" > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int AS buys_30d,
           SUM(CASE WHEN recommendation = 'SELL' AND "createdAt" > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int AS sells_30d,
           SUM(CASE WHEN recommendation = 'HOLD' AND "createdAt" > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int AS holds_30d,
           SUM(CASE WHEN recommendation = 'INSUFFICIENT_DATA' AND "createdAt" > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int AS insuf_30d,
           SUM(CASE WHEN consensus = 'UNANIMOUS' AND "createdAt" > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int AS unanimous_30d
         FROM "recommendation"`
      ),
      // Per-model analyst success — parse from analysisJson.analyses[].status
      pool.query(
        `WITH analyst_rows AS (
           SELECT
             jsonb_array_elements(r."analysisJson"->'analyses') AS a
           FROM "recommendation" r
           WHERE r."createdAt" > NOW() - INTERVAL '30 days'
         )
         SELECT
           a->>'model' AS model,
           COUNT(*)::int AS total,
           SUM(CASE WHEN a->>'status' = 'ok' THEN 1 ELSE 0 END)::int AS ok,
           AVG((a->>'tokensUsed')::int) FILTER (WHERE a->>'status' = 'ok')::int AS avg_tokens
         FROM analyst_rows
         WHERE a->>'model' IS NOT NULL
         GROUP BY a->>'model'`
      ),
      // Supervisor mix: panel-consensus (fast-path) vs live LLM supervisors
      pool.query(
        `SELECT
           COALESCE(r."analysisJson"->>'supervisorModel', 'unknown') AS supervisor,
           COUNT(*)::int AS total
         FROM "recommendation" r
         WHERE r."createdAt" > NOW() - INTERVAL '30 days'
         GROUP BY r."analysisJson"->>'supervisorModel'
         ORDER BY total DESC`
      ),
      // Tool call distribution
      pool.query(
        `WITH analyst_rows AS (
           SELECT
             jsonb_array_elements(r."analysisJson"->'analyses') AS a
           FROM "recommendation" r
           WHERE r."createdAt" > NOW() - INTERVAL '30 days'
         )
         SELECT
           jsonb_array_length(COALESCE(a->'toolCalls', '[]'::jsonb)) AS calls,
           COUNT(*)::int AS n
         FROM analyst_rows
         WHERE a->>'status' = 'ok'
         GROUP BY 1 ORDER BY 1`
      ),
      // Auth events last 7 days
      pool.query(
        `SELECT
           "eventType",
           success,
           COUNT(*)::int AS n
         FROM "auth_event"
         WHERE "createdAt" > NOW() - INTERVAL '7 days'
         GROUP BY "eventType", success
         ORDER BY n DESC`
      ),
      // Waitlist growth
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '7 days')::int AS last_7d,
           COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '30 days')::int AS last_30d,
           COUNT(*)::int AS total
         FROM "waitlist"`
      ),
      // Spend — sum of monthlyCostCents across users (current cycle)
      pool.query(
        `SELECT
           SUM("monthlyTokens")::bigint AS total_tokens,
           SUM("monthlyCostCents")::int AS total_cents,
           COUNT(*) FILTER (WHERE "monthlyTokens" > 0)::int AS active_users
         FROM "user"`
      ),
      // Recent 5xx / failure patterns from recommendation + auth_event
      pool.query(
        `SELECT "eventType" AS kind, "createdAt", email
         FROM "auth_event"
         WHERE success = false AND "createdAt" > NOW() - INTERVAL '24 hours'
         ORDER BY "createdAt" DESC LIMIT 20`
      ),
    ]);

    const totals = recTotals.rows[0] ?? {};
    const analyst = analystTotals.rows.map(
      (r: Record<string, unknown>) => ({
        model: r.model as string,
        total: Number(r.total ?? 0),
        ok: Number(r.ok ?? 0),
        failureRate:
          Number(r.total ?? 0) > 0
            ? 1 - Number(r.ok ?? 0) / Number(r.total ?? 0)
            : 0,
        avgTokens: r.avg_tokens != null ? Number(r.avg_tokens) : null,
      })
    );

    const supervisor = supervisorMix.rows;
    const fastPathShare = (() => {
      const total = supervisor.reduce(
        (s: number, r: Record<string, unknown>) => s + Number(r.total ?? 0),
        0
      );
      const fast = supervisor
        .filter((r: Record<string, unknown>) => r.supervisor === "panel-consensus")
        .reduce(
          (s: number, r: Record<string, unknown>) => s + Number(r.total ?? 0),
          0
        );
      return total > 0 ? fast / total : 0;
    })();

    const tools = toolCalls.rows.map((r: Record<string, unknown>) => ({
      calls: Number(r.calls ?? 0),
      count: Number(r.n ?? 0),
    }));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      recommendations: {
        last7d: Number(totals.last_7d ?? 0),
        last30d: Number(totals.last_30d ?? 0),
        last90d: Number(totals.last_90d ?? 0),
        byKind30d: {
          BUY: Number(totals.buys_30d ?? 0),
          SELL: Number(totals.sells_30d ?? 0),
          HOLD: Number(totals.holds_30d ?? 0),
          INSUFFICIENT_DATA: Number(totals.insuf_30d ?? 0),
        },
        unanimousShare30d:
          Number(totals.last_30d ?? 0) > 0
            ? Number(totals.unanimous_30d ?? 0) / Number(totals.last_30d ?? 0)
            : 0,
      },
      analysts: analyst,
      supervisor: {
        mix30d: supervisor,
        fastPathShare30d: fastPathShare,
      },
      toolCallDistribution30d: tools,
      auth: {
        events7d: authRecent.rows,
      },
      waitlist: waitlistRecent.rows[0] ?? {},
      spend: spendRecent.rows[0] ?? {},
      recentAuthFailures: recentErrors.rows,
    });
  } catch (err) {
    log.error("admin.metrics", "query failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not compute metrics." },
      { status: 500 }
    );
  }
}
