import { pool } from "./db";
import { log, errorInfo } from "./log";
import { sendEmail, renderEmailTemplate } from "./email";

/**
 * Weekly digest email builder + sender.
 *
 * Runs Monday ~9am ET via /api/cron/weekly-digest. Pulls each active
 * user's portfolio + research activity for the last 7 days and sends
 * a short recap. Voice rules from the rest of the app apply: no
 * mention of AI, tokens, or crons; plain English about what moved.
 *
 * Selection rules (respect the user's attention):
 *   - Skip users who opted out of digests (user.weeklyDigestOptOut)
 *   - Skip users with no holdings linked (nothing to recap)
 *   - Skip users already sent in the last 5 days (idempotent re-run)
 *   - Skip demo account (shared login — every new drive-by would re-mail)
 *   - Skip unverified emails (Resend rejects those anyway, but explicit here)
 *
 * The email itself: we send what we already know about the user's
 * week — no synthesis via AI, so the cron is $0 AI spend. If the
 * user's book is flat and nothing alert-worthy happened, we *still*
 * send a short "quiet week, nothing to report" version rather than
 * skipping — consistent delivery beats high-drama noise.
 */

type DigestUser = {
  userId: string;
  email: string;
  name: string | null;
};

export type WeeklyDigestData = {
  firstName: string;
  weekStart: Date;
  portfolio: {
    linked: boolean;
    totalValue: number | null;
    weekChangePct: number | null;
    weekChangeDollar: number | null;
  };
  topMovers: Array<{
    ticker: string;
    changePct: number;
  }>;
  alerts: Array<{
    kind: string;
    message: string;
  }>;
  recentResearch: Array<{
    ticker: string;
    recommendation: string;
    createdAt: Date;
  }>;
  upcomingEarnings: Array<{
    ticker: string;
    eventDate: Date;
  }>;
};

/**
 * Run the digest for a single user. Returns what was sent (useful
 * for logging / tests). Throws only on hard DB errors — email send
 * failures are caught and returned as `sent: false` so the caller
 * can continue iterating.
 */
export async function sendWeeklyDigestForUser(
  user: DigestUser
): Promise<{ sent: boolean; skipped?: string }> {
  // ── Gate 1: opt-out / unverified / demo ─────────────────────────
  const { rows: gate } = await pool.query(
    `SELECT "emailVerified", "weeklyDigestOptOut", "weeklyDigestSentAt"
     FROM "user" WHERE id = $1`,
    [user.userId]
  );
  if (gate.length === 0) return { sent: false, skipped: "user not found" };
  const row = gate[0] as {
    emailVerified: boolean;
    weeklyDigestOptOut: boolean;
    weeklyDigestSentAt: Date | null;
  };
  if (row.weeklyDigestOptOut) return { sent: false, skipped: "opted out" };
  if (!row.emailVerified) return { sent: false, skipped: "email unverified" };
  if (user.email.toLowerCase() === "demo@clearpathinvest.app") {
    return { sent: false, skipped: "demo account" };
  }
  // Idempotent re-runs: if we sent within 5 days, skip
  if (row.weeklyDigestSentAt) {
    const ageMs = Date.now() - new Date(row.weeklyDigestSentAt).getTime();
    if (ageMs < 5 * 24 * 60 * 60 * 1000) {
      return { sent: false, skipped: "already sent this week" };
    }
  }

  // ── Build digest data ──────────────────────────────────────────
  const data = await buildDigestData(user);
  if (!data.portfolio.linked) {
    return { sent: false, skipped: "no holdings linked" };
  }

  // ── Send ───────────────────────────────────────────────────────
  const { subject, html, text } = renderDigest(data);

  const res = await sendEmail({
    to: user.email,
    subject,
    html,
    text,
    tags: [{ name: "category", value: "weekly-digest" }],
  });

  if (!res.ok) return { sent: false, skipped: "email send failed" };

  await pool
    .query(
      `UPDATE "user" SET "weeklyDigestSentAt" = NOW() WHERE id = $1`,
      [user.userId]
    )
    .catch((err) => {
      log.warn("weekly-digest", "sent-at update failed", {
        userId: user.userId,
        ...errorInfo(err),
      });
    });

  log.info("weekly-digest", "sent", {
    userId: user.userId,
    alerts: data.alerts.length,
    movers: data.topMovers.length,
    researches: data.recentResearch.length,
    earnings: data.upcomingEarnings.length,
  });

  return { sent: true };
}

