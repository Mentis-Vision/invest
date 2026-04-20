import { NextRequest, NextResponse } from "next/server";
import {
  evaluatePendingOutcomes,
  linkTradesToRecommendations,
} from "@/lib/outcomes";
import { log, errorInfo } from "@/lib/log";
import { reconcileAllUsers } from "@/lib/reconciliation";
import { snaptradeConfigured, decryptSecret } from "@/lib/snaptrade";
import { syncUserActivities } from "@/app/api/snaptrade/sync/route";
import {
  plaidConfigured,
  syncHoldings as syncPlaidHoldings,
  syncTransactions as syncPlaidTransactions,
  accrueDailyPlaidCost,
  cleanupInactivePlaidItems,
} from "@/lib/plaid";
import { pool } from "@/lib/db";
import {
  scanPriceMoves,
  scanInsiderActivity,
  scanConcentration,
} from "@/lib/alerts";
import { getMacroSnapshot } from "@/lib/data/fred";
import { refreshWarehouse } from "@/lib/warehouse/refresh";
import {
  generatePortfolioReview,
  getCachedPortfolioReview,
} from "@/lib/portfolio-review";
import { refreshEditorialNews } from "@/lib/warehouse/refresh/editorial-news";

/**
 * Daily cron:
 * 1. Pull recent SnapTrade activities for every connected user.
 * 2. Link those trades back to recommendations.
 * 3. Evaluate all outcome rows whose checkAt has passed.
 *
 * Protected by Bearer token from CRON_SECRET env var. Vercel's cron runner
 * sets `Authorization: Bearer <CRON_SECRET>` when the project's env has it.
 *
 * Registered in vercel.json:
 *   { "path": "/api/cron/evaluate-outcomes", "schedule": "0 14 * * *" }
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const result: Record<string, unknown> = {};

  // 1. SnapTrade sync
  if (snaptradeConfigured()) {
    try {
      result.snaptrade = await syncAllSnaptradeUsers();
    } catch (err) {
      log.error("cron", "snaptrade sync block failed", errorInfo(err));
      result.snaptrade = { error: "failed" };
    }
  } else {
    result.snaptrade = { skipped: "not_configured" };
  }

  // 1b. Plaid sync — holdings + transactions for every active Item.
  // Plaid auto-refreshes holdings throughout the day via its own
  // fetchers (included in the $0.35/Item/mo subscription), and
  // webhooks tell us when new transactions arrive; this nightly pass
  // is a belt-and-suspenders reconciliation. No /investments/refresh
  // calls — that would be the $0.12/each charge.
  try {
    result.plaid = await syncAllPlaidItems();
  } catch (err) {
    log.error("cron", "plaid sync block failed", errorInfo(err));
    result.plaid = { error: "failed" };
  }

  // 1c. Plaid daily cost accrual — 1/30 of $0.35 per active Item,
  // added to user.monthlyCostCents so Plaid spend is visible in the
  // same counter that already gates AI spend. Runs once per 24h.
  try {
    result.plaidCost = await accrueDailyPlaidCost();
  } catch (err) {
    log.error("cron", "plaid cost accrual failed", errorInfo(err));
    result.plaidCost = { error: "failed" };
  }

  // 1d. Plaid inactive-user cleanup — remove Items for users with no
  // sessions in the last 90 days. `/item/remove` is free and stops
  // the $0.35/Item/mo recurring charge. Users can re-link on return.
  try {
    result.plaidCleanup = await cleanupInactivePlaidItems(90);
  } catch (err) {
    log.error("cron", "plaid cleanup failed", errorInfo(err));
    result.plaidCleanup = { error: "failed" };
  }

  // 1e. Reconcile broker trades vs self-reported journal entries
  try {
    result.reconciliation = await reconcileAllUsers();
  } catch (err) {
    log.error("cron", "reconciliation failed", errorInfo(err));
    result.reconciliation = { error: "failed" };
  }

  // 2. Link trades → recommendations
  try {
    result.linked = await linkTradesToRecommendations();
  } catch (err) {
    log.error("cron", "linkTrades failed", errorInfo(err));
    result.linked = { error: "failed" };
  }

  // 3. Evaluate due outcomes
  try {
    result.outcomes = await evaluatePendingOutcomes(500);
  } catch (err) {
    log.error("cron", "evaluate failed", errorInfo(err));
    result.outcomes = { error: "failed" };
  }

  // 4. Daily portfolio snapshot per user (cheap — one row per user, $0 AI)
  try {
    result.portfolioSnapshot = await snapshotAllPortfolios();
  } catch (err) {
    log.error("cron", "portfolio snapshot failed", errorInfo(err));
    result.portfolioSnapshot = { error: "failed" };
  }

  // 5. Daily macro snapshot (single FRED hit, persisted for history)
  try {
    result.macroSnapshot = await snapshotMacro();
  } catch (err) {
    log.error("cron", "macro snapshot failed", errorInfo(err));
    result.macroSnapshot = { error: "failed" };
  }

  // 6. Alert generators — price moves, insider activity, concentration
  try {
    result.alerts = {
      priceMoves: await scanPriceMoves(),
      insider: await scanInsiderActivity(3),
      concentration: await scanConcentration(),
    };
  } catch (err) {
    log.error("cron", "alert scan failed", errorInfo(err));
    result.alerts = { error: "failed" };
  }

  // 7. Pre-warm public-data caches for the top 25 most-researched tickers
  //    across all users (last 7 days) — hits Yahoo + SEC so the Vercel
  //    fetch cache has them ready for morning queries.
  try {
    result.prewarm = await prewarmTrendingTickers(25);
  } catch (err) {
    log.warn("cron", "prewarm failed", errorInfo(err));
    result.prewarm = { error: "failed" };
  }

  // 8. Warehouse refresh — populates 5 ticker-keyed tables from free sources.
  //    $0 AI. Universe is the set of tickers currently held by any user;
  //    getTickerUniverse() returns only string[], no userId ever leaves it.
  try {
    result.warehouse = await refreshWarehouse();
  } catch (err) {
    log.error("cron", "warehouse refresh failed", errorInfo(err));
    result.warehouse = { error: "failed" };
  }

  // 9. Editorial news sweep — pull WSJ / CNBC / MarketWatch / Barron's
  //    / IBD / Stock Analysis / Seeking Alpha / Damodaran / Oaktree /
  //    SEC EDGAR. Extract ticker mentions against the holdings
  //    universe. Upsert into market_news_daily. Done ahead of the
  //    portfolio review so the review prompt can reference today's
  //    headlines on held tickers.
  try {
    result.editorialNews = await refreshEditorialNews();
  } catch (err) {
    log.error("cron", "editorial news refresh failed", errorInfo(err));
    result.editorialNews = { error: "failed" };
  }

  // 10. Auto-run AI portfolio review per connected user. Pre-computing
  //    overnight means first-login the next morning loads a stored
  //    review with $0 spent. Users opted into "auto every night" over
  //    "click to spend tokens" — the AI is the value, not the gating.
  //    Skips users who already have today's row (idempotent if cron
  //    fires twice; safe re-run after partial failures).
  try {
    result.portfolioReviews = await runNightlyPortfolioReviews();
  } catch (err) {
    log.error("cron", "portfolio reviews failed", errorInfo(err));
    result.portfolioReviews = { error: "failed" };
  }

  result.durationMs = Date.now() - started;
  log.info("cron", "run complete", result);
  return NextResponse.json(result);
}

async function prewarmTrendingTickers(
  limit: number
): Promise<{ warmed: number; tickers: string[] }> {
  const { rows } = await pool.query(
    `SELECT ticker, COUNT(*)::int AS n
     FROM "recommendation"
     WHERE "createdAt" > NOW() - INTERVAL '7 days'
     GROUP BY ticker
     ORDER BY n DESC
     LIMIT $1`,
    [limit]
  );
  const tickers = (rows as { ticker: string }[]).map((r) => r.ticker);
  if (tickers.length === 0) return { warmed: 0, tickers: [] };

  // Fire snapshot + filings in parallel, cap concurrency at 4.
  const { getStockSnapshot } = await import("@/lib/data/yahoo");
  const { getRecentFilings } = await import("@/lib/data/sec");
  let cursor = 0;
  let warmed = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const t = tickers[idx];
      try {
        await Promise.all([getStockSnapshot(t), getRecentFilings(t, 5)]);
        warmed++;
      } catch {
        /* individual failures are fine — Vercel fetch cache just stays cold */
      }
    }
  }
  const workers = Array.from({ length: Math.min(4, tickers.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return { warmed, tickers };
}

/**
 * Write a portfolio_snapshot row per user capturing total value and
 * an asset-class breakdown. Idempotent per (userId, capturedAt::date).
 * Pure SQL — no external calls, so runs in ~100ms even for hundreds of users.
 */
async function snapshotAllPortfolios(): Promise<{ users: number }> {
  const res = await pool.query(
    `WITH per_user AS (
       SELECT
         "userId",
         SUM(COALESCE("lastValue", 0))::numeric(14,2) AS total,
         COUNT(*)::int AS positions,
         jsonb_object_agg(
           COALESCE("assetClass", 'unclassified'),
           class_total
         ) AS by_class
       FROM (
         SELECT
           "userId",
           COALESCE("assetClass", 'unclassified') AS "assetClass",
           "lastValue",
           SUM(COALESCE("lastValue", 0))
             OVER (PARTITION BY "userId", COALESCE("assetClass", 'unclassified'))
             ::numeric(14,2) AS class_total
         FROM "holding"
         WHERE "lastValue" IS NOT NULL
       ) x
       GROUP BY "userId"
     )
     INSERT INTO "portfolio_snapshot"
       (id, "userId", "capturedAt", "totalValue", "positionCount", "byAssetClass")
     SELECT
       gen_random_uuid()::text,
       "userId",
       CURRENT_DATE,
       total,
       positions,
       by_class
     FROM per_user
     ON CONFLICT ("userId", "capturedAt") DO UPDATE SET
       "totalValue" = EXCLUDED."totalValue",
       "positionCount" = EXCLUDED."positionCount",
       "byAssetClass" = EXCLUDED."byAssetClass"
     RETURNING "userId"`
  );
  return { users: res.rowCount ?? 0 };
}

/**
 * Capture today's macro snapshot for history (used by future sparkline +
 * "macro moved today" detection).
 */
async function snapshotMacro(): Promise<{ written: boolean }> {
  const snapshot = await getMacroSnapshot();
  if (snapshot.length === 0) return { written: false };
  await pool.query(
    `INSERT INTO "macro_daily_snapshot" (id, "capturedAt", payload)
     VALUES (gen_random_uuid()::text, CURRENT_DATE, $1::jsonb)
     ON CONFLICT ("capturedAt") DO UPDATE SET payload = EXCLUDED.payload`,
    [JSON.stringify(snapshot)]
  );
  return { written: true };
}

/**
 * Pre-compute the AI portfolio review for every user who has holdings.
 *
 * Sequential by design — three-model panel + supervisor is moderately
 * expensive (~$0.21 per user) and we don't want to slam the providers.
 * Skip-on-cache (today's row already exists) means partial failures are
 * naturally idempotent: a re-run only generates for users who didn't
 * succeed the first time.
 *
 * Per-user errors are logged but don't fail the batch — one user's
 * weird holding shouldn't block everyone else's overnight review.
 */
async function runNightlyPortfolioReviews(): Promise<{
  users: number;
  generated: number;
  skipped: number;
  failed: number;
}> {
  const { rows } = await pool.query(
    `SELECT DISTINCT "userId"
       FROM "holding"
      WHERE "userId" IS NOT NULL
        AND "lastValue" > 0`
  );
  const userIds = (rows as Array<{ userId: string }>).map((r) => r.userId);
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  for (const userId of userIds) {
    try {
      const cached = await getCachedPortfolioReview(userId);
      if (cached) {
        skipped++;
        continue;
      }
      await generatePortfolioReview(userId);
      generated++;
    } catch (err) {
      failed++;
      log.warn("cron.portfolio-review", "user failed", {
        userId,
        ...errorInfo(err),
      });
    }
  }
  return { users: userIds.length, generated, skipped, failed };
}

/**
 * Sync every active Plaid Item. Pulls holdings (authoritative
 * snapshot) and the last 7 days of investment transactions. Any Item
 * that's been marked `login_required` is skipped — the user needs to
 * reauth via Link before we can talk to it. `itemRemove()` is free
 * and already invoked when a user clicks Disconnect — so `removed`
 * Items are filtered at the SQL level.
 */
async function syncAllPlaidItems(): Promise<{
  items: number;
  holdings: number;
  transactions: number;
  errors: number;
}> {
  if (!plaidConfigured()) {
    return { items: 0, holdings: 0, transactions: 0, errors: 0 };
  }
  const { rows } = await pool.query(
    `SELECT "userId", "itemId"
     FROM "plaid_item"
     WHERE "status" = 'active'`
  );
  let holdings = 0;
  let transactions = 0;
  let errors = 0;
  for (const r of rows as Array<{ userId: string; itemId: string }>) {
    try {
      const hres = await syncPlaidHoldings(r.userId, r.itemId);
      holdings += hres.holdings;
      errors += hres.errors.length;
      const tres = await syncPlaidTransactions(r.userId, r.itemId, 7);
      transactions += tres.inserted;
      errors += tres.errors.length;
    } catch (err) {
      log.warn("cron.plaid", "item sync failed", {
        itemId: r.itemId,
        ...errorInfo(err),
      });
      errors++;
    }
  }
  return { items: rows.length, holdings, transactions, errors };
}

async function syncAllSnaptradeUsers(): Promise<{
  users: number;
  newTrades: number;
}> {
  const { rows } = await pool.query(
    `SELECT "userId", "snaptradeUserId", "userSecretEncrypted" FROM "snaptrade_user"`
  );

  let newTrades = 0;
  for (const r of rows) {
    try {
      const userSecret = decryptSecret(r.userSecretEncrypted as string);
      const added = await syncUserActivities(
        r.userId as string,
        r.snaptradeUserId as string,
        userSecret,
        14
      );
      newTrades += added;
    } catch (err) {
      log.warn("cron", "user sync failed", {
        userId: r.userId,
        ...errorInfo(err),
      });
    }
  }

  return { users: rows.length, newTrades };
}
