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
import { getStockSnapshot } from "@/lib/data/yahoo";
import { sumMoney } from "@/lib/money";

// Tickers we should NOT try to fetch live quotes for — cash sweep
// vehicles, money-market positions, and Plaid's "CASH" placeholder.
// These contribute zero to day P&L (price doesn't move).
const CASH_LIKE_CLASSES = new Set(["cash", "money_market", "mmf"]);
function isCashLike(h: { ticker: string; assetClass: string }): boolean {
  const cls = (h.assetClass ?? "").toLowerCase();
  if (CASH_LIKE_CLASSES.has(cls)) return true;
  const t = h.ticker.toUpperCase();
  return t === "CASH" || t.endsWith("CASH");
}

/**
 * Compute today's $ change and % change from per-holding price moves
 * — NOT from a portfolio-total snapshot diff. The snapshot-diff
 * approach is broken on any day a brokerage account is added or
 * removed: yesterday's snapshot doesn't include the new account, so
 * its full balance gets booked as "today's gain" (a $764k Schwab
 * link surfaced as +29,117% today).
 *
 * Per-holding math is robust:
 *   prev_close = price / (1 + changePct/100)
 *   day_$ per holding = (price - prev_close) * shares
 *                     = value * changePct / (100 + changePct)
 *
 * Newly-linked holdings contribute only their actual day move, not
 * their full balance.
 *
 * Snapshot fetches are cached by `getStockSnapshot`, so repeated
 * loads share work with the ticker tape and dossier views.
 */
async function computeDayChange(
  holdings: Holding[]
): Promise<{ dayChangeDollar: number | null; dayChangePct: number | null }> {
  const tradable = holdings.filter(
    (h) => !isCashLike(h) && Number.isFinite(h.value) && h.value !== 0 && h.shares !== 0
  );
  if (tradable.length === 0) {
    return { dayChangeDollar: null, dayChangePct: null };
  }

  // Dedupe by ticker — the same security can sit in multiple
  // accounts, but Yahoo doesn't care which account; one fetch each.
  const uniqueTickers = [...new Set(tradable.map((h) => h.ticker))];
  const snapshots = new Map<string, { price: number; changePct: number }>();
  await Promise.all(
    uniqueTickers.map(async (t) => {
      try {
        const snap = await getStockSnapshot(t);
        if (snap && Number.isFinite(snap.changePct)) {
          snapshots.set(t, { price: snap.price, changePct: snap.changePct });
        }
      } catch {
        // Skip on failure — the holding contributes 0 day change
        // rather than poisoning the whole portfolio number.
      }
    })
  );

  let dayDollar = 0;
  let coveredValue = 0; // value of holdings we have snapshots for
  for (const h of tradable) {
    const snap = snapshots.get(h.ticker);
    if (!snap) continue;
    const pct = snap.changePct;
    // Guard against divide-by-zero on extreme negative pct (-100 = wipeout).
    if (pct <= -100) continue;
    dayDollar += (h.value * pct) / (100 + pct);
    coveredValue += h.value;
  }

  // Reference base for the % is yesterday's close of the COVERED
  // holdings only. Using the full portfolio total as the denominator
  // would re-introduce the same skew when uncovered (cash, freshly
  // linked, or quote-failed) tickers shift the total.
  const prevCovered = coveredValue - dayDollar;
  if (prevCovered <= 0) {
    return { dayChangeDollar: null, dayChangePct: null };
  }
  return {
    dayChangeDollar: dayDollar,
    dayChangePct: (dayDollar / prevCovered) * 100,
  };
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

/**
 * Load Plaid-sourced holdings for this user from the `holding` table.
 *
 * Plaid rows land here via syncHoldings() in lib/plaid.ts at link time
 * (and webhook updates). Reading them here is what makes brokerages
 * routed through Plaid — Schwab in particular — visible to users who
 * never registered with SnapTrade. Without this, /api/snaptrade/holdings
 * silently returns `{ connected: false }` for Plaid-only users despite
 * their holdings sitting in the DB.
 *
 * Joins to plaid_item for the institution name; falls back to ticker
 * metadata for display-name / sector / industry when the holding row
 * didn't store them.
 */
async function loadPlaidHoldings(userId: string): Promise<Holding[]> {
  const { rows } = await pool.query<{
    ticker: string;
    shares: string | number;
    costBasis: string | number | null;
    price: string | number;
    value: string | number;
    accountName: string | null;
    sector: string | null;
    industry: string | null;
    assetClass: string | null;
    institutionName: string | null;
  }>(
    `SELECT
       h.ticker,
       h.shares,
       h."costBasis",
       COALESCE(h."lastPrice", 0) AS price,
       COALESCE(h."lastValue", 0) AS value,
       h."accountName",
       h.sector,
       h.industry,
       h."assetClass",
       pi."institutionName"
     FROM "holding" h
     LEFT JOIN "plaid_account" pa ON pa."plaidAccountId" = h."plaidAccountId"
     LEFT JOIN "plaid_item" pi ON pi."itemId" = pa."itemId"
     WHERE h."userId" = $1 AND h.source = 'plaid'`,
    [userId]
  );
  if (rows.length === 0) return [];

  const uniqueTickers = [...new Set(rows.map((r) => r.ticker))];
  const metadataMap = await getTickerMetadataBatch(uniqueTickers);

  return rows.map((r) => {
    const md = metadataMap.get(r.ticker);
    return {
      ticker: r.ticker,
      name: md?.name ?? r.ticker,
      shares: Number(r.shares ?? 0),
      price: Number(r.price ?? 0),
      value: Number(r.value ?? 0),
      costBasis: r.costBasis != null ? Number(r.costBasis) : null,
      institutionName: r.institutionName ?? null,
      accountName: r.accountName ?? null,
      sector: r.sector ?? md?.sector ?? null,
      industry: r.industry ?? md?.industry ?? null,
      assetClass: r.assetClass ?? md?.assetClass ?? "equity",
    };
  });
}

/**
 * Snapshot-level freshness across ALL sources (SnapTrade + Plaid).
 * The portfolio header surfaces this as "Updated X ago" — MAX across
 * sources so Plaid-only users still see a meaningful timestamp.
 */
async function loadLastSyncedAt(userId: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ ts: Date | null }>(
      `SELECT MAX("lastSyncedAt") AS ts FROM "holding" WHERE "userId" = $1`,
      [userId]
    );
    return rows[0]?.ts?.toISOString() ?? null;
  } catch {
    return null;
  }
}

