// src/app/api/chip-prefs/route.ts
// Phase 3 Batch H — GET / POST endpoint for the user's chip prefs.
//
// Auth-gated by both the proxy matcher and a redundant in-route
// session check (the proxy can't see the body shape; in-route check
// gives us userId).
//
// POST validates the body shape — pinned and hidden must be string
// arrays of reasonable length. Any other shape is rejected with 400
// to avoid persisting garbage; chip-prefs.ts also re-coerces
// defensively before write.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getChipPrefs, saveChipPrefs } from "@/lib/dashboard/chip-prefs";
import { log, errorInfo } from "@/lib/log";

const MAX_LIST_LEN = 100;
const MAX_KEY_LEN = 64;

function isValidStringArray(v: unknown): v is string[] {
  if (!Array.isArray(v)) return false;
  if (v.length > MAX_LIST_LEN) return false;
  for (const item of v) {
    if (typeof item !== "string") return false;
    if (item.length === 0 || item.length > MAX_KEY_LEN) return false;
  }
  return true;
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const prefs = await getChipPrefs(session.user.id);
    return NextResponse.json({ ok: true, prefs });
  } catch (err) {
    log.error("chip-prefs", "chip_prefs.get_failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { pinned?: unknown; hidden?: unknown };
  try {
    body = (await req.json()) as { pinned?: unknown; hidden?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const pinned = body.pinned ?? [];
  const hidden = body.hidden ?? [];

  if (!isValidStringArray(pinned)) {
    return NextResponse.json({ error: "invalid_pinned" }, { status: 400 });
  }
  if (!isValidStringArray(hidden)) {
    return NextResponse.json({ error: "invalid_hidden" }, { status: 400 });
  }

  try {
    await saveChipPrefs(session.user.id, { pinned, hidden });
    log.info("chip-prefs", "chip_prefs.saved", {
      userId: session.user.id,
      pinned: pinned.length,
      hidden: hidden.length,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("chip-prefs", "chip_prefs.save_failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
