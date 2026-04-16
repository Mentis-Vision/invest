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
  costBasis: string | number | null;
  accountName: string | null;
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
      `SELECT ticker, shares, "avgPrice", "costBasis", "accountName"
       FROM "holding" WHERE "userId" = $1 ORDER BY shares * COALESCE("avgPrice", 0) DESC`,
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
    const totalValue = holdings.reduce(
      (sum, h) => sum + Number(h.shares) * Number(h.avgPrice ?? 0),
      0
    );

    const macro = await getMacroSnapshot();
    const dataAsOf = new Date().toISOString();

    const dataBlock = [
      `PORTFOLIO SNAPSHOT (as of ${dataAsOf}):`,
      `Total positions: ${holdings.length}`,
      `Estimated total value: $${totalValue.toFixed(2)} USD`,
      ``,
      `POSITIONS (sorted largest first):`,
      ...holdings.map((h) => {
        const shares = Number(h.shares);
        const price = Number(h.avgPrice ?? 0);
        const value = shares * price;
        const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
        return `- ${h.ticker}: ${shares} shares @ $${price.toFixed(2)} ≈ $${value.toFixed(2)} (${pct.toFixed(1)}% of portfolio)${h.accountName ? ` [${h.accountName}]` : ""}`;
      }),
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
