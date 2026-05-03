// src/app/api/cron/headline-rebuild/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { errorInfo, log } from "@/lib/log";
import { buildQueueForUser } from "@/lib/dashboard/queue-builder";

export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron.headline-rebuild", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Active users — anyone with a session in the last 7 days.
  const usersResult = await pool.query<{ id: string }>(
    `SELECT DISTINCT u.id
     FROM "user" u
     INNER JOIN "session" s ON s."userId" = u.id
     WHERE s."expiresAt" > NOW() - INTERVAL '7 days'`,
  );

  let rebuilt = 0;
  let failed = 0;
  for (const { id: userId } of usersResult.rows) {
    try {
      const items = await buildQueueForUser(userId);
      const top = items[0] ?? null;
      const cache = top
        ? { itemKey: top.itemKey, rendered: top, cachedAt: new Date().toISOString() }
        : null;
      await pool.query(
        `UPDATE user_profile
         SET headline_cache = $1, headline_cached_at = NOW()
         WHERE "userId" = $2`,
        [cache ? JSON.stringify(cache) : null, userId],
      );
      rebuilt++;
    } catch (err) {
      failed++;
      log.error("cron.headline-rebuild", "headline-rebuild.user-failed", {
        userId,
        ...errorInfo(err),
      });
    }
  }

  log.info("cron.headline-rebuild", "headline-rebuild.complete", {
    rebuilt,
    failed,
  });
  return NextResponse.json({ ok: true, rebuilt, failed });
}
