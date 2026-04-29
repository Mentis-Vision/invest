import { pool } from "./db";
import { log, errorInfo } from "./log";
import { default as YahooFinanceCtor } from "yahoo-finance2";
import {
  getRecentForm4Filings,
  fetchForm4Transactions,
} from "./data/insider";

/**
 * Alert generation — all $0 AI cost.
 *
 * Design principle: detect "interesting" changes to user holdings using
 * free data sources only. Yahoo for price, SEC EDGAR for Form 4,
 * Finnhub (when configured) for news sentiment. Each generator writes
 * to `alert_event` with a stable dedup key so re-running the cron
 * doesn't duplicate alerts.
 *
 * The AI pipeline NEVER runs during alert generation. AI kicks in only
 * when the user clicks "why?" on an alert → that's a normal /api/research
 * call billed as a fresh query.
 */

const yahoo = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

/** Percent move threshold that triggers a price-movement alert. */
const PRICE_MOVE_PCT = 5;
/** Dollar threshold for Form 4 open-market transactions. */
const INSIDER_DOLLAR_MIN = 10_000;

type HoldingRow = {
  userId: string;
  ticker: string;
  assetClass: string | null;
  shares: number;
  lastPrice: number | null;
};

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Insert an alert; idempotent via (userId, kind, ticker, dedupKey) index.
 * Returns true if it was a fresh insert.
 */
