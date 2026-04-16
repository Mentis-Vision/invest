import { NextRequest, NextResponse } from "next/server";
import {
  evaluatePendingOutcomes,
  linkTradesToRecommendations,
} from "@/lib/outcomes";
import { log, errorInfo } from "@/lib/log";
import { snaptradeConfigured, decryptSecret } from "@/lib/snaptrade";
import { syncUserActivities } from "@/app/api/snaptrade/sync/route";
import { pool } from "@/lib/db";

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

  result.durationMs = Date.now() - started;
  log.info("cron", "run complete", result);
  return NextResponse.json(result);
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