/** Distinct accountName count across a Holding[]. */
function countDistinctAccounts(holdings: Holding[]): number {
  return new Set(
    holdings
      .map((h) => h.accountName)
      .filter((x): x is string => !!x)
  ).size;
}

/**
 * Build the "connected" response shape from a holdings array. Used by
 * the Plaid-only branches and as the merged-flow fallback so the
 * client payload stays identical regardless of which sources
 * contributed.
 */
async function buildHoldingsResponse(
  aggregated: Holding[],
  accountCount: number,
  brokerageBalance: number | null,
  balanceCurrency: string,
  lastSyncedAt: string | null
) {
  const totalValue = sumMoney(...aggregated.map((h) => h.value));
  const institutions = [
    ...new Set(
      aggregated
        .map((h) => h.institutionName)
        .filter((x): x is string => !!x)
    ),
  ];
  const { dayChangeDollar, dayChangePct } = await computeDayChange(aggregated);
  return NextResponse.json({
    connected: true,
    holdings: aggregated,
    totalValue,
    dayChangeDollar,
    dayChangePct,
    brokerageBalance,
    balanceCurrency,
    institutions,
    accountCount,
    lastSyncedAt,
  });
}

/**
 * GET /api/snaptrade/holdings
 *
 * Despite the URL, this endpoint is provider-agnostic — it returns
 * positions across BOTH SnapTrade (live fetch) and Plaid (read from
 * the `holding` table where syncHoldings() persisted them at link
 * time). A Schwab account routed through Plaid appears here even if
 * the user never registered with SnapTrade.
 *
 * (Naming kept for client-compat; rename to /api/holdings is tracked
 * separately.)
 */
