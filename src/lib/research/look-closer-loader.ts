// src/lib/research/look-closer-loader.ts
//
// Phase 8 — "Look closer at your holdings".
//
// Composes up to 8 research-worthy holdings cards keyed off existing
// data sources. Replaces the older YourBookToday component (top-gainer
// + top-loser only). Each card carries a single primary "why" — the
// highest-priority signal among:
//
//   1. earnings        — held ticker with earnings date in next 30 days
//   2. stale_rec       — held ticker with last research > 30 days ago
//   3. concentration   — position weight > 5% of non-cash portfolio
//   4. mover           — fallback: ≥ ±2% absolute change_pct today
//
// Priority order: a ticker that fires multiple signals takes the
// highest-ranked one (1 wins over 2 wins over 3 wins over 4). This
// keeps each card's badge crisp and avoids cluttering the UI with
// multi-tag soup.
//
// Future signals (quality_decline, momentum, insider_cluster) are
// stubbed in the union type but not yet emitted — the warehouse data
// for these is currently sparse. They will be wired in once the
// fundamentals + insider tables have meaningful coverage.
//
// Privacy note: this loader reads the user's `holding` rows from inside
// an authenticated request handler — that's allowed (per warehouse
// rule #9 the read is scoped to the requesting user, never used to
// drive warehouse universe writes).

import { pool } from "../db";
import { log, errorInfo } from "../log";

export type LookCloserReason =
  | "earnings"
  | "stale_rec"
  | "concentration"
  | "mover"
  // Stubbed for future expansion; not yet emitted.
  | "quality_decline"
  | "momentum"
  | "insider_cluster";

export interface LookCloserCard {
  ticker: string;
  /** One-line "why" e.g. "Earnings T-12d. Last research 47d ago." */
  reason: string;
  reasonType: LookCloserReason;
  /** Short tag e.g. "EARNINGS T-12d", "STALE 47d", "MOVER +2.3%". */
  badge: string;
  /** CSS color var (e.g. "var(--buy)") for the badge accent. */
  badgeBg: string;
  /** Today's change pct as a fraction (0.023 = +2.3%). null if unknown. */
  changePct: number | null;
  /** Position weight as a percentage of non-cash portfolio (0-100). null if unknown. */
  currentPct: number | null;
}

const MAX_CARDS = 8;
const STALE_REC_DAYS = 30;
const EARNINGS_WINDOW_DAYS = 30;
const CONCENTRATION_THRESHOLD_PCT = 5.0;
const MOVER_THRESHOLD_PCT = 2.0;

interface HeldRow {
  ticker: string;
  weight: number | null;
  changePct: number | null;
}

interface EarningsRow {
  ticker: string;
  daysToEvent: number;
  eventDate: string;
}

interface StaleRecRow {
  ticker: string;
  daysAgo: number;
}

/**
 * Pull held tickers with their non-cash portfolio weight + latest
 * change_pct (today's mover). De-dupes ticker rows from multi-account
 * holdings via a CTE — same approach hero-loader's top-movers query
 * uses.
 */