/** Aggregate view of one user's last 7 days. */
async function buildDigestData(user: DigestUser): Promise<WeeklyDigestData> {
  const firstName = (user.name?.trim() || user.email.split("@")[0])
    .split(" ")[0]
    .slice(0, 30);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);

  // Portfolio snapshot from the series table (populated nightly)
  const { rows: portfolioRows } = await pool.query(
    `SELECT "totalValue", "capturedAt"
     FROM "portfolio_snapshot"
     WHERE "userId" = $1 AND "capturedAt" >= NOW() - interval '8 days'
     ORDER BY "capturedAt" DESC`,
    [user.userId]
  );

  let linked = false;
  let totalValue: number | null = null;
  let weekChangePct: number | null = null;
  let weekChangeDollar: number | null = null;

  if (portfolioRows.length >= 2) {
    linked = true;
    const latest = portfolioRows[0] as {
      totalValue: string | number;
    };
    const oldest = portfolioRows[portfolioRows.length - 1] as {
      totalValue: string | number;
    };
    totalValue = Number(latest.totalValue);
    const prev = Number(oldest.totalValue);
    if (prev > 0) {
      weekChangeDollar = totalValue - prev;
      weekChangePct = (weekChangeDollar / prev) * 100;
    }
  } else if (portfolioRows.length === 1) {
    linked = true;
    totalValue = Number(
      (portfolioRows[0] as { totalValue: string | number }).totalValue
    );
  }

  // Top three movers by absolute %-change among holdings. Uses the
  // same holding-level lastValue vs a ticker_market_daily close
  // from 7 days ago via warehouse. Cheap approximation: we compare
  // holding.lastPrice (today) to the closing price 7 days ago if we
  // have it in the warehouse.
  const { rows: moverRows } = await pool.query(
    `SELECT h.ticker, h."lastPrice",
            (SELECT close FROM "ticker_market_daily"
             WHERE ticker = h.ticker AND "asOfDate" <= NOW()::date - 7
             ORDER BY "asOfDate" DESC LIMIT 1) AS "priorClose"
     FROM "holding" h
     WHERE h."userId" = $1 AND h."lastPrice" IS NOT NULL`,
    [user.userId]
  );
  const movers = (moverRows as Array<{
    ticker: string;
    lastPrice: string | number;
    priorClose: string | number | null;
  }>)
    .map((r) => {
      const now = Number(r.lastPrice);
      const prior = r.priorClose != null ? Number(r.priorClose) : null;
      if (!prior || prior <= 0) return null;
      return {
        ticker: r.ticker,
        changePct: ((now - prior) / prior) * 100,
      };
    })
    .filter((x): x is { ticker: string; changePct: number } => x !== null)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 3);

  // Alerts created in the last 7 days
  const { rows: alertRows } = await pool.query(
    `SELECT kind, message
     FROM "alert_event"
     WHERE "userId" = $1 AND "createdAt" >= NOW() - interval '7 days'
     ORDER BY "createdAt" DESC
     LIMIT 5`,
    [user.userId]
  );
  const alerts = (alertRows as Array<{ kind: string; message: string }>).map(
    (r) => ({ kind: r.kind, message: r.message })
  );

  // Recent research — deep/panel only (quick scans excluded)
  const { rows: researchRows } = await pool.query(
    `SELECT ticker, recommendation, "createdAt"
     FROM "recommendation"
     WHERE "userId" = $1
       AND "createdAt" >= NOW() - interval '7 days'
       AND ("analysisJson"->>'mode' IS NULL
            OR "analysisJson"->>'mode' <> 'quick')
     ORDER BY "createdAt" DESC
     LIMIT 5`,
    [user.userId]
  );
  const recentResearch = (researchRows as Array<{
    ticker: string;
    recommendation: string;
    createdAt: Date;
  }>).map((r) => ({
    ticker: r.ticker,
    recommendation: r.recommendation,
    createdAt: r.createdAt,
  }));

  // Upcoming earnings on user holdings — next 7 days
  const { rows: earningsRows } = await pool.query(
    `SELECT DISTINCT t.ticker, t."eventDate"
     FROM "ticker_events" t
     WHERE t."eventDate" BETWEEN NOW() AND NOW() + interval '7 days'
       AND t."eventType" = 'earnings'
       AND t.ticker IN (
         SELECT DISTINCT ticker FROM "holding"
         WHERE "userId" = $1
       )
     ORDER BY t."eventDate" ASC
     LIMIT 5`,
    [user.userId]
  ).catch(() => ({ rows: [] })); // ticker_events may not exist on older schemas
  const upcomingEarnings = (earningsRows as Array<{
    ticker: string;
    eventDate: Date;
  }>).map((r) => ({ ticker: r.ticker, eventDate: r.eventDate }));

  return {
    firstName,
    weekStart,
    portfolio: { linked, totalValue, weekChangePct, weekChangeDollar },
    topMovers: movers,
    alerts,
    recentResearch,
    upcomingEarnings,
  };
}

