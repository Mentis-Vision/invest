// src/app/api/queue/done/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { itemKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const itemKey = body.itemKey;
  if (!itemKey || typeof itemKey !== "string" || itemKey.length > 200) {
    return NextResponse.json({ error: "invalid_item_key" }, { status: 400 });
  }

  await pool.query(
    `INSERT INTO decision_queue_state ("userId", item_key, status)
     VALUES ($1, $2, 'done')
     ON CONFLICT ("userId", item_key)
     DO UPDATE SET status = 'done', "updatedAt" = NOW()`,
    [session.user.id, itemKey],
  );

  // Invalidate the precomputed daily-headline cache. See
  // src/app/app/page.tsx for the rationale — keeps any future
  // consumer of `headline_cache` from re-rendering a just-marked-
  // done item.
  await pool.query(
    `UPDATE user_profile SET headline_cache = NULL, headline_cached_at = NULL WHERE "userId" = $1`,
    [session.user.id],
  );

  log.info("queue", "queue.done", { userId: session.user.id, itemKey });
  return NextResponse.json({ ok: true });
}