async function loadHeldTickers(userId: string): Promise<HeldRow[]> {
  try {
    const { rows } = await pool.query<{
      ticker: string;
      weightPct: string | number | null;
      change_pct: string | number | null;
    }>(
      `WITH totals AS (
         SELECT SUM(COALESCE("lastValue", 0)) AS total
           FROM "holding"
          WHERE "userId" = $1
            AND "assetClass" IS DISTINCT FROM 'cash'
       ),
       per_ticker AS (
         SELECT ticker, SUM(COALESCE("lastValue", 0)) AS value
           FROM "holding"
          WHERE "userId" = $1
            AND "assetClass" IS DISTINCT FROM 'cash'
          GROUP BY ticker
       ),
       latest_market AS (
         SELECT DISTINCT ON (ticker)
                ticker, change_pct
           FROM "ticker_market_daily"
          WHERE captured_at >= CURRENT_DATE - INTERVAL '5 days'
          ORDER BY ticker, captured_at DESC
       )
       SELECT p.ticker AS ticker,
              (p.value / NULLIF(t.total, 0) * 100) AS "weightPct",
              m.change_pct AS change_pct
         FROM per_ticker p
         CROSS JOIN totals t
         LEFT JOIN latest_market m ON UPPER(m.ticker) = UPPER(p.ticker)
        WHERE p.value > 0
        ORDER BY p.value DESC`,
      [userId],
    );
    return rows.map((r) => ({
      ticker: r.ticker.toUpperCase(),
      weight: r.weightPct === null ? null : Number(r.weightPct),
      changePct: r.change_pct === null ? null : Number(r.change_pct),
    }));
  } catch (err) {
    log.warn("research.look-closer", "loadHeldTickers failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Earnings events on held tickers in the next EARNINGS_WINDOW_DAYS.
 * Returned shape: { ticker, daysToEvent, eventDate }. Multiple events
 * per ticker keep only the soonest.
 */
async function loadUpcomingEarnings(userId: string): Promise<EarningsRow[]> {
  try {
    const { rows } = await pool.query<{
      ticker: string;
      daysToEvent: string | number;
      eventDate: Date | string;
    }>(
      `WITH user_tickers AS (
         SELECT DISTINCT UPPER(ticker) AS ticker
           FROM "holding"
          WHERE "userId" = $1
            AND "assetClass" IS DISTINCT FROM 'cash'
       ),
       per_ticker AS (
         SELECT DISTINCT ON (e.ticker)
                e.ticker AS ticker,
                e.event_date AS "eventDate",
                (e.event_date - CURRENT_DATE)::int AS "daysToEvent"
           FROM "ticker_events" e
           JOIN user_tickers u ON u.ticker = UPPER(e.ticker)
          WHERE e.event_type = 'earnings'
            AND e.event_date >= CURRENT_DATE
            AND e.event_date <= CURRENT_DATE + INTERVAL '${EARNINGS_WINDOW_DAYS} days'
          ORDER BY e.ticker, e.event_date ASC
       )
       SELECT * FROM per_ticker ORDER BY "daysToEvent" ASC`,
      [userId],
    );
    return rows.map((r) => ({
      ticker: r.ticker.toUpperCase(),
      daysToEvent: Number(r.daysToEvent),
      eventDate:
        r.eventDate instanceof Date
          ? r.eventDate.toISOString().slice(0, 10)
          : String(r.eventDate).slice(0, 10),
    }));
  } catch (err) {
    log.warn("research.look-closer", "loadUpcomingEarnings failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}

/**
 * Latest recommendation per held ticker that's older than
 * STALE_REC_DAYS. Anchored to held tickers only — a stale rec on a
 * ticker the user no longer owns is not a "look closer" item.
 */
async function loadStaleRecs(userId: string): Promise<StaleRecRow[]> {
  try {
    const { rows } = await pool.query<{
      ticker: string;
      daysAgo: string | number;
    }>(
      `WITH user_tickers AS (
         SELECT DISTINCT UPPER(ticker) AS ticker
           FROM "holding"
          WHERE "userId" = $1
            AND "assetClass" IS DISTINCT FROM 'cash'
       ),
       latest AS (
         SELECT DISTINCT ON (UPPER(r.ticker))
                UPPER(r.ticker) AS ticker,
                r."createdAt" AS created_at
           FROM "recommendation" r
          WHERE r."userId" = $1
          ORDER BY UPPER(r.ticker), r."createdAt" DESC
       )
       SELECT l.ticker AS ticker,
              EXTRACT(DAY FROM NOW() - l.created_at)::int AS "daysAgo"
         FROM latest l
         JOIN user_tickers u ON u.ticker = l.ticker
        WHERE l.created_at < NOW() - INTERVAL '${STALE_REC_DAYS} days'
        ORDER BY l.created_at ASC`,
      [userId],
    );
    return rows.map((r) => ({
      ticker: r.ticker.toUpperCase(),
      daysAgo: Number(r.daysAgo),
    }));
  } catch (err) {
    log.warn("research.look-closer", "loadStaleRecs failed", {
      userId,
      ...errorInfo(err),
    });
    return [];
  }
}

function fmtSignedPct(pctRaw: number): string {
  const sign = pctRaw > 0 ? "+" : pctRaw < 0 ? "" : "";
  return `${sign}${pctRaw.toFixed(1)}%`;
}

/**
 * Compose the look-closer cards for a user.
 *
 * Returns an empty array when the user holds nothing. When held but no
 * signals fire, returns a single fallback card if any holding has
 * |change_pct| >= MOVER_THRESHOLD_PCT today; otherwise empty.
 */
export async function getLookCloserCards(
  userId: string,
): Promise<LookCloserCard[]> {
  const [held, earnings, staleRecs] = await Promise.all([
    loadHeldTickers(userId),
    loadUpcomingEarnings(userId),
    loadStaleRecs(userId),
  ]);

  if (held.length === 0) return [];

  const heldByTicker = new Map(held.map((h) => [h.ticker, h]));
  const earningsByTicker = new Map(earnings.map((e) => [e.ticker, e]));
  const staleByTicker = new Map(staleRecs.map((r) => [r.ticker, r]));

  // Track which tickers have already been claimed by a higher-priority
  // signal so we don't double-emit a card with a weaker reason.
  const claimed = new Set<string>();
  const cards: LookCloserCard[] = [];

  // Priority 1 — earnings. Soonest first.
  for (const e of earnings) {
    if (cards.length >= MAX_CARDS) break;
    if (claimed.has(e.ticker)) continue;
    const h = heldByTicker.get(e.ticker);
    if (!h) continue;
    claimed.add(e.ticker);
    cards.push({
      ticker: e.ticker,
      reasonType: "earnings",
      reason: `Earnings T-${e.daysToEvent}d (${e.eventDate}). Worth a closer look before the print.`,
      badge: `EARNINGS T-${e.daysToEvent}d`,
      badgeBg: "var(--hold)",
      changePct: h.changePct === null ? null : h.changePct / 100,
      currentPct: h.weight,
    });
  }

  // Priority 2 — stale recommendations. Oldest first.
  for (const r of staleRecs) {
    if (cards.length >= MAX_CARDS) break;
    if (claimed.has(r.ticker)) continue;
    const h = heldByTicker.get(r.ticker);
    if (!h) continue;
    claimed.add(r.ticker);
    cards.push({
      ticker: r.ticker,
      reasonType: "stale_rec",
      reason: `Last research ${r.daysAgo}d ago — thesis may have drifted.`,
      badge: `STALE ${r.daysAgo}d`,
      badgeBg: "var(--muted-foreground)",
      changePct: h.changePct === null ? null : h.changePct / 100,
      currentPct: h.weight,
    });
  }

  // Priority 3 — concentration breaches. Largest weight first.
  const concentrated = held
    .filter(
      (h) =>
        h.weight !== null &&
        Number.isFinite(h.weight) &&
        h.weight > CONCENTRATION_THRESHOLD_PCT,
    )
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  for (const h of concentrated) {
    if (cards.length >= MAX_CARDS) break;
    if (claimed.has(h.ticker)) continue;
    claimed.add(h.ticker);
    const w = h.weight ?? 0;
    cards.push({
      ticker: h.ticker,
      reasonType: "concentration",
      reason: `${w.toFixed(1)}% of your book — over the 5% concentration cap.`,
      badge: `${w.toFixed(1)}% WEIGHT`,
      badgeBg: "var(--sell)",
      changePct: h.changePct === null ? null : h.changePct / 100,
      currentPct: w,
    });
  }

  // Priority 4 — fallback movers ≥ ±MOVER_THRESHOLD_PCT today. Sorted
  // by absolute move so the largest catches the eye first. Only fills
  // remaining slots; never displaces a higher-priority card.
  const movers = held
    .filter(
      (h) =>
        h.changePct !== null &&
        Number.isFinite(h.changePct) &&
        Math.abs(h.changePct) >= MOVER_THRESHOLD_PCT,
    )
    .sort(
      (a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0),
    );
  for (const h of movers) {
    if (cards.length >= MAX_CARDS) break;
    if (claimed.has(h.ticker)) continue;
    claimed.add(h.ticker);
    const pct = h.changePct ?? 0;
    cards.push({
      ticker: h.ticker,
      reasonType: "mover",
      reason: `${fmtSignedPct(pct)} today — outsized move worth understanding.`,
      badge: `MOVER ${fmtSignedPct(pct)}`,
      badgeBg: pct >= 0 ? "var(--buy)" : "var(--sell)",
      changePct: pct / 100,
      currentPct: h.weight,
    });
  }

  return cards.slice(0, MAX_CARDS);
}