export async function upsertAlert(input: {
  userId: string;
  kind: string;
  ticker?: string | null;
  severity?: "info" | "warn" | "action";
  title: string;
  body?: string | null;
  metadata: Record<string, unknown>; // must contain dedupKey
}): Promise<boolean> {
  try {
    // Dedup key is required. We reference the partial unique index
    // alert_event_dedup_uniq so PostgreSQL knows what conflict to ignore.
    const res = await pool.query(
      `INSERT INTO "alert_event"
         (id, "userId", kind, ticker, severity, title, body, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT ("userId", kind, COALESCE(ticker,''), (metadata->>'dedupKey'))
       WHERE metadata->>'dedupKey' IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        genId(),
        input.userId,
        input.kind,
        input.ticker ?? null,
        input.severity ?? "info",
        input.title.slice(0, 200),
        input.body?.slice(0, 1000) ?? null,
        JSON.stringify(input.metadata),
      ]
    );
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    log.warn("alerts", "upsert failed", {
      kind: input.kind,
      ticker: input.ticker,
      ...errorInfo(err),
    });
    return false;
  }
}

/**
 * Sanity bound — any computed price move outside this range is almost
 * certainly a data error (bad Yahoo ticker match, stale lastPrice from
 * a different currency, split adjustment artifact). Skipped silently.
 * Real equity moves >40% in a day are rare enough that this is a safe
 * ceiling; we'd rather miss a genuine black-swan alert than surface
 * "BTC down 100%" because Yahoo didn't know the ticker.
 */
const PRICE_MOVE_MAX_PCT = 40;

/**
 * Detect ≥5% price moves on user EQUITY holdings using Yahoo quote.
 * Crypto is excluded: Yahoo's crypto coverage is inconsistent for
 * anything outside BTC/ETH and the failure mode is absurd alerts
 * ("SPK down 97.7%"). Real crypto price-move alerts need a proper
 * source (CoinGecko) — tracked in DEFERRED.md.
 *
 * Dedup key includes the check date so re-runs don't duplicate.
 */
export async function scanPriceMoves(): Promise<{
  created: number;
  skippedSuspicious: number;
}> {
  const { rows } = await pool.query(
    `SELECT DISTINCT "userId", ticker, "assetClass",
            shares::float AS shares, "lastPrice"::float AS "lastPrice"
     FROM "holding"
     WHERE "lastPrice" IS NOT NULL
       AND (
         "assetClass" IS NULL
         OR "assetClass" NOT IN ('crypto')
       )`
  );
  const holdings = rows as HoldingRow[];

  const uniqueTickers = [...new Set(holdings.map((h) => h.ticker))];

  // Warehouse-first: pull latest close from ticker_market_daily.
  // Fall back to Yahoo live for tickers the warehouse doesn't cover yet
  // (e.g. ticker that was held for the first time since the last nightly run).
  const { getTickerMarketBatch } = await import("./warehouse");
  const warehouseMap = await getTickerMarketBatch(uniqueTickers);

  const prices = new Map<string, number>();
  const missingTickers: string[] = [];
  for (const ticker of uniqueTickers) {
    const row = warehouseMap.get(ticker.toUpperCase());
    if (row?.close != null && row.close > 0) {
      prices.set(ticker, row.close);
    } else {
      missingTickers.push(ticker);
    }
  }

  // Fallback: Yahoo live for warehouse misses only.
  for (const ticker of missingTickers) {
    try {
      const q = (await yahoo.quote(ticker)) as Record<string, unknown>;
      const p =
        typeof q.regularMarketPrice === "number"
          ? q.regularMarketPrice
          : null;
      if (p != null && p > 0) prices.set(ticker, p);
    } catch {
      /* skip — alert won't fire for this ticker today */
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  let created = 0;
  let skippedSuspicious = 0;

  for (const h of holdings) {
    const current = prices.get(h.ticker);
    const previous = h.lastPrice;
    if (!current || !previous || previous <= 0) continue;
    const pct = ((current - previous) / previous) * 100;
    if (Math.abs(pct) < PRICE_MOVE_PCT) continue;

    // Safety guard: never surface >40% single-day moves — almost
    // always a data artifact, not a real signal.
    if (Math.abs(pct) > PRICE_MOVE_MAX_PCT) {
      skippedSuspicious++;
      log.warn("alerts.priceMove", "suspicious move skipped", {
        ticker: h.ticker,
        previous,
        current,
        pct,
      });
      continue;
    }

    const direction = pct > 0 ? "up" : "down";
    const wasInserted = await upsertAlert({
      userId: h.userId,
      kind: "price_move",
      ticker: h.ticker,
      severity: Math.abs(pct) >= 10 ? "warn" : "info",
      title: `${h.ticker} ${direction} ${Math.abs(pct).toFixed(1)}%`,
      body: `Moved from $${previous.toFixed(2)} to $${current.toFixed(2)} since your last sync.`,
      metadata: {
        dedupKey: `price_move:${h.ticker}:${today}`,
        priorPrice: previous,
        currentPrice: current,
        percentMove: pct,
      },
    });
    if (wasInserted) created++;
  }

  return { created, skippedSuspicious };
}

/**
 * Form 4 insider activity sweep for all holdings across all users.
 * Only flags material open-market P (buy) and S (sell) transactions
 * above the dollar threshold. Directors + officers only — 10% owners
 * are noisier signal.
 *
 * Dedup key: per-user + per-accession so the same Form 4 never
 * double-alerts the same user, but different users holding the same
 * stock each get their own alert row.
 */
export async function scanInsiderActivity(
  lookbackDays = 3
): Promise<{ created: number }> {
  const { rows: tickerRows } = await pool.query(
    `SELECT DISTINCT ticker FROM "holding"
     WHERE "assetClass" IS NULL OR "assetClass" IN ('equity','etf')`
  );
  const tickers = (tickerRows as { ticker: string }[]).map((r) => r.ticker);

  let created = 0;
  const cutoff = new Date(Date.now() - lookbackDays * 86400000);

  for (const ticker of tickers) {
    try {
      const filings = await getRecentForm4Filings(ticker, 10);
      const inWindow = filings.filter((f) => new Date(f.filedOn) >= cutoff);
      if (inWindow.length === 0) continue;

      // Find which users hold this ticker
      const { rows: holders } = await pool.query(
        `SELECT DISTINCT "userId" FROM "holding" WHERE ticker = $1`,
        [ticker]
      );

      for (const filing of inWindow) {
        const txs = await fetchForm4Transactions(filing);
        for (const t of txs) {
          if (t.transactionCode !== "P" && t.transactionCode !== "S") continue;
          if (!t.isOfficer && !t.isDirector) continue;
          if (
            t.approxDollarValue == null ||
            t.approxDollarValue < INSIDER_DOLLAR_MIN
          )
            continue;

          const isBuy = t.transactionCode === "P";
          const direction = isBuy ? "buy" : "sell";
          const role = t.isOfficer ? "Officer" : "Director";
          const dollar = t.approxDollarValue;

          for (const h of holders as { userId: string }[]) {
            const fresh = await upsertAlert({
              userId: h.userId,
              kind: "insider_transaction",
              ticker,
              severity: isBuy ? "action" : "info",
              title: `${role} ${direction}: ${ticker} · $${formatDollar(dollar)}`,
              body: t.filerName
                ? `${t.filerName}${t.filerTitle ? ` (${t.filerTitle})` : ""} filed a Form 4 on ${t.transactionDate ?? filing.filedOn}.`
                : `Insider ${direction} reported on Form 4.`,
              metadata: {
                dedupKey: `insider:${filing.accession}:${direction}`,
                accession: filing.accession,
                filedOn: filing.filedOn,
                transactionCode: t.transactionCode,
                shares: t.shares,
                pricePerShare: t.pricePerShare,
                dollarValue: dollar,
                filerName: t.filerName,
                filerTitle: t.filerTitle,
                isOfficer: t.isOfficer,
                isDirector: t.isDirector,
              },
            });
            if (fresh) created++;
          }
        }
      }
    } catch (err) {
      log.warn("alerts.insider", "sweep failed for ticker", {
        ticker,
        ...errorInfo(err),
      });
    }
  }

  return { created };
}

function formatDollar(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

/**
 * Concentration alert: fires when any user's single position crosses
 * the 25% or 40% threshold. Idempotent per day-of-month.
 */
export async function scanConcentration(): Promise<{ created: number }> {
  const { rows } = await pool.query(
    `WITH user_totals AS (
       SELECT "userId", SUM(COALESCE("lastValue", 0)) AS total
       FROM "holding" GROUP BY "userId"
     )
     SELECT h."userId", h.ticker, h."lastValue"::float AS value, ut.total::float AS total
     FROM "holding" h
     JOIN user_totals ut ON ut."userId" = h."userId"
     WHERE h."lastValue" IS NOT NULL AND ut.total > 0`
  );

  let created = 0;
  const dayKey = new Date().toISOString().slice(0, 10);

  const perUserTop = new Map<string, { ticker: string; pct: number }>();
  for (const r of rows as {
    userId: string;
    ticker: string;
    value: number;
    total: number;
  }[]) {
    const pct = (r.value / r.total) * 100;
    const existing = perUserTop.get(r.userId);
    if (!existing || pct > existing.pct) {
      perUserTop.set(r.userId, { ticker: r.ticker, pct });
    }
  }

  for (const [userId, top] of perUserTop) {
    if (top.pct < 25) continue;
    const severity = top.pct >= 40 ? "warn" : "info";
    const created_ = await upsertAlert({
      userId,
      kind: "concentration",
      ticker: top.ticker,
      severity,
      title: `${top.ticker} is ${top.pct.toFixed(0)}% of your portfolio`,
      body:
        top.pct >= 40
          ? "Severe concentration — a single position above 40% is a material portfolio-level risk."
          : "Concentration flag — positions above 25% carry elevated idiosyncratic risk.",
      metadata: {
        dedupKey: `concentration:${top.ticker}:${dayKey}`,
        pct: top.pct,
      },
    });
    if (created_) created++;
  }

  return { created };
}
