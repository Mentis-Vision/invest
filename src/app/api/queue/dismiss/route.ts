// src/app/api/queue/dismiss/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";

const VALID_REASONS = [
  "already_handled",
  "disagree",
  "not_applicable",
  "other",
] as const;

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { itemKey?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const itemKey = body.itemKey;
  const reason = body.reason ?? "other";
  if (!itemKey || typeof itemKey !== "string" || itemKey.length > 200) {
    return NextResponse.json({ error: "invalid_item_key" }, { status: 400 });
  }
  if (!VALID_REASONS.includes(reason as (typeof VALID_REASONS)[number])) {
    return NextResponse.json({ error: "invalid_reason" }, { status: 400 });
  }

  await pool.query(
    `INSERT INTO decision_queue_state ("userId", item_key, status, dismiss_reason)
     VALUES ($1, $2, 'dismissed', $3)
     ON CONFLICT ("userId", item_key)
     DO UPDATE SET status = 'dismissed', dismiss_reason = $3, "updatedAt" = NOW()`,
    [session.user.id, itemKey, reason],
  );

  log.info("queue", "queue.dismiss", {
    userId: session.user.id,
    itemKey,
    reason,
  });
  return NextResponse.json({ ok: true });
}
