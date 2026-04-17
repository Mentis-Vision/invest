import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { sendEmail, renderEmailTemplate } from "@/lib/email";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/admin/test-email
 *
 * Smoke-tests the Resend pipeline end-to-end. Hits the real Resend API
 * and returns the message ID + recipient on success.
 *
 * Use after provisioning RESEND_API_KEY + verifying the sending domain
 * in Resend's dashboard. The deliverability headers (List-Unsubscribe,
 * Reply-To, plain-text fallback) all flow through sendEmail() so this
 * tests the production code path — not a mock.
 *
 * Auth: ADMIN_EMAILS-gated, same pattern as /api/admin/metrics.
 *
 * Body (optional):
 *   { "to": "you@example.com" }   — defaults to the caller's own email
 */
export async function POST(req: NextRequest) {
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
      { error: "Test endpoint not configured. Set ADMIN_EMAILS." },
      { status: 503 }
    );
  }
  if (!adminEmails.includes(session.user.email.toLowerCase())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { to?: string } = {};
  try {
    body = (await req.json()) as { to?: string };
  } catch {
    /* empty body is fine */
  }
  const to = body.to ?? session.user.email;

  try {
    const result = await sendEmail({
      to,
      subject: "ClearPath Invest — Resend smoke test",
      html: renderEmailTemplate({
        preview: "If you can read this, transactional email is live.",
        body: `
          <p>This is a deliverability smoke test from the ClearPath Invest
          admin panel. If it landed in your inbox (not spam), the Resend
          pipeline + DKIM/SPF/DMARC setup are healthy.</p>
          <p>Things this email exercises:</p>
          <ul>
            <li>Real Resend API call (not the dev-mode skip)</li>
            <li>List-Unsubscribe + List-Unsubscribe-Post headers (RFC 8058)</li>
            <li>Reply-To header (replies go to support@)</li>
            <li>Plain-text fallback alongside the HTML body</li>
            <li>Branded transactional template shell</li>
          </ul>
        `,
        ctaLabel: "Open ClearPath",
        ctaUrl: "https://clearpathinvest.app/app",
        footnote: "Sent at " + new Date().toISOString(),
      }),
      tags: [
        { name: "category", value: "smoke-test" },
        { name: "actor", value: session.user.id.slice(0, 8) },
      ],
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: "Resend returned non-2xx — check server logs." },
        { status: 502 }
      );
    }
    if (result.skipped) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message:
          "RESEND_API_KEY is unset, so sendEmail short-circuited. Add the key in Vercel env to actually send.",
      });
    }
    return NextResponse.json({
      ok: true,
      to,
      messageId: result.id,
      message:
        "Sent. If it arrives in spam, check Resend dashboard → Domains for DKIM/SPF/DMARC verification status.",
    });
  } catch (err) {
    log.error("admin.test-email", "smoke test failed", errorInfo(err));
    return NextResponse.json(
      { ok: false, error: "Test send threw — check server logs." },
      { status: 500 }
    );
  }
}
