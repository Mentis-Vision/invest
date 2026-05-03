// src/app/api/queue/headline-refresh/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";
import { buildQueueForUser } from "@/lib/dashboard/queue-builder";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const items = await buildQueueForUser(session.user.id);
  const top = items[0] ?? null;
  const cache = top
    ? { itemKey: top.itemKey, rendered: top, cachedAt: new Date().toISOString() }
    : null;

  await pool.query(
    `UPDATE user_profile
     SET headline_cache = $1, headline_cached_at = NOW()
     WHERE "userId" = $2`,
    [cache ? JSON.stringify(cache) : null, session.user.id],
  );

  log.info("queue", "queue.headline-refresh", {
    userId: session.user.id,
    itemKey: top?.itemKey ?? null,
  });
  return NextResponse.json({ ok: true, headline: top });
}
