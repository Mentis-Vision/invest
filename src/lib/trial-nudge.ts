import { pool } from "./db";
import { sendEmail, renderEmailTemplate } from "./email";
import { log, errorInfo } from "./log";

/**
 * Trial nudge cron + email templates.
 *
 * The 30-day no-card trial needs deliberate nudging or it lapses
 * silently. This module owns both:
 *   1. The schedule of nudges relative to trial end (T-7, T-3, T-1,
 *      T+0, T+7).
 *   2. The email templates each window sends.
 *   3. Idempotency — every (userId, kind) pair is sent at most
 *      once via the `trial_nudge_log` table.
 *
 * Read by `/api/cron/trial-nudge` (fires daily) and the in-app
 * banner (which uses the same windows for visual urgency states).
 *
 * The trial timer itself lives in `user_subscription.trialEndsAt`,
 * set by `ensureSubscriptionRecord` on first /app load. We never
 * extend trials from this module — the timer is the timer; nudges
 * only message about it.
 */

export type NudgeKind = "D7" | "D3" | "D1" | "D0" | "WINBACK_D7";

/** Days-from-trialEndsAt window each nudge fires in. Negative = past
 *  trial end. Each window is exactly one day wide; a daily cron lands
 *  in the right bucket without needing minute-level precision. */
const NUDGE_WINDOWS: Record<NudgeKind, { minDay: number; maxDay: number }> = {
  D7:        { minDay: 6.5,  maxDay: 7.5 },
  D3:        { minDay: 2.5,  maxDay: 3.5 },
  D1:        { minDay: 0.5,  maxDay: 1.5 },
  D0:        { minDay: -0.5, maxDay: 0.5 },
  WINBACK_D7:{ minDay: -7.5, maxDay: -6.5 },
};

let _schemaEnsured = false;
async function ensureSchema(): Promise<void> {
  if (_schemaEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "trial_nudge_log" (
        "userId" TEXT NOT NULL,
        kind TEXT NOT NULL,
        "sentAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("userId", kind)
      )
    `);
    _schemaEnsured = true;
  } catch (err) {
    log.warn("trial-nudge", "ensureSchema failed", errorInfo(err));
    _schemaEnsured = true;
  }
}

type Candidate = {
  userId: string;
  email: string;
  name: string | null;
  trialEndsAt: Date;
  daysFromEnd: number;
};

/**
 * Pull trial users currently in any of the nudge windows. Ordered
 * by trialEndsAt so the earliest-expiring users get sent first if
 * the cron is mid-batch when something breaks.
 */
async function findCandidates(): Promise<Candidate[]> {
  const { rows } = await pool.query<{
    userId: string;
    email: string;
    name: string | null;
    trialEndsAt: Date;
    days_from_end: string;
  }>(`
    SELECT
      s."userId",
      u.email,
      u.name,
      s."trialEndsAt",
      EXTRACT(EPOCH FROM (s."trialEndsAt" - NOW())) / 86400.0 AS days_from_end
    FROM "user_subscription" s
    INNER JOIN "user" u ON u.id = s."userId"
    WHERE s.tier = 'trial'
      AND s."trialEndsAt" BETWEEN NOW() - INTERVAL '8 days'
                              AND NOW() + INTERVAL '8 days'
    ORDER BY s."trialEndsAt" ASC
  `);
  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    trialEndsAt: r.trialEndsAt,
    daysFromEnd: Number(r.days_from_end),
  }));
}

function classifyWindow(daysFromEnd: number): NudgeKind | null {
  for (const [kind, win] of Object.entries(NUDGE_WINDOWS) as [
    NudgeKind,
    { minDay: number; maxDay: number },
  ][]) {
    if (daysFromEnd >= win.minDay && daysFromEnd < win.maxDay) return kind;
  }
  return null;
}

/**
 * Mark a nudge as sent. Idempotent — `ON CONFLICT DO NOTHING` so a
 * duplicate cron run can't double-fire emails. The cron sends
 * AFTER successful insert (i.e., we claim the slot first), so a
 * crash mid-send leaves the slot claimed and skips the duplicate.
 */
async function claimNudge(
  userId: string,
  kind: NudgeKind
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO "trial_nudge_log" ("userId", kind)
     VALUES ($1, $2)
     ON CONFLICT ("userId", kind) DO NOTHING`,
    [userId, kind]
  );
  return (rowCount ?? 0) > 0;
}

