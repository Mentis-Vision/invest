import { createHmac, timingSafeEqual } from "node:crypto";
import { sendEmail, renderEmailTemplate } from "../email";
import type { WeeklyBriefFull } from "../public-brief";

/**
 * Weekly bull-vs-bear brief email — one recipient at a time.
 *
 * Rendered Monday at 11:00 UTC, one hour after the brief cron writes
 * its row (so CDN warming has a chance). Audience: verified users +
 * waitlist subscribers who haven't opted out of *this specific*
 * notification type (see weeklyBriefOptOut flag).
 *
 * Design rules the body obeys:
 *   - INFORMATIONAL ONLY banner (AGENTS.md legal rule)
 *   - Deterministic unsubscribe token derived from email + shared
 *     secret → no DB lookup needed on the unsubscribe path, no token
 *     table to keep in sync.
 *   - Truncate bull/bear to ~3 bullets so the email stays scannable.
 *     The full brief lives behind the CTA link.
 */

export type WeeklyBriefEmailRecipient = {
  email: string;
  name?: string | null;
  /** 'user' = row in "user" table; 'waitlist' = row in "waitlist" table. */
  audience: "user" | "waitlist";
};

export type SendWeeklyBriefEmailInput = {
  recipient: WeeklyBriefEmailRecipient;
  brief: WeeklyBriefFull;
  /** Pre-computed HMAC token — see buildUnsubscribeToken() below. */
  unsubscribeToken: string;
};

export async function sendWeeklyBriefEmail(
  input: SendWeeklyBriefEmailInput
): Promise<{ ok: boolean; id?: string; skipped?: boolean }> {
  const { recipient, brief, unsubscribeToken } = input;

  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "https://clearpathinvest.app"
  ).replace(/\/$/, "");

  const briefUrl = `${baseUrl}/research/${brief.slug}`;

  const unsubscribeUrl =
    `${baseUrl}/unsubscribe` +
    `?type=weekly-brief` +
    `&email=${encodeURIComponent(recipient.email)}` +
    `&audience=${recipient.audience}` +
    `&token=${unsubscribeToken}`;

  const firstName = deriveFirstName(recipient.name, recipient.email);
  const recommendation = brief.recommendation || "Hold";

  const subject = `This week: ${brief.ticker} — ${recommendation}`;

  // Bull + bear come from the DB as newline-separated text where the
  // first line is the thesis and subsequent bullet lines start with
  // "• ". Parse lightly and truncate to three bullets apiece.
  const bull = parseCase(brief.bullCase);
  const bear = parseCase(brief.bearCase);

  const summaryParagraph =
    brief.summary?.trim() ||
    `This week's brief looks at ${brief.ticker}. Our three-lens panel (value, growth, macro) ran a bull-vs-bear debate and landed on ${recommendation.toLowerCase()} with ${brief.confidence || "moderate"} confidence.`;

  const bodyHtml = `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Your Monday brief is out — this week: <strong>${escapeHtml(brief.ticker)}</strong>.</p>

    <p style="margin:20px 0 6px;padding:14px 16px;background:#F4F1EA;border-left:3px solid #2D5F3F;border-radius:4px">
      <span style="display:block;font-size:11px;letter-spacing:0.12em;color:#6b7684;text-transform:uppercase;margin-bottom:4px">Panel verdict</span>
      <strong style="font-size:17px">${escapeHtml(recommendation)}</strong>
      <span style="color:#6b7684"> · ${escapeHtml(brief.confidence || "")} confidence · ${escapeHtml(brief.consensus || "")} consensus</span>
    </p>

    <p style="margin:20px 0">${escapeHtml(summaryParagraph)}</p>

    ${renderCaseBlockHtml("Bull case", bull, "#15803d")}
    ${renderCaseBlockHtml("Bear case", bear, "#dc2626")}

    <p style="margin:24px 0 8px;padding:12px 14px;background:#FFF8E1;border:1px solid #F4D06F;border-radius:4px;font-size:12px;color:#5a4500">
      <strong>Informational only, not investment advice.</strong>
      This brief is educational research about a publicly traded security.
      It is not a recommendation tailored to your situation, tax profile,
      or risk tolerance. Past performance is not a guarantee of future
      results. Consult a licensed advisor before making investment decisions.
    </p>

    <p style="margin-top:28px;font-size:13px;color:#6b7684">
      Don't want the weekly brief?
      <a href="${unsubscribeUrl}" style="color:#6b7684;text-decoration:underline">Unsubscribe here</a>
      — this only stops the brief email; other account emails continue.
    </p>
  `;

  const html = renderEmailTemplate({
    preview: `This week on ClearPath: ${brief.ticker} — ${recommendation}.`,
    body: bodyHtml,
    ctaLabel: "Read the full brief",
    ctaUrl: briefUrl,
    footnote:
      "You're receiving this because you asked to hear from ClearPath Invest. Informational only — not investment advice.",
  });

  const text = [
    `Hi ${firstName},`,
    "",
    `Your Monday brief is out — this week: ${brief.ticker}.`,
    "",
    `PANEL VERDICT: ${recommendation} · ${brief.confidence || ""} confidence · ${brief.consensus || ""} consensus`,
    "",
    summaryParagraph,
    "",
    renderCaseBlockText("BULL CASE", bull),
    renderCaseBlockText("BEAR CASE", bear),
    "",
    `Read the full brief: ${briefUrl}`,
    "",
    "INFORMATIONAL ONLY, NOT INVESTMENT ADVICE. This brief is educational research about a publicly traded security. Consult a licensed advisor before making investment decisions.",
    "",
    `Unsubscribe from the weekly brief: ${unsubscribeUrl}`,
  ].join("\n");

  return sendEmail({
    to: recipient.email,
    subject,
    html,
    text,
    tags: [
      { name: "category", value: "weekly-brief" },
      { name: "ticker", value: brief.ticker.toLowerCase() },
    ],
  });
}

