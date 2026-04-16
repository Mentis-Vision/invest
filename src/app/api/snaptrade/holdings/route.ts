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
import { getTickerMetadataBatch } from "@/lib/data/ticker-metadata";

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
      sector: string | null;
      industry: string | null;
      assetClass: string;
    };

    type PendingUpsert = {
      ticker: string;
      shares: number;
      costBasis: number | null;
      avgCost: number | null;
      price: number;
      value: number;
      currency: string;
      accountName: string | null;
      accountId: string;
    };

    const pending: PendingUpsert[] = [];

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
          const shares = Number(p.units ?? 0);
          const price = Number(p.price ?? 0);
          const value = shares * price;
          const avgCost =
            p.average_purchase_price != null ? Number(p.average_purchase_price) : null;
          const costBasis = avgCost != null ? avgCost * shares : null;

          pending.push({
            ticker,
            shares,
            costBasis,
            avgCost,
            price,
            value,
            currency: (p.currency?.code as string) ?? "USD",
            accountName: acct.name ?? null,
            accountId: acct.id,
          });
        }
      } catch (err) {
        log.warn("snaptrade.holdings", "account positions fetch failed", {
          accountId: acct.id,
          ...errorInfo(err),
        });
      }
    }

    // Batch-fetch sector/industry for every unique ticker we saw. Cached in
    // Postgres (30d) and in-memory (process lifetime) so re-syncs are cheap.
    const uniqueTickers = [...new Set(pending.map((p) => p.ticker))];
    const metadataMap = await getTickerMetadataBatch(uniqueTickers);

    const aggregated: Holding[] = [];
    for (const p of pending) {
      const md = metadataMap.get(p.ticker) ?? {
        ticker: p.ticker,
        name: null,
        sector: null,
        industry: null,
        assetClass: "equity" as const,
      };
      const displayName = md.name ?? p.ticker;
      const acct = accounts.find((a) => a.id === p.accountId);

      aggregated.push({
        ticker: p.ticker,
        name: displayName,
        shares: p.shares,
        price: p.price,
        value: p.value,
        costBasis: p.costBasis,
        institutionName: acct?.institution_name ?? null,
        accountName: p.accountName,
        sector: md.sector,
        industry: md.industry,
        assetClass: md.assetClass,
      });

      try {
        await pool.query(
          `INSERT INTO "holding" (id, "userId", ticker, shares, "costBasis", "avgPrice", "lastPrice", "lastValue", currency, "accountName", "plaidAccountId", sector, industry, "assetClass", source, "lastSyncedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'snaptrade', NOW())
           ON CONFLICT ("userId", ticker, COALESCE("accountName", ''))
           DO UPDATE SET
             shares = EXCLUDED.shares,
             "costBasis" = EXCLUDED."costBasis",
             "avgPrice" = EXCLUDED."avgPrice",
             "lastPrice" = EXCLUDED."lastPrice",
             "lastValue" = EXCLUDED."lastValue",
             sector = COALESCE(EXCLUDED.sector, "holding".sector),
             industry = COALESCE(EXCLUDED.industry, "holding".industry),
             "assetClass" = COALESCE(EXCLUDED."assetClass", "holding"."assetClass"),
             "lastSyncedAt" = NOW()`,
          [
            crypto.randomUUID(),
            session.user.id,
            p.ticker,
            p.shares,
            p.costBasis,
            p.avgCost,
            p.price || null,
            p.value || null,
            p.currency,
            p.accountName,
            p.accountId,
            md.sector,
            md.industry,
            md.assetClass,
          ]
        );
      } catch (err) {
        log.warn("snaptrade.holdings", "holding upsert failed", {
          ticker: p.ticker,
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