export async function GET(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // Plaid path is the only way some brokerages (Schwab) reach us. Load
  // those holdings first regardless of SnapTrade state.
  const plaidHoldings = await loadPlaidHoldings(userId);

  // ── Branch 1: SnapTrade not configured ────────────────────────────
  // Serve Plaid-only if there's data; otherwise echo the original
  // "not yet live" message so the UI shows the right CTA.
  if (!snaptradeConfigured()) {
    if (plaidHoldings.length === 0) {
      return NextResponse.json({
        holdings: [],
        connected: false,
        message: "Brokerage integration is not yet live.",
      });
    }
    return buildHoldingsResponse(
      plaidHoldings,
      countDistinctAccounts(plaidHoldings),
      null,
      "USD",
      await loadLastSyncedAt(userId)
    );
  }

  // ── Branch 2: SnapTrade configured but user never registered ──────
  // Plaid-only users land here. Return their holdings without paying
  // for the SnapTrade SDK round-trip.
  const { rows: existing } = await pool.query(
    `SELECT 1 FROM "snaptrade_user" WHERE "userId" = $1 LIMIT 1`,
    [userId]
  );
  if (existing.length === 0) {
    if (plaidHoldings.length === 0) {
      return NextResponse.json({ connected: false, holdings: [] });
    }
    return buildHoldingsResponse(
      plaidHoldings,
      countDistinctAccounts(plaidHoldings),
      null,
      "USD",
      await loadLastSyncedAt(userId)
    );
  }

  // ── Branch 3: SnapTrade registered → live fetch + merge Plaid ─────
  try {
    const { snaptradeUserId, userSecret } = await ensureSnaptradeUser(userId);
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
      // No SnapTrade accounts but Plaid may still have data — return
      // whichever side has rows so the user sees something.
      if (plaidHoldings.length > 0) {
        return buildHoldingsResponse(
          plaidHoldings,
          countDistinctAccounts(plaidHoldings),
          null,
          "USD",
          await loadLastSyncedAt(userId)
        );
      }
      return NextResponse.json({
        connected: true,
        holdings: [],
        totalValue: 0,
        dayChangeDollar: null,
        dayChangePct: null,
      });
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
            userId,
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

    const snaptradeHoldings: Holding[] = [];
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

      snaptradeHoldings.push({
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
            userId,
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

    // Update last sync timestamp on the snaptrade user row.
    try {
      await pool.query(
        `UPDATE "snaptrade_user" SET "lastSyncedAt" = NOW() WHERE "userId" = $1`,
        [userId]
      );
    } catch {
      /* ignore */
    }

    // Merge: SnapTrade live + Plaid persisted. Plaid trails so its
    // accountName ordering is stable across calls (snaptrade order
    // can shift when accounts are added/removed).
    const aggregated: Holding[] = [...snaptradeHoldings, ...plaidHoldings];

    // sumMoney (cents-integer) rather than float reduce — drift across
    // a multi-position portfolio otherwise surfaces as a total that
    // disagrees with the brokerage's reported number by pennies,
    // which reads as a correctness problem even though no money is
    // actually wrong.
    const totalValue = sumMoney(...aggregated.map((h) => h.value));

    // Institution list spans both providers so the user sees every
    // brokerage they've linked, regardless of how it got there.
    const institutions = [
      ...new Set([
        ...accounts.map((a) => a.institution_name).filter((x): x is string => !!x),
        ...plaidHoldings
          .map((h) => h.institutionName)
          .filter((x): x is string => !!x),
      ]),
    ];

    // Sum broker-reported balances across SnapTrade accounts — this is
    // the authoritative "total in your brokerage including
    // cash/settlements" number for SnapTrade-linked accounts. Plaid
    // doesn't expose an equivalent aggregate via this path; we surface
    // its positions only, so totalValue is the trustworthy number for
    // Plaid-side holdings. sumMoney silently skips non-finite entries.
    const brokerageBalance = sumMoney(
      ...accounts.map((a) => Number(a.balance?.total?.amount ?? 0))
    );
    const balanceCurrency =
      accounts.find((a) => a.balance?.total?.currency)?.balance?.total
        ?.currency ?? "USD";

    const lastSyncedAt = await loadLastSyncedAt(userId);
    const { dayChangeDollar, dayChangePct } = await computeDayChange(aggregated);

    return NextResponse.json({
      connected: true,
      holdings: aggregated,
      totalValue,
      dayChangeDollar,
      dayChangePct,
      brokerageBalance: brokerageBalance > 0 ? brokerageBalance : null,
      balanceCurrency,
      institutions,
      accountCount: accounts.length + countDistinctAccounts(plaidHoldings),
      lastSyncedAt,
    });
  } catch (err) {
    log.error("snaptrade.holdings", "unexpected failure", {
      userId,
      ...errorInfo(err),
    });
    // SnapTrade fetch failed — degrade to Plaid-only rather than
    // black-holing the whole portfolio view if Plaid has data.
    if (plaidHoldings.length > 0) {
      return buildHoldingsResponse(
        plaidHoldings,
        countDistinctAccounts(plaidHoldings),
        null,
        "USD",
        await loadLastSyncedAt(userId)
      );
    }
    return NextResponse.json({ error: "Could not load holdings." }, { status: 500 });
  }
}
