import { NextRequest, NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(req: NextRequest) {
  let body: { email?: string; name?: string; portfolioSize?: string; source?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

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
        body.name?.trim() || null,
        body.portfolioSize?.trim() || null,
        body.source?.trim() || null,
        body.notes?.trim() || null,
        ip,
        userAgent,
      ]
    );

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("[waitlist] insert failed", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
