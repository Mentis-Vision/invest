import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { checkRateLimit, RULES, getClientIp } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";
import { notifySlack, slackConfigured } from "@/lib/notify";
import { sendEmail, renderEmailTemplate } from "@/lib/email";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  // Spam protection — waitlist is public so IP-rate-limited only
  const rl = await checkRateLimit(RULES.waitlistIp, ip);
  if (!rl.ok) {
    log.warn("waitlist", "rate limit hit", { ip });
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let body: { email?: string; name?: string; portfolioSize?: string; source?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  // Safe-length truncation on all user-provided fields
  const clip = (s: string | null | undefined, max: number) =>
    s ? s.slice(0, max) : null;

  try {
    // `xmax = 0` identifies a true INSERT vs. an UPDATE via ON CONFLICT,
    // so we only Slack-notify on new signups, not re-submissions.
    const result = await pool.query(
      `INSERT INTO "waitlist" ("email", "name", "portfolioSize", "source", "notes", "ipAddress", "userAgent")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ("email") DO UPDATE SET
         "name" = COALESCE(EXCLUDED."name", "waitlist"."name"),
         "portfolioSize" = COALESCE(EXCLUDED."portfolioSize", "waitlist"."portfolioSize"),
         "notes" = COALESCE(EXCLUDED."notes", "waitlist"."notes")
       RETURNING (xmax = 0) AS inserted`,
      [
        email,
        clip(body.name?.trim() || null, 200),
        clip(body.portfolioSize?.trim() || null, 100),
        clip(body.source?.trim() || null, 100),
        clip(body.notes?.trim() || null, 2000),
        ip,
        userAgent,
      ]
    );

    const isNew = Boolean(result.rows[0]?.inserted);

    if (isNew && slackConfigured()) {
      // Fire-and-forget. Don't block the response on Slack latency or
      // Slack outage.
      const name = body.name?.trim() || null;
      const portfolioSize = body.portfolioSize?.trim() || null;
      const source = body.source?.trim() || "unknown";
      const detail = [
        name ? `name: ${name}` : null,
        portfolioSize ? `portfolio: ${portfolioSize}` : null,
        `source: ${source}`,
      ]
        .filter(Boolean)
        .join(" · ");
      notifySlack(
        {
          text: `🟢 New ClearPath waitlist signup\n• *${email}*${detail ? `\n• ${detail}` : ""}`,
        },
        "waitlist"
      ).catch(() => {});
    }

    // Fire-and-forget confirmation email. The user gets a real receipt
    // so the form doesn't feel like a black hole ("I requested access
    // but nothing was sent" was the exact complaint in prod on
    // 2026-04-18). Send for BOTH new signups and re-submissions — if
    // someone re-submits they may not have received the first email.
    if (process.env.RESEND_API_KEY) {
      sendEmail({
        to: email,
        subject: "You're on the ClearPath Invest list",
        html: renderEmailTemplate({
          preview: "We received your request for access.",
          body: `
            <p>Thanks for requesting access to ClearPath Invest.</p>
            <p>We're in private beta and admit new investors in small
            waves so we can pay attention to feedback. When your spot
            opens, we'll email you with a one-click sign-in link.</p>
            <p>While you wait: the three things we'd love to know about
            you if you have a minute — (1) roughly what you invest in
            (stocks / ETFs / crypto / bonds), (2) what you currently use
            for research, and (3) what question you most wish you had
            a better answer to. Just reply to this email; I read every
            one.</p>
            <p style="margin-top:28px">— Sang<br/>Founder, ClearPath Invest</p>
          `,
          footnote: `You're receiving this because you submitted the waitlist form at clearpathinvest.app. If you didn't, you can safely ignore this email.`,
        }),
        text: `Thanks for requesting access to ClearPath Invest.

We're in private beta and admit new investors in small waves. When your
spot opens, we'll email you with a one-click sign-in link.

While you wait — reply and tell me (1) what you invest in, (2) what you
use for research today, and (3) the question you most wish you had a
better answer to. I read every reply.

— Sang, Founder`,
        tags: [{ name: "category", value: "waitlist-confirmation" }],
      }).catch((err) => {
        log.warn("waitlist", "confirmation email failed (non-fatal)", {
          email,
          ...errorInfo(err),
        });
      });
    }

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    log.error("waitlist", "insert failed", { email, ...errorInfo(err) });
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
