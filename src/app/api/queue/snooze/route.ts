// src/app/api/queue/snooze/route.ts
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

  const snoozeUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO decision_queue_state ("userId", item_key, status, "snoozeUntil")
     VALUES ($1, $2, 'snoozed', $3)
     ON CONFLICT ("userId", item_key)
     DO UPDATE SET status = 'snoozed', "snoozeUntil" = $3, "updatedAt" = NOW()`,
    [session.user.id, itemKey, snoozeUntil],
  );

  log.info("queue", "queue.snooze", { userId: session.user.id, itemKey });
  return NextResponse.json({ ok: true, snoozeUntil });
}
