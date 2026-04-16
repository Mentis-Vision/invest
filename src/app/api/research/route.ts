import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getStockSnapshot, formatSnapshotForAI } from "@/lib/data/yahoo";
import { getRecentFilings, formatFilingsForAI } from "@/lib/data/sec";
import { getMacroSnapshot, formatMacroForAI } from "@/lib/data/fred";
import { runAnalystPanel, runSupervisor } from "@/lib/ai/consensus";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ticker?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ticker = body.ticker?.toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  // Fetch all data in parallel
  let snapshot;
  try {
    const [snap, filings, macro] = await Promise.all([
      getStockSnapshot(ticker),
      getRecentFilings(ticker, 5),
      getMacroSnapshot(),
    ]);
    snapshot = snap;

    const dataBlock = [
      formatSnapshotForAI(snap),
      "",
      formatFilingsForAI(filings),
      "",
      formatMacroForAI(macro),
    ].join("\n");

    const analyses = await runAnalystPanel(ticker, dataBlock);
    const supervisor = await runSupervisor(ticker, dataBlock, analyses, snapshot.asOf);

    return NextResponse.json({
      ticker,
      snapshot,
      analyses,
      supervisor,
      sources: {
        yahoo: true,
        sec: filings.length > 0,
        fred: macro.length > 0,
      },
    });
  } catch (err) {
    console.error("[research]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error && err.message.includes("fetch")
            ? `Could not fetch data for ${ticker}. Verify the ticker symbol.`
            : "Analysis failed. Please try again.",
      },
      { status: 500 }
    );
  }
}
