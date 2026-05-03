import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";
import {
  isPresetKey,
  validateCustomTicker,
  DEFAULT_BENCHMARKS,
} from "@/lib/dashboard/benchmark-resolver";

const MAX_BENCHMARKS = 4;

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await pool.query<{ benchmarks: string[] | null }>(
    `SELECT benchmarks FROM user_profile WHERE "userId" = $1`,
    [session.user.id],
  );
  const stored = result.rows[0]?.benchmarks;
  const keys =
    Array.isArray(stored) && stored.length > 0
      ? stored.slice(0, MAX_BENCHMARKS).map(String)
      : [...DEFAULT_BENCHMARKS];
  return NextResponse.json({ ok: true, benchmarks: keys });
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { benchmarks?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const raw = body.benchmarks;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "benchmarks_must_be_array" }, { status: 400 });
  }
  if (raw.length === 0 || raw.length > MAX_BENCHMARKS) {
    return NextResponse.json(
      { error: `benchmarks_count_must_be_1_to_${MAX_BENCHMARKS}` },
      { status: 400 },
    );
  }

  const cleaned: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length > 30) {
      return NextResponse.json({ error: "invalid_benchmark_entry" }, { status: 400 });
    }
    if (isPresetKey(entry)) {
      cleaned.push(entry);
      continue;
    }
    const validation = await validateCustomTicker(entry);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: "ticker_not_supported",
          ticker: entry,
          historyDays: validation.historyDays,
        },
        { status: 400 },
      );
    }
    cleaned.push(validation.ticker);
  }

  await pool.query(
    `INSERT INTO user_profile ("userId", benchmarks)
     VALUES ($1, $2::jsonb)
     ON CONFLICT ("userId")
     DO UPDATE SET benchmarks = $2::jsonb, "updatedAt" = NOW()`,
    [session.user.id, JSON.stringify(cleaned)],
  );

  log.info("user.benchmarks", "saved", {
    userId: session.user.id,
    count: cleaned.length,
  });
  return NextResponse.json({ ok: true, benchmarks: cleaned });
}
