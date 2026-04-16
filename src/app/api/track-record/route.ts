import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserTrackRecord } from "@/lib/history";
import { log, errorInfo } from "@/lib/log";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await getUserTrackRecord(session.user.id, 30);
    return NextResponse.json(data);
  } catch (err) {
    log.error("track-record", "failed", { userId: session.user.id, ...errorInfo(err) });
    return NextResponse.json(
      { totals: { total: 0, buys: 0, sells: 0, holds: 0 }, outcomes: { evaluated: 0, wins: 0, losses: 0, flats: 0, acted: 0 } }
    );
  }
}
