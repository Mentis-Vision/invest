import { NextRequest, NextResponse } from "next/server";
import { persistRadarAlertsForAllUsers } from "@/lib/decision-engine/radar";
import { errorInfo, log } from "@/lib/log";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron.riskRadar", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  try {
    const result = await persistRadarAlertsForAllUsers({
      userLimit: 200,
      holdingsLimit: 8,
    });
    return NextResponse.json({
      ...result,
      ms: Date.now() - started,
    });
  } catch (err) {
    log.error("cron.riskRadar", "scan failed", errorInfo(err));
    return NextResponse.json(
      { error: "failed", ms: Date.now() - started },
      { status: 500 }
    );
  }
}
