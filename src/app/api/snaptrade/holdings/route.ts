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
import { sumMoney } from "@/lib/money";

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
      brokerage_authorization?: string;
      balance?: { total?: { amount?: number; currency?: string } };
    }>;

    // 1b. Fetch brokerage authorization details so we can record connection metadata.
    // We build a Map<authId, auth> for O(1) lookup below.
    type AuthDetail = {
      id?: string;
      type?: string;
      disabled?: boolean;
      brokerage?: { name?: string; slug?: string };
    };
    const authMap = new Map<string, AuthDetail>();
    try {
      const authsResp = await client.connections.listBrokerageAuthorizations({
        userId: snaptradeUserId,
        userSecret,
      });
      for (const auth of (authsResp.data ?? []) as AuthDetail[]) {
        if (auth.id) authMap.set(auth.id, auth);
      }
    } catch (err) {
      log.warn("snaptrade.holdings", "listBrokerageAuthorizations failed", errorInfo(err));
    }

    if (accounts.length === 0) {
      return NextResponse.json({ connected: true, holdings: [], totalValue: 0 });
    }

    // 1c. Upsert one snaptrade_connection row per unique brokerage_authorization.
    // Dedupe by authId so multi-account brokerages only write one row.
    const seenAuthIds = new Set<string>();
    for (const acct of accounts) {
      const authId = acct.brokerage_authorization;
      if (!authId || seenAuthIds.has(authId)) continue;
      seenAuthIds.add(authId);

      const auth = authMap.get(authId);
      const brokerageName = auth?.brokerage?.name ?? acct.institution_name ?? null;
      const brokerageSlug = auth?.brokerage?.slug ?? null;
      const connectionType = auth?.type ?? null;

      try {
        await pool.query(
          `INSERT INTO "snaptrade_connection"
             (id, "userId", "brokerageAuthorizationId", "brokerageName", "brokerageSlug",
              "connectionType", disabled, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, false, NOW(), NOW())
           ON CONFLICT ("userId", "brokerageAuthorizationId") DO UPDATE SET
             "brokerageName"    = COALESCE(EXCLUDED."brokerageName",    "snaptrade_connection"."brokerageName"),
             "brokerageSlug"    = COALESCE(EXCLUDED."brokerageSlug",    "snaptrade_connection"."brokerageSlug"),
             "connectionType"   = COALESCE(EXCLUDED."connectionType",   "snaptrade_connection"."connectionType"),
             disabled           = false,
             "updatedAt"        = NOW()`,
          [
            crypto.randomUUID(),
            session.user.id,
            authId,
            brokerageName,
            brokerageSlug,
            connectionType,
          ]
        );
      } catch (err) {
        log.warn("snaptrade.holdings", "snaptrade_connection upsert failed", {
          authId,
          ...errorInfo(err),
        });
      }
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

    // sumMoney (cents-integer) rather than float reduce — drift across
    // a multi-position portfolio otherwise surfaces as a total that
    // disagrees with the brokerage's reported number by pennies,
    // which reads as a correctness problem even though no money is
    // actually wrong.
    const totalValue = sumMoney(...aggregated.map((h) => h.value));
    const institutions = [
      ...new Set(
        accounts.map((a) => a.institution_name).filter((x): x is string => !!x)
      ),
    ];

    // Sum broker-reported balances across accounts — this is the
    // authoritative "total in your brokerage including cash/settlements"
    // number, whereas `totalValue` above is just positions × price.
    // The delta is cash drag; both are useful to surface. sumMoney
    // silently skips non-finite entries so a broken balance field
    // on one account doesn't poison the aggregate.
    const brokerageBalance = sumMoney(
      ...accounts.map((a) => Number(a.balance?.total?.amount ?? 0))
    );
    const balanceCurrency =
      accounts.find((a) => a.balance?.total?.currency)?.balance?.total
        ?.currency ?? "USD";

    // Snapshot-level freshness — max lastSyncedAt across all sources
    // (SnapTrade rows just stamped NOW() above; Plaid rows stamped
    // whenever the most recent webhook / exchange-initiated sync ran).
    // Users see this as "Updated X ago" in the portfolio header so they
    // can judge whether to act on the current numbers.
    let lastSyncedAt: string | null = null;
    try {
      const { rows: syncRows } = await pool.query<{ ts: Date | null }>(
        `SELECT MAX("lastSyncedAt") AS ts FROM "holding" WHERE "userId" = $1`,
        [session.user.id]
      );
      lastSyncedAt = syncRows[0]?.ts?.toISOString() ?? null;
    } catch {
      /* ignore — freshness is cosmetic, not required */
    }

    return NextResponse.json({
      connected: true,
      holdings: aggregated,
      totalValue,
      brokerageBalance: brokerageBalance > 0 ? brokerageBalance : null,
      balanceCurrency,
      institutions,
      accountCount: accounts.length,
      lastSyncedAt,
    });
  } catch (err) {
    log.error("snaptrade.holdings", "unexpected failure", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json({ error: "Could not load holdings." }, { status: 500 });
  }
}
