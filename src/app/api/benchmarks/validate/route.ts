import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { validateCustomTicker } from "@/lib/dashboard/benchmark-resolver";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "missing_ticker" }, { status: 400 });
  }
  const validation = await validateCustomTicker(ticker);
  return NextResponse.json({
    ok: true,
    valid: validation.valid,
    ticker: validation.ticker,
    historyDays: validation.historyDays,
  });
}
