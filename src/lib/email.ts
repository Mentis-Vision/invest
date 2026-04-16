import { log, errorInfo } from "./log";

/**
 * Minimal Resend wrapper.
 *
 * Why not the `resend` npm package: one dependency, one potential
 * vulnerability surface. Resend's REST API is trivial to call directly
 * with fetch. Swap this out for the SDK later if we need advanced features
 * (batching, attachments, React email templates with preview).
 *
 * If RESEND_API_KEY is unset, we log the email to console and return ok=true.
 * This lets local/dev flows continue without Resend provisioned.
 */

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const RESEND_API = "https://api.resend.com/emails";

export async function sendEmail(
  input: SendEmailInput
): Promise<{ ok: boolean; id?: string; skipped?: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "ClearPath Invest <no-reply@clearpath-invest.com>";

  if (!key) {
    log.warn("email", "RESEND_API_KEY not set — dev-mode skip", {
      to: input.to,
      subject: input.subject,
    });
    // In development this is fine; production deploys should guarantee the key.
    return { ok: true, skipped: true };
  }

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.error("email", "resend api non-2xx", {
        status: res.status,
        body: text.slice(0, 500),
        to: input.to,
      });
      return { ok: false };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (err) {
    log.error("email", "send failed", { to: input.to, ...errorInfo(err) });
    return { ok: false };
  }
}

/**
 * Branded transactional email wrapper — keep the shell consistent.
 */
export function renderEmailTemplate(opts: {
  preview: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footnote?: string;
}): string {
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `<p style="margin:24px 0 0"><a href="${opts.ctaUrl}" style="display:inline-block;padding:12px 24px;background:#2D5F3F;color:#fff;text-decoration:none;border-radius:6px;font-weight:500">${opts.ctaLabel}</a></p>`
      : "";
  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:#FAF7F2;font-family:-apple-system,system-ui,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1A1A1E">
    <span style="display:none">${opts.preview}</span>
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto;padding:32px 24px;background:#fff;border:1px solid #E8E4DC;border-radius:8px">
        <tr><td>
          <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.2em;color:#8A8680;text-transform:uppercase">ClearPath Invest</p>
          <div style="font-size:15px;line-height:1.6">${opts.body}</div>
          ${cta}
          ${
            opts.footnote
              ? `<p style="margin:32px 0 0;padding-top:24px;border-top:1px solid #E8E4DC;font-size:12px;color:#8A8680">${opts.footnote}</p>`
              : ""
          }
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;
}
