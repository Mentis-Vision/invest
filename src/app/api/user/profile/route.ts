import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserProfile, upsertUserProfile } from "@/lib/user-profile";
import { log, errorInfo } from "@/lib/log";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const profile = await getUserProfile(session.user.id);
    return NextResponse.json({ profile });
  } catch (err) {
    log.error("user.profile", "GET failed", { ...errorInfo(err) });
    return NextResponse.json({ error: "Could not load profile" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // user-profile.sanitizeUpdate handles validation + truncation; we pass
  // through whatever shape the client sent and let it narrow safely.
  try {
    const profile = await upsertUserProfile(
      session.user.id,
      body as Parameters<typeof upsertUserProfile>[1]
    );
    return NextResponse.json({ profile });
  } catch (err) {
    log.error("user.profile", "POST failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not save profile" },
      { status: 500 }
    );
  }
}