// ── unsubscribe token helpers ───────────────────────────────────────

/**
 * Stateless unsubscribe token: HMAC-SHA256 of `${audience}:${email}`.
 * Lets the /unsubscribe handler verify the link without any DB lookup
 * or a "pending unsubscribe" table.
 *
 * Uses CRON_SECRET as the signing key — it's already present on every
 * deployment that runs this cron, so no new env var to manage. Falls
 * back to BETTER_AUTH_SECRET if CRON_SECRET is somehow unset (same
 * confidentiality requirement). The token is case-insensitive on
 * email so providers that normalize recipients don't break the link.
 */
function unsubscribeSecret(): string {
  const s = process.env.CRON_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!s) {
    throw new Error(
      "weekly-brief-email: neither CRON_SECRET nor BETTER_AUTH_SECRET is set"
    );
  }
  return s;
}

export function buildUnsubscribeToken(
  email: string,
  audience: "user" | "waitlist"
): string {
  const h = createHmac("sha256", unsubscribeSecret());
  h.update(`${audience}:${email.trim().toLowerCase()}`);
  // URL-safe base64 — strip padding, swap +/ for -_.
  return h
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function verifyUnsubscribeToken(
  email: string,
  audience: "user" | "waitlist",
  token: string
): boolean {
  if (!token) return false;
  const expected = buildUnsubscribeToken(email, audience);
  if (expected.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

// ── body helpers ────────────────────────────────────────────────────

type ParsedCase = {
  thesis: string | null;
  bullets: string[];
  condition: string | null;
};

/**
 * Parse the bull_case / bear_case text column into a (thesis, bullets,
 * "would change our mind") triple. Format comes from public-brief.ts
 * generateAndSaveWeeklyBrief which writes:
 *
 *   <thesis>
 *   • <reason> (<citation>)
 *   • <reason> (<citation>)
 *   Would change our mind: <condition>
 */
function parseCase(raw: string | null): ParsedCase {
  if (!raw) return { thesis: null, bullets: [], condition: null };
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let thesis: string | null = null;
  const bullets: string[] = [];
  let condition: string | null = null;
  for (const line of lines) {
    if (line.startsWith("•")) {
      bullets.push(line.replace(/^•\s*/, "").trim());
    } else if (/^would change our mind[:\s]/i.test(line)) {
      condition = line.replace(/^would change our mind[:\s]+/i, "").trim();
    } else if (!thesis) {
      thesis = line;
    } else {
      // Continuation of thesis, or a non-bullet line — append to thesis.
      thesis = `${thesis} ${line}`;
    }
  }
  return { thesis, bullets: bullets.slice(0, 3), condition };
}

function renderCaseBlockHtml(
  title: string,
  parsed: ParsedCase,
  color: string
): string {
  if (!parsed.thesis && parsed.bullets.length === 0) return "";
  const thesis = parsed.thesis
    ? `<p style="margin:0 0 6px">${escapeHtml(parsed.thesis)}</p>`
    : "";
  const bullets =
    parsed.bullets.length > 0
      ? `<ul style="margin:0 0 0 18px;padding:0;color:#2a2a2e">
          ${parsed.bullets
            .map((b) => `<li style="margin:4px 0">${escapeHtml(b)}</li>`)
            .join("")}
        </ul>`
      : "";
  return `
    <div style="margin:18px 0">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.1em;color:${color};text-transform:uppercase;font-weight:600">${escapeHtml(title)}</p>
      ${thesis}
      ${bullets}
    </div>
  `;
}

function renderCaseBlockText(title: string, parsed: ParsedCase): string {
  if (!parsed.thesis && parsed.bullets.length === 0) return "";
  const parts: string[] = [title];
  if (parsed.thesis) parts.push(parsed.thesis);
  for (const b of parsed.bullets) parts.push(`  - ${b}`);
  return parts.join("\n");
}

function deriveFirstName(name: string | null | undefined, email: string): string {
  const raw = (name ?? "").trim() || email.split("@")[0] || "there";
  return raw.split(/\s+/)[0].slice(0, 30);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
