import { NextRequest, NextResponse } from "next/server";
import { getStockSnapshot } from "@/lib/data/yahoo";
import {
  DEMO_TICKERS,
  writeDemoSnapshot,
} from "@/lib/demo-snapshot";
import { log, errorInfo } from "@/lib/log";

export const maxDuration = 60;

/**
 * GET /api/cron/demo-snapshot
 *
 * Refreshes the price + change-percent shown on the landing page's
 * interactive verdict demo. Visitors clicking through NVDA / TSLA /
 * AAPL / NFLX see today's actual prices, not a stale snapshot from
 * whenever we last hand-edited the component.
 *
 * The verdict TEXT (BUY/HOLD/SELL + thesis paragraph + per-lens
 * scores) stays curated in the component — running real three-lens
 * panels nightly for marketing decoration would burn API budget
 * without buying much beyond the price freshness this cron already
 * provides. If you want to upgrade to weekly real briefs, that's a
 * separate cron + a richer schema; this one is the cheap-but-
 * meaningful default.
 *
 * Schedule: see vercel.json (`0 0 * * *` UTC = 7pm ET, well after
 * the regular session close so we capture the day's settled prices).
 *
 * Auth: same `Authorization: Bearer $CRON_SECRET` pattern every
 * other cron in this codebase uses.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cron.demoSnapshot", "CRON_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const result: Record<string, "ok" | "skipped" | "error"> = {};

  // Parallel fetch keeps total cron time low — even on a slow Yahoo
  // round, the longest single call sets the floor, not the sum.
  await Promise.all(
    DEMO_TICKERS.map(async (ticker) => {
      try {
        const snap = await getStockSnapshot(ticker);
        if (!snap || !Number.isFinite(snap.price) || snap.price <= 0) {
          result[ticker] = "skipped";
          return;
        }
        await writeDemoSnapshot(ticker, snap.price, snap.changePct ?? 0);
        result[ticker] = "ok";
      } catch (err) {
        log.warn("cron.demoSnapshot", "fetch failed", {
          ticker,
          ...errorInfo(err),
        });
        result[ticker] = "error";
      }
    })
  );

  const ms = Date.now() - started;
  log.info("cron.demoSnapshot", "complete", { result, ms });
  return NextResponse.json({ result, ms });
}
