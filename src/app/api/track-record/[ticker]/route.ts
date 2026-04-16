import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getTickerTrackRecord } from "@/lib/history";
import { log, errorInfo } from "@/lib/log";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  try {
    const record = await getTickerTrackRecord(session.user.id, ticker, 20);
    return NextResponse.json(record);
  } catch (err) {
    log.error("track-record-ticker", "failed", {
      userId: session.user.id,
      ticker,
      ...errorInfo(err),
    });
    return NextResponse.json({
      total: 0,
      byRec: {},
      wins30d: 0,
      losses30d: 0,
      flats30d: 0,
    });
  }
}
