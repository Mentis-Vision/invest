import { NextRequest, NextResponse } from "next/server";
import { log, errorInfo } from "@/lib/log";
import { runSmokeReport, renderReportText } from "@/lib/e2e-smoke";
import { sendEmail } from "@/lib/email";

/**
 * Weekly E2E smoke test.
 *
 * Runs the catalogue in src/lib/e2e-smoke.ts against production.
 * Schedule: Sundays 12:00 UTC (8am ET) — registered in vercel.json.
 *
 * On any FAIL: emails the on-call address (E2E_ALERT_EMAIL or
 * sang@clearpathinvest.app fallback) with the full report as plain text.
 * On all pass: logs success, no email — only alert when something is
 * wrong, not every Sunday.
 *
 * Bearer-CRON_SECRET-gated like every other cron in this app.
 *
 * Ops overrides:
 *   ?baseUrl=https://invest-xxxx.vercel.app — test a preview deployment
 *   ?email=1                                — force email even on success
 *   ?dry=1                                  — return report, skip email
 */

export const maxDuration = 120;

const BASE_URL_DEFAULT = "https://clearpathinvest.app";
const ALERT_EMAIL_DEFAULT = "sang@clearpathinvest.app";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron.e2e-smoke", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const authz = req.headers.get("authorization");
  if (authz !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const baseUrl =
    url.searchParams.get("baseUrl") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    BASE_URL_DEFAULT;
  const forceEmail = url.searchParams.get("email") === "1";
  const dry = url.searchParams.get("dry") === "1";

  const alertTo = process.env.E2E_ALERT_EMAIL ?? ALERT_EMAIL_DEFAULT;

  try {
    const report = await runSmokeReport({ baseUrl });
    const text = renderReportText(report);

    log.info("cron.e2e-smoke", "completed", {
      baseUrl,
      passed: report.passed,
      failed: report.failed,
      skipped: report.skipped,
      totalMs: report.totalMs,
    });

    const shouldEmail = !dry && (report.failed > 0 || forceEmail);
    if (shouldEmail) {
      const subject =
        report.failed > 0
          ? `[ClearPath E2E] ${report.failed} test(s) failing`
          : `[ClearPath E2E] ${report.passed} passing — manual report`;

      // HTML body is just the plaintext wrapped in <pre> — keeps the
      // monospace alignment of the report and avoids needing a
      // template. The plaintext field carries the same content for
      // email clients that prefer text/plain.
      const html = `<pre style="font:13px ui-monospace,SFMono-Regular,Menlo,monospace; line-height:1.5; white-space:pre-wrap; word-wrap:break-word; background:#f6f6f6; padding:16px; border-radius:8px; border:1px solid #e5e5e5;">${escapeHtml(
        text
      )}</pre>`;

      const result = await sendEmail({
        to: alertTo,
        subject,
        html,
        text,
        tags: [{ name: "category", value: "ops-alert" }],
      });

      if (!result.ok) {
        log.error("cron.e2e-smoke", "alert email failed to send", {
          alertTo,
          failedCount: report.failed,
        });
      }
    }

    // Always return the JSON report so the cron caller (or a manual
    // curl) can inspect results immediately. HTTP status reflects
    // whether anything failed — useful for monitoring tools that just
    // ping the endpoint.
    return NextResponse.json(
      {
        ...report,
        alertedTo: shouldEmail ? alertTo : null,
      },
      { status: report.failed > 0 ? 500 : 200 }
    );
  } catch (err) {
    log.error("cron.e2e-smoke", "runner crashed", {
      baseUrl,
      ...errorInfo(err),
    });
    // Try to email even on crash — the runner crashing IS a failure
    // worth knowing about.
    try {
      await sendEmail({
        to: alertTo,
        subject: "[ClearPath E2E] runner crashed",
        text: `Runner crashed before completing.\n\nbaseUrl: ${baseUrl}\nerror: ${err instanceof Error ? err.message : String(err)}`,
        html: `<p>Runner crashed before completing.</p><p>baseUrl: ${baseUrl}<br>error: ${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`,
        tags: [{ name: "category", value: "ops-alert" }],
      });
    } catch {
      // Best-effort. Vercel logs will still capture the error above.
    }
    return NextResponse.json(
      { error: "runner_crashed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
