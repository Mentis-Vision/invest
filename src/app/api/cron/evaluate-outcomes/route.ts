import { NextRequest, NextResponse } from "next/server";
import {
  evaluatePendingOutcomes,
  linkTradesToRecommendations,
} from "@/lib/outcomes";
import { log, errorInfo } from "@/lib/log";
import { snaptradeConfigured, decryptSecret } from "@/lib/snaptrade";
import { syncUserActivities } from "@/app/api/snaptrade/sync/route";
import { pool } from "@/lib/db";
import {
  scanPriceMoves,
  scanInsiderActivity,
  scanConcentration,
} from "@/lib/alerts";
import { getMacroSnapshot } from "@/lib/data/fred";

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
