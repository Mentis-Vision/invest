import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getMacroSnapshot } from "@/lib/data/fred";
import { log, errorInfo } from "@/lib/log";

// Auth-gated — avoids anonymous hammering of FRED via our key.
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await getMacroSnapshot();
    return NextResponse.json({ snapshot });
  } catch (err) {
    log.error("macro", "failed", { ...errorInfo(err) });
    return NextResponse.json({ snapshot: [] });
  }
}