const baseUrl = () =>
  process.env.BETTER_AUTH_URL ?? "https://clearpathinvest.app";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Render the right email for a given nudge kind. Each template
 * shares the standard ClearPath envelope (renderEmailTemplate) so
 * branding and disclaimers stay consistent with the verification +
 * weekly-brief emails. Subject + body + CTA differ per window.
 *
 * Tone shifts deliberately: T-7 informs, T-3 urgency, T-1 last
 * call, T+0 friendly downgrade notice, T+7 winback. The founder-
 * pricing CTA shows in T-3 and T+7 — those are the windows where
 * the discount actually moves a decision.
 */
function templateFor(
  kind: NudgeKind,
  name: string,
  trialEndsAt: Date
): { subject: string; html: string; text: string } {
  const upgradeUrl = `${baseUrl()}/app/settings`;
  const pricingUrl = `${baseUrl()}/pricing`;
  const greeting = name ? `Hi ${escapeHtml(name.split(" ")[0])},` : "Hi,";
  const niceDate = trialEndsAt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  switch (kind) {
    case "D7":
      return {
        subject: "Your ClearPath trial ends in 7 days",
        html: renderEmailTemplate({
          preview: "One week left in your free trial. Lock in founder pricing now.",
          body: `
            <p>${greeting}</p>
            <p>Your free 30-day trial of ClearPath ends on <strong>${escapeHtml(niceDate)}</strong>.</p>
            <p>If the three-lens research has been useful, you can take <strong>25% off your first year</strong> by upgrading anytime in the next week with code <strong>FOUNDER25</strong> at checkout.</p>
            <p>If it hasn&rsquo;t been useful, hit reply and tell me why. I read every response.</p>
          `,
          ctaLabel: "View plans",
          ctaUrl: pricingUrl,
          footnote: "We send at most one email per nudge window. You can opt out of all email nudges in your settings.",
        }),
        text: `Your free 30-day ClearPath trial ends on ${niceDate}.\n\nTake 25% off your first year with code FOUNDER25 at checkout: ${pricingUrl}`,
      };

    case "D3":
      return {
        subject: "3 days left — take 25% off your first year",
        html: renderEmailTemplate({
          preview: "Three days until your trial ends. FOUNDER25 still available.",
          body: `
            <p>${greeting}</p>
            <p>Three days until your ClearPath trial ends (${escapeHtml(niceDate)}).</p>
            <p>Code <strong>FOUNDER25</strong> — <strong>25% off your first year</strong> — expires when your trial does.</p>
            <p>If you&rsquo;re still deciding, the most useful thing to do is run a fresh three-lens panel on a position you&rsquo;re actually considering. The disagreement-surfacing on real holdings is what most people convert on.</p>
          `,
          ctaLabel: "Use FOUNDER25",
          ctaUrl: pricingUrl,
          footnote: "Replies go straight to the founder.",
        }),
        text: `3 days until your trial ends (${niceDate}). FOUNDER25 = 25% off your first year, expires with the trial. ${pricingUrl}`,
      };

    case "D1":
      return {
        subject: "Tomorrow: your ClearPath trial ends",
        html: renderEmailTemplate({
          preview: "Last day of your free trial.",
          body: `
            <p>${greeting}</p>
            <p>Your trial ends tomorrow (${escapeHtml(niceDate)}).</p>
            <p>If you upgrade today, you keep:</p>
            <ul>
              <li>The full three-lens research panel on any US equity</li>
              <li>Live SEC, FRED, and market data — every claim cited to source</li>
              <li>Overnight portfolio brief on every holding</li>
              <li>Track-record evaluations on every brief you ever ran</li>
            </ul>
            <p>If you don&rsquo;t, your account drops to the Free plan tomorrow — limited research access, but everything you&rsquo;ve linked stays connected. You can upgrade anytime.</p>
          `,
          ctaLabel: "Upgrade now (FOUNDER25 lasts another day)",
          ctaUrl: upgradeUrl,
          footnote: "No credit card needed to keep your account.",
        }),
        text: `Trial ends tomorrow (${niceDate}). Upgrade with FOUNDER25 today: ${upgradeUrl}`,
      };

    case "D0":
      return {
        subject: "Your ClearPath trial has ended",
        html: renderEmailTemplate({
          preview: "Trial ended. You're on the Free plan now.",
          body: `
            <p>${greeting}</p>
            <p>Your 30-day trial wrapped up. You&rsquo;re now on the Free plan — most surfaces still work, just with research limits.</p>
            <p>Linked brokerages, dashboards, account aliases, ticker bar, holdings — all still here. The full three-lens panel + on-demand briefs are gated behind the paid tiers.</p>
            <p>Whenever you&rsquo;re ready to upgrade, the founder-pricing window is closed but standard prices still apply. No pressure.</p>
          `,
          ctaLabel: "View plans",
          ctaUrl: pricingUrl,
          footnote: "If you tried ClearPath and it wasn't a fit, I'd love to know why. Just reply.",
        }),
        text: `Your trial ended. Free plan applies now. Upgrade anytime at ${pricingUrl}`,
      };

    case "WINBACK_D7":
      return {
        subject: "Still considering ClearPath?",
        html: renderEmailTemplate({
          preview: "A small thank-you discount for taking another look.",
          body: `
            <p>${greeting}</p>
            <p>It&rsquo;s been a week since your trial ended. If ClearPath is on the maybe pile, here&rsquo;s a one-time win-back: <strong>FOUNDER25 reactivated</strong> for the next 7 days. 25% off your first year, same as the trial deal.</p>
            <p>Two things changed since you last looked:</p>
            <ul>
              <li>Track-record page now publishes 30-day hit/miss outcomes — public, with no cherry-picking.</li>
              <li>Per-account dashboards (Schwab, Fidelity, etc.) now show today&rsquo;s $ change correctly even on day-of-link, account renames work, and the per-broker view groups properly.</li>
            </ul>
            <p>If now isn&rsquo;t the right time, that&rsquo;s fine — you won&rsquo;t hear from me again unless you re-engage.</p>
          `,
          ctaLabel: "Use FOUNDER25 (7 days)",
          ctaUrl: pricingUrl,
          footnote: "This is the last automated email about your trial.",
        }),
        text: `One week post-trial. FOUNDER25 reactivated for 7 days. ${pricingUrl}`,
      };
  }
}