/**
 * Compose a plain-text + HTML digest from the data. Keeps the email
 * short — the point is a nudge back into the app, not a wall of text.
 */
function renderDigest(data: WeeklyDigestData): {
  subject: string;
  html: string;
  text: string;
} {
  const {
    firstName,
    portfolio,
    topMovers,
    alerts,
    recentResearch,
    upcomingEarnings,
  } = data;

  // Subject tone: if big move, lean into it; otherwise keep neutral.
  let subject = `Your ClearPath week`;
  if (portfolio.weekChangePct !== null) {
    const p = portfolio.weekChangePct;
    if (Math.abs(p) >= 3) {
      subject = `Your ClearPath week: ${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
    }
  }

  const bodyHtml = `
    <p>Good morning, ${escape(firstName)}.</p>
    ${portfolioBlockHtml(portfolio)}
    ${topMovers.length > 0 ? moversBlockHtml(topMovers) : ""}
    ${alerts.length > 0 ? alertsBlockHtml(alerts) : ""}
    ${
      recentResearch.length > 0
        ? researchBlockHtml(recentResearch)
        : ""
    }
    ${
      upcomingEarnings.length > 0
        ? earningsBlockHtml(upcomingEarnings)
        : ""
    }
    <p style="margin-top:28px;font-size:13px;color:#6b7684">
      Skip this email next week? You can turn off the weekly digest
      anytime from Account Settings.
    </p>
  `;

  const html = renderEmailTemplate({
    preview: `Your week on ClearPath Invest.`,
    body: bodyHtml,
    ctaLabel: "Open ClearPath",
    ctaUrl:
      (process.env.BETTER_AUTH_URL ??
        "https://clearpathinvest.app").replace(/\/$/, "") + "/app",
    footnote:
      "You're receiving this because you have a ClearPath Invest account. Not investment advice.",
  });

  const text = [
    `Good morning, ${firstName}.`,
    "",
    portfolioBlockText(portfolio),
    topMovers.length > 0 ? moversBlockText(topMovers) : "",
    alerts.length > 0 ? alertsBlockText(alerts) : "",
    recentResearch.length > 0 ? researchBlockText(recentResearch) : "",
    upcomingEarnings.length > 0 ? earningsBlockText(upcomingEarnings) : "",
    "",
    "Open ClearPath: https://clearpathinvest.app/app",
    "",
    "Turn off weekly digests: Account Settings",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject, html, text };
}

// ─── Block renderers ─────────────────────────────────────────────────

function portfolioBlockHtml(p: WeeklyDigestData["portfolio"]): string {
  if (p.totalValue === null) {
    return `<p>Your portfolio is linked but we don't have a full week of data yet. Tomorrow we will.</p>`;
  }
  const moveLine =
    p.weekChangePct !== null
      ? `Week change: <strong>${p.weekChangePct > 0 ? "+" : ""}${p.weekChangePct.toFixed(2)}%</strong> (${p.weekChangeDollar !== null && p.weekChangeDollar >= 0 ? "+" : ""}$${Math.abs(p.weekChangeDollar ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })})`
      : `Not enough data yet to compute a week change.`;
  return `
    <p style="margin:20px 0 6px">
      <strong>Portfolio</strong><br/>
      Total value: <strong>$${p.totalValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}</strong><br/>
      ${moveLine}
    </p>
  `;
}
function portfolioBlockText(p: WeeklyDigestData["portfolio"]): string {
  if (p.totalValue === null) {
    return `Your portfolio is linked but no full week of data yet.`;
  }
  const moveLine =
    p.weekChangePct !== null
      ? `Week change: ${p.weekChangePct > 0 ? "+" : ""}${p.weekChangePct.toFixed(2)}% ($${Math.abs(p.weekChangeDollar ?? 0).toFixed(0)})`
      : `Not enough data yet.`;
  return `PORTFOLIO\nTotal value: $${p.totalValue.toFixed(0)}\n${moveLine}`;
}

function moversBlockHtml(
  movers: WeeklyDigestData["topMovers"]
): string {
  return `
    <p style="margin:20px 0 6px"><strong>Week's biggest movers</strong></p>
    <ul style="margin:0 0 0 18px;padding:0">
      ${movers
        .map(
          (m) =>
            `<li>${escape(m.ticker)}: <strong style="color:${m.changePct >= 0 ? "#15803d" : "#dc2626"}">${m.changePct > 0 ? "+" : ""}${m.changePct.toFixed(2)}%</strong></li>`
        )
        .join("")}
    </ul>
  `;
}
function moversBlockText(movers: WeeklyDigestData["topMovers"]): string {
  return (
    `WEEK'S BIGGEST MOVERS\n` +
    movers
      .map(
        (m) =>
          `- ${m.ticker}: ${m.changePct > 0 ? "+" : ""}${m.changePct.toFixed(2)}%`
      )
      .join("\n")
  );
}

