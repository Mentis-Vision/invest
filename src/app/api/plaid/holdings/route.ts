import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { plaidClient, plaidConfigured, decryptAccessToken } from "@/lib/plaid";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * Returns the user's current holdings across all linked Plaid items.
 * Also upserts them into the `holding` table for downstream use
 * (portfolio review, history tracking, etc.).
 */
export async function GET(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!plaidConfigured()) {
    return NextResponse.json({
      holdings: [],
      connected: false,
      message: "Brokerage integration is not yet live.",
    });
  }

  try {
    const { rows: items } = await pool.query(
      `SELECT id, "accessTokenEncrypted", "institutionName"
       FROM "plaid_item"
       WHERE "userId" = $1 AND status = 'active'`,
      [session.user.id]
    );

    if (items.length === 0) {
      return NextResponse.json({ holdings: [], connected: false });
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

    for (const item of items) {
      try {
        const accessToken = decryptAccessToken(item.accessTokenEncrypted as string);
        const resp = await plaidClient().investmentsHoldingsGet({ access_token: accessToken });
        const securitiesById = new Map(
          resp.data.securities.map((s) => [s.security_id, s])
        );
        const accountsById = new Map(resp.data.accounts.map((a) => [a.account_id, a]));

        for (const h of resp.data.holdings) {
          const sec = securitiesById.get(h.security_id);
          const acct = accountsById.get(h.account_id);
          if (!sec) continue;

          const ticker =
            sec.ticker_symbol ??
            sec.name?.slice(0, 12).toUpperCase() ??
            "UNKNOWN";
          const shares = Number(h.quantity ?? 0);
          const price = Number(h.institution_price ?? sec.close_price ?? 0);
          const value = Number(h.institution_value ?? shares * price);

          aggregated.push({
            ticker,
            name: sec.name ?? ticker,
            shares,
            price,
            value,
            costBasis: h.cost_basis ? Number(h.cost_basis) : null,
            institutionName: item.institutionName as string | null,
            accountName: acct?.name ?? null,
          });

          // Upsert into holdings table
          try {
            await pool.query(
              `INSERT INTO "holding" (id, "userId", ticker, shares, "costBasis", "avgPrice", currency, "accountName", "plaidAccountId", source, "lastSyncedAt")
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'plaid', NOW())
               ON CONFLICT ("userId", ticker, COALESCE("accountName", ''))
               DO UPDATE SET
                 shares = EXCLUDED.shares,
                 "costBasis" = EXCLUDED."costBasis",
                 "avgPrice" = EXCLUDED."avgPrice",
                 "lastSyncedAt" = NOW()`,
              [
                crypto.randomUUID(),
                session.user.id,
                ticker,
                shares,
                h.cost_basis ?? null,
                price || null,
                (acct?.balances?.iso_currency_code as string) ?? "USD",
                acct?.name ?? null,
                h.account_id,
              ]
            );
          } catch (err) {
            log.warn("plaid.holdings", "upsert failed", { ticker, ...errorInfo(err) });
          }
        }
      } catch (err) {
        log.error("plaid.holdings", "item fetch failed", {
          userId: session.user.id,
          ...errorInfo(err),
        });
      }
    }

    return NextResponse.json({
      connected: true,
      holdings: aggregated,
      totalValue: aggregated.reduce((sum, h) => sum + h.value, 0),
      institutions: [...new Set(items.map((i) => i.institutionName).filter(Boolean))],
    });
  } catch (err) {
    log.error("plaid.holdings", "unexpected failure", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json({ error: "Could not load holdings." }, { status: 500 });
  }
}
