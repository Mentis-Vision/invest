import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { getMacroSnapshot, formatMacroForAI } from "@/lib/data/fred";
import {
  runPortfolioPanel,
  runPortfolioSupervisor,
} from "@/lib/ai/portfolio-consensus";
import { checkRateLimit, RULES, getClientIp } from "@/lib/rate-limit";
import { checkUsageCap, recordBatchUsage, recordUsage, TIER_LIMITS } from "@/lib/usage";
import { log, errorInfo } from "@/lib/log";

export const maxDuration = 120;

type HoldingRow = {
  ticker: string;
  shares: string | number;
  avgPrice: string | number | null;
  lastPrice: string | number | null;
  lastValue: string | number | null;
  costBasis: string | number | null;
  accountName: string | null;
  sector: string | null;
  industry: string | null;
};

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const userRl = await checkRateLimit(
    { ...RULES.strategyUser, name: "portfolio-review:user", limit: 10 },
    userId
  );
  if (!userRl.ok) {
    return NextResponse.json(
      { error: "rate_limit", retryAfterSec: userRl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(userRl.retryAfterSec) } }
    );
  }

  const ipRl = await checkRateLimit(
    { ...RULES.strategyUser, name: "portfolio-review:ip", limit: 20 },
    getClientIp(req)
  );
  if (!ipRl.ok) {
    return NextResponse.json({ error: "rate_limit_ip" }, { status: 429 });
  }

  const cap = await checkUsageCap(userId);
  if (!cap.ok) {
    return NextResponse.json(
      {
        error: "monthly_limit",
        message: `You've reached your monthly budget (${TIER_LIMITS[cap.tier].label} tier).`,
        resetAt: cap.resetAt,
      },
      { status: 402 }
    );
  }

  try {
    const { rows } = await pool.query(
      `SELECT ticker, shares, "avgPrice", "lastPrice", "lastValue", "costBasis", "accountName", sector, industry
       FROM "holding"
       WHERE "userId" = $1
       ORDER BY COALESCE("lastValue", shares * COALESCE("lastPrice", "avgPrice", 0)) DESC`,
      [userId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: "no_holdings",
          message:
            "Connect your brokerage first — we can't review what we can't see.",
        },
        { status: 400 }
      );
    }

    const holdings = rows as HoldingRow[];

    // One batched warehouse read covers every held ticker so the data
    // block can annotate positions with P/E + beta from ticker_market_daily
    // without N Yahoo calls.
    const { getTickerMarketBatch } = await import("@/lib/warehouse");
    const marketMap = await getTickerMarketBatch(
      holdings.map((h) => h.ticker)
    );

    const marketValue = (h: HoldingRow) => {
      const lv = h.lastValue !== null && h.lastValue !== undefined ? Number(h.lastValue) : 0;
      if (lv > 0) return lv;
      const shares = Number(h.shares);
      const price = Number(h.lastPrice ?? h.avgPrice ?? 0);
      return shares * price;
    };
    const totalValue = holdings.reduce((sum, h) => sum + marketValue(h), 0);

    const macro = await getMacroSnapshot();
    const dataAsOf = new Date().toISOString();

    // Sector rollup — sum market value per sector so the model sees
    // concentration at a glance, not just per-position.
    const sectorBuckets = new Map<string, number>();
    let unclassified = 0;
    for (const h of holdings) {
      const v = marketValue(h);
      if (h.sector) {
        sectorBuckets.set(h.sector, (sectorBuckets.get(h.sector) ?? 0) + v);
      } else {
        unclassified += v;
      }
    }
    const sectorLines = [...sectorBuckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([sector, value]) => {
        const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
        return `  - ${sector}: $${value.toFixed(2)} (${pct.toFixed(1)}%)`;
      });
    if (unclassified > 0) {
      const pct = totalValue > 0 ? (unclassified / totalValue) * 100 : 0;
      sectorLines.push(
        `  - Unclassified: $${unclassified.toFixed(2)} (${pct.toFixed(1)}%)`
      );
    }

    const dataBlock = [
      `PORTFOLIO SNAPSHOT (as of ${dataAsOf}):`,
      `Total positions: ${holdings.length}`,
      `Estimated market value: $${totalValue.toFixed(2)} USD`,
      ``,
      `SECTOR BREAKDOWN (by market value):`,
      ...(sectorLines.length > 0
        ? sectorLines
        : ["  (no sector data available)"]),
      ``,
      `POSITIONS (sorted largest first, using last-synced price from brokerage):`,
      ...holdings.map((h) => {
        const shares = Number(h.shares);
        const current = Number(h.lastPrice ?? h.avgPrice ?? 0);
        const value = marketValue(h);
        const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
        const avgCost = h.avgPrice !== null && h.avgPrice !== undefined ? Number(h.avgPrice) : null;
        const costLabel = avgCost != null ? ` · avg cost $${avgCost.toFixed(2)}` : "";
        const sectorLabel = h.sector
          ? ` [${h.sector}${h.industry ? ` / ${h.industry}` : ""}]`
          : " [sector: unclassified]";
        const m = marketMap.get(h.ticker.toUpperCase());
        const mmPe = m?.peTrailing != null ? ` P/E ${m.peTrailing.toFixed(1)}` : "";
        const mmBeta = m?.beta != null ? ` β ${m.beta.toFixed(2)}` : "";
        return `- ${h.ticker}: ${shares} shares @ $${current.toFixed(2)}${costLabel} ≈ $${value.toFixed(2)} (${pct.toFixed(1)}% of portfolio)${sectorLabel}${mmPe}${mmBeta}${h.accountName ? ` {${h.accountName}}` : ""}`;
      }),
      ``,
      `NOTE: Prices are last-synced from the user's brokerage via SnapTrade; they may be intraday-stale. Sector/industry data is sourced from Yahoo Finance and may be missing for non-US or niche tickers.`,
      ``,
      formatMacroForAI(macro),
    ].join("\n");

    const analyses = await runPortfolioPanel(dataBlock);
    const supervisor = await runPortfolioSupervisor(dataBlock, analyses, dataAsOf);

    const usageItems = analyses
      .filter((a) => a.tokensUsed)
      .map((a) => ({ model: a.model, tokens: a.tokensUsed ?? 0 }));
    recordBatchUsage(userId, usageItems).catch(() => {});
    if (supervisor.tokensUsed > 0) {
      recordUsage(userId, supervisor.pricingKey, supervisor.tokensUsed).catch(() => {});
    }

    return NextResponse.json({
      holdingsCount: holdings.length,
      totalValue,
      analyses,
      supervisor: supervisor.output,
      supervisorModel: supervisor.supervisorModel,
      dataAsOf,
    });
  } catch (err) {
    log.error("portfolio-review", "failed", { userId, ...errorInfo(err) });
    return NextResponse.json({ error: "Review failed. Try again." }, { status: 500 });
  }
}