function alertsBlockHtml(alerts: WeeklyDigestData["alerts"]): string {
  return `
    <p style="margin:20px 0 6px"><strong>New alerts this week</strong></p>
    <ul style="margin:0 0 0 18px;padding:0">
      ${alerts.map((a) => `<li>${escape(a.message)}</li>`).join("")}
    </ul>
  `;
}
function alertsBlockText(alerts: WeeklyDigestData["alerts"]): string {
  return (
    `NEW ALERTS THIS WEEK\n` + alerts.map((a) => `- ${a.message}`).join("\n")
  );
}

function researchBlockHtml(
  rs: WeeklyDigestData["recentResearch"]
): string {
  return `
    <p style="margin:20px 0 6px"><strong>Your research this week</strong></p>
    <ul style="margin:0 0 0 18px;padding:0">
      ${rs
        .map(
          (r) =>
            `<li>${escape(r.ticker)} — <strong>${escape(r.recommendation)}</strong></li>`
        )
        .join("")}
    </ul>
  `;
}
function researchBlockText(rs: WeeklyDigestData["recentResearch"]): string {
  return (
    `YOUR RESEARCH THIS WEEK\n` +
    rs.map((r) => `- ${r.ticker}: ${r.recommendation}`).join("\n")
  );
}

function earningsBlockHtml(
  es: WeeklyDigestData["upcomingEarnings"]
): string {
  return `
    <p style="margin:20px 0 6px"><strong>Earnings coming up (on your holdings)</strong></p>
    <ul style="margin:0 0 0 18px;padding:0">
      ${es
        .map(
          (e) =>
            `<li>${escape(e.ticker)} — ${new Date(e.eventDate).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</li>`
        )
        .join("")}
    </ul>
  `;
}
function earningsBlockText(es: WeeklyDigestData["upcomingEarnings"]): string {
  return (
    `EARNINGS COMING UP\n` +
    es
      .map(
        (e) =>
          `- ${e.ticker}: ${new Date(e.eventDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`
      )
      .join("\n")
  );
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
