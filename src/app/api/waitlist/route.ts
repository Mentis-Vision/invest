import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { checkRateLimit, RULES, getClientIp } from "@/lib/rate-limit";
import { log, errorInfo } from "@/lib/log";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  // Spam protection — waitlist is public so IP-rate-limited only
  const rl = await checkRateLimit(RULES.waitlistIp, ip);
  if (!rl.ok) {
    log.warn("waitlist", "rate limit hit", { ip });
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let body: { email?: string; name?: string; portfolioSize?: string; source?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  // Safe-length truncation on all user-provided fields
  const clip = (s: string | null | undefined, max: number) =>
    s ? s.slice(0, max) : null;

  try {
    await pool.query(
      `INSERT INTO "waitlist" ("email", "name", "portfolioSize", "source", "notes", "ipAddress", "userAgent")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ("email") DO UPDATE SET
         "name" = COALESCE(EXCLUDED."name", "waitlist"."name"),
         "portfolioSize" = COALESCE(EXCLUDED."portfolioSize", "waitlist"."portfolioSize"),
         "notes" = COALESCE(EXCLUDED."notes", "waitlist"."notes")`,
      [
        email,
        clip(body.name?.trim() || null, 200),
        clip(body.portfolioSize?.trim() || null, 100),
        clip(body.source?.trim() || null, 100),
        clip(body.notes?.trim() || null, 2000),
        ip,
        userAgent,
      ]
    );
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    log.error("waitlist", "insert failed", { email, ...errorInfo(err) });
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
