import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  snaptradeClient,
  snaptradeConfigured,
  ensureSnaptradeUser,
} from "@/lib/snaptrade";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * GET /api/snaptrade/holdings
 * Returns the user's positions across all linked brokerages. Also upserts
 * them into the `holding` table for downstream portfolio-review use.
 *
 * If the user hasn't registered with SnapTrade yet, returns connected=false.
 */
export async function GET(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!snaptradeConfigured()) {
    return NextResponse.json({
      holdings: [],
      connected: false,
      message: "Brokerage integration is not yet live.",
    });
  }

  // If the user has never registered with SnapTrade, they haven't linked.
  const { rows: existing } = await pool.query(
    `SELECT 1 FROM "snaptrade_user" WHERE "userId" = $1 LIMIT 1`,
    [session.user.id]
  );
  if (existing.length === 0) {
    return NextResponse.json({ connected: false, holdings: [] });
  }

  try {
    const { snaptradeUserId, userSecret } = await ensureSnaptradeUser(
      session.user.id
    );
    const client = snaptradeClient();

    // 1. List all accounts (one per linked brokerage connection)
    const accountsResp = await client.accountInformation.listUserAccounts({
      userId: snaptradeUserId,
      userSecret,
    });
    const accounts = (accountsResp.data ?? []) as Array<{
      id?: string;
      name?: string;
      institution_name?: string;
      balance?: { total?: { amount?: number; currency?: string } };
    }>;

    if (accounts.length === 0) {
      return NextResponse.json({ connected: true, holdings: [], totalValue: 0 });
    }

    type Holding = {
      ticker: string;
      name: string;
      shares: number;
      price: number;
      value: number;
      costBasis: number | null;
      institutionName: string | null;
      accountName: string | null;
    };

    const aggregated: Holding[] = [];

    for (const acct of accounts) {
      if (!acct.id) continue;
      try {
        const posResp = await client.accountInformation.getUserAccountPositions({
          userId: snaptradeUserId,
          userSecret,
          accountId: acct.id,
        });
        const positions = (posResp.data ?? []) as Array<{
          symbol?: {
            symbol?: { symbol?: string; description?: string };
            description?: string;
            local_symbol?: string;
          };
          units?: number;
          price?: number;
          open_pnl?: number;
          average_purchase_price?: number;
          currency?: { code?: string };
        }>;

        for (const p of positions) {
          const ticker =
            p.symbol?.symbol?.symbol ??
            p.symbol?.local_symbol ??
            p.symbol?.description?.slice(0, 12).toUpperCase() ??
            "UNKNOWN";
          const name =
            p.symbol?.symbol?.description ??
            p.symbol?.description ??
            ticker;
          const shares = Number(p.units ?? 0);
          const price = Number(p.price ?? 0);
          const value = shares * price;
          const avgCost =
            p.average_purchase_price != null ? Number(p.average_purchase_price) : null;
          const costBasis = avgCost != null ? avgCost * shares : null;

          aggregated.push({
            ticker,
            name,
            shares,
            price,
            value,
            costBasis,
            institutionName: acct.institution_name ?? null,
            accountName: acct.name ?? null,
          });

          try {
            await pool.query(
              `INSERT INTO "holding" (id, "userId", ticker, shares, "costBasis", "avgPrice", "lastPrice", "lastValue", currency, "accountName", "plaidAccountId", source, "lastSyncedAt")
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'snaptrade', NOW())
               ON CONFLICT ("userId", ticker, COALESCE("accountName", ''))
               DO UPDATE SET
                 shares = EXCLUDED.shares,
                 "costBasis" = EXCLUDED."costBasis",
                 "avgPrice" = EXCLUDED."avgPrice",
                 "lastPrice" = EXCLUDED."lastPrice",
                 "lastValue" = EXCLUDED."lastValue",
                 "lastSyncedAt" = NOW()`,
              [
                crypto.randomUUID(),
                session.user.id,
                ticker,
                shares,
                costBasis,
                avgCost,
                price || null,
                value || null,
                (p.currency?.code as string) ?? "USD",
                acct.name ?? null,
                acct.id,
              ]
            );
          } catch (err) {
            log.warn("snaptrade.holdings", "holding upsert failed", {
              ticker,
              ...errorInfo(err),
            });
          }
        }
      } catch (err) {
        log.warn("snaptrade.holdings", "account positions fetch failed", {
          accountId: acct.id,
          ...errorInfo(err),
        });
      }
    }

    // Update last sync timestamp
    try {
      await pool.query(
        `UPDATE "snaptrade_user" SET "lastSyncedAt" = NOW() WHERE "userId" = $1`,
        [session.user.id]
      );
    } catch {
      /* ignore */
    }

    const totalValue = aggregated.reduce((s, h) => s + h.value, 0);
    const institutions = [
      ...new Set(
        accounts.map((a) => a.institution_name).filter((x): x is string => !!x)
      ),
    ];

    return NextResponse.json({
      connected: true,
      holdings: aggregated,
      totalValue,
      institutions,
      accountCount: accounts.length,
    });
  } catch (err) {
    log.error("snaptrade.holdings", "unexpected failure", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json({ error: "Could not load holdings." }, { status: 500 });
  }
}