/**
 * Send all due nudges. Returns counts per kind for the cron to log.
 *
 * Atomic per-recipient: claim the (userId, kind) slot first via
 * INSERT, then send. If send fails the slot stays claimed so we
 * don't retry (better to silently miss one nudge than to spam the
 * same user twice when Resend hiccups). Failures are logged at
 * `warn`; the cron keeps going.
 */
export async function sendDueNudges(): Promise<Record<NudgeKind | "skipped", number>> {
  await ensureSchema();
  const counts: Record<NudgeKind | "skipped", number> = {
    D7: 0, D3: 0, D1: 0, D0: 0, WINBACK_D7: 0, skipped: 0,
  };
  const candidates = await findCandidates();

  for (const c of candidates) {
    const kind = classifyWindow(c.daysFromEnd);
    if (!kind) {
      counts.skipped += 1;
      continue;
    }
    const claimed = await claimNudge(c.userId, kind);
    if (!claimed) {
      counts.skipped += 1;
      continue;
    }
    try {
      const tpl = templateFor(kind, c.name ?? "", c.trialEndsAt);
      await sendEmail({
        to: c.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      counts[kind] += 1;
    } catch (err) {
      log.warn("trial-nudge", "send failed", {
        userId: c.userId,
        kind,
        ...errorInfo(err),
      });
      // Slot stays claimed — won't retry. Acceptable trade-off.
    }
  }

  return counts;
}
