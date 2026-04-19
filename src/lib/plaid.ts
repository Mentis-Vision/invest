import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
  type Holding as PlaidHolding,
  type InvestmentTransaction,
  type Security,
} from "plaid";
import crypto from "node:crypto";
import { pool } from "./db";
import { log, errorInfo } from "./log";
import { encryptSecret, decryptSecret } from "./snaptrade";
import { TIER_LIMITS, type Tier } from "./usage";

/**
 * Plaid client — Investments product only.
 *
 * Hard scope per AGENTS.md rule #6: we use Plaid for holdings +
 * investment transactions, and nothing else. Never call
 * accountsGet for banking, transactionsGet for bank transactions,
 * liabilitiesGet, or any of the Enrich / Recurring Transactions
 * endpoints. Token scope is enforced by Plaid at Link time (we only
 * request `investments` in PLAID_PRODUCTS).
 *
 * Auth model:
 *   1. We hold PLAID_CLIENT_ID + PLAID_SECRET (server-side).
 *   2. For each user+institution, we exchange a one-shot
 *      `public_token` (from Link) for an `access_token` we persist
 *      in plaid_item.accessTokenEncrypted, encrypted at rest using
 *      the same AES-256-GCM helpers SnapTrade uses.
 *   3. access_token is per-Item (one institution login). One user
 *      can have multiple Items (Schwab + Fidelity + ...).
 *
 * Never log access_token, secret, or public_token.
 */

// ─── Client + config ─────────────────────────────────────────────────

let _client: PlaidApi | null = null;

export function plaidConfigured(): boolean {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

/** Matches one of `sandbox | development | production`. Default sandbox. */
export function plaidEnvName(): "sandbox" | "development" | "production" {
  const raw = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
  if (raw === "production") return "production";
  if (raw === "development") return "development";
  return "sandbox";
}

export function plaidClient(): PlaidApi {
  if (_client) return _client;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET."
    );
  }
  const env = plaidEnvName();
  const config = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
        "Plaid-Version": "2020-09-14",
      },
    },
  });
  _client = new PlaidApi(config);
  return _client;
}

// ─── Cost controls: tier caps + daily accrual ────────────────────────

/**
 * Maximum number of active Plaid Items per user, by subscription tier.
 *
 * Each Item = one institution connection. Plaid charges $0.35/Item/month
 * for `investments_transactions_and_holdings`, so the cap bounds the
 * per-user Plaid spend.
 *
 * Beta (free) is capped tight — we can't lose money on a non-paying
 * user. Individual / Active scale with the subscription price. Advisor
 * is effectively uncapped within reason (50 = one for each client
 * portfolio).
 *
 * Worst case per-user monthly Plaid cost at cap:
 *   beta     3 × $0.35 =  $1.05
 *   individual 5 × $0.35 =  $1.75  (on $29 MRR → 6% of revenue)
 *   active    10 × $0.35 =  $3.50  (on $79 MRR → 4% of revenue)
 *   advisor   50 × $0.35 = $17.50  (on $500 MRR → 4% of revenue)
 *
 * Gross margin on infra stays >93% across all tiers.
 */
export const PLAID_ITEM_CAPS: Record<Tier, number> = {
  beta: 3,
  individual: 5,
  active: 10,
  advisor: 50,
};

/**
 * Plaid's billed product is `investments_transactions_and_holdings` at
 * $0.35 per Item per calendar month. We accrue 1/30th of that cost
 * per day per active Item into `user.monthlyCostCents`, keeping Plaid
 * spend visible in the same counter that already gates AI spend.
 *
 * 35 cents / 30 days ≈ 1.1667 cents/day. Round half-up per Item and
 * sum — that's 1 or 2 cents per Item per day depending on the running
 * fraction. Over 30 days it averages to 35¢ ± rounding.
 *
 * The exact Plaid invoice is the source of truth; this is a visibility
 * counter, not a billing system.
 */
export const PLAID_DAILY_COST_CENTS = 35 / 30; // ≈ 1.167

export type PlaidCapCheck =
  | { ok: true; tier: Tier; used: number; max: number }
  | { ok: false; tier: Tier; used: number; max: number };

/**
 * Check whether the user can link one more Plaid Item without
 * exceeding their tier cap. Returns { ok: false, used, max } at cap
 * so callers can show an upsell CTA ("On Individual you'd be able to
 * link 5").
 *
 * Does NOT count `removed` items — those are free. Does count
 * `active` and `login_required` (the user can still reauth them).
 */
export async function checkPlaidItemCap(userId: string): Promise<PlaidCapCheck> {
  const { rows } = await pool.query(
    `SELECT
       u."tier",
       COALESCE((
         SELECT COUNT(*)::int FROM "plaid_item"
         WHERE "userId" = u.id AND status IN ('active','login_required')
       ), 0) AS used
     FROM "user" u
     WHERE u.id = $1`,
    [userId]
  );
  if (rows.length === 0) {
    return { ok: false, tier: "beta", used: 0, max: 0 };
  }
  const row = rows[0] as { tier: Tier | null; used: number };
  const tier = (row.tier ?? "beta") as Tier;
  const max = PLAID_ITEM_CAPS[tier] ?? PLAID_ITEM_CAPS.beta;
  const used = Number(row.used);
  return used < max
    ? { ok: true, tier, used, max }
    : { ok: false, tier, used, max };
}

/**
 * Accrue one day of Plaid subscription cost against each user with
 * at least one active Plaid Item. Called from the nightly cron right
 * after `syncAllPlaidItems()`.
 *
 * Idempotency is enforced by the caller's schedule — this runs once
 * per day in the cron, so calling it twice would double-count. The
 * cron is registered as a single daily job in vercel.json.
 */
export async function accrueDailyPlaidCost(): Promise<{
  usersCharged: number;
  totalCents: number;
}> {
  if (!plaidConfigured()) {
    return { usersCharged: 0, totalCents: 0 };
  }
  // Aggregate active item counts per user in one query.
  const { rows } = await pool.query<{ userId: string; items: number }>(
    `SELECT "userId", COUNT(*)::int AS items
     FROM "plaid_item"
     WHERE status IN ('active','login_required')
     GROUP BY "userId"`
  );

  let totalCents = 0;
  for (const r of rows) {
    // Per-user per-day cost — round up each user's accrual so we never
    // under-report against Plaid's actual invoice.
    const cents = Math.ceil(r.items * PLAID_DAILY_COST_CENTS);
    totalCents += cents;
    await pool
      .query(
        `UPDATE "user"
         SET "monthlyCostCents" = "monthlyCostCents" + $1
         WHERE id = $2`,
        [cents, r.userId]
      )
      .catch((err) => {
        log.warn("plaid.cost", "accrual write failed", {
          userId: r.userId,
          items: r.items,
          ...errorInfo(err),
        });
      });
  }

  log.info("plaid.cost", "daily accrual complete", {
    usersCharged: rows.length,
    totalCents,
  });

  return { usersCharged: rows.length, totalCents };
}

/**
 * Remove Plaid Items for users who haven't signed in for `days` days.
 * Calls `/item/remove` (free) per Item, marks status=removed in our
 * db, and wipes Plaid-sourced holdings. The user can re-link when
 * they come back — Plaid charges nothing while the Item is removed.
 *
 * "Inactive" defined as no session row with expiresAt > NOW() -
 * days. BetterAuth rotates session rows on each sign-in, so absence
 * of a fresh row means the user hasn't been back.
 */
export async function cleanupInactivePlaidItems(
  days = 90
): Promise<{ users: number; itemsRemoved: number; errors: number }> {
  if (!plaidConfigured()) {
    return { users: 0, itemsRemoved: 0, errors: 0 };
  }

  // Users with at least one active Plaid Item AND no recent session
  const { rows } = await pool.query<{ userId: string; itemId: string }>(
    `SELECT DISTINCT p."userId", p."itemId"
     FROM "plaid_item" p
     WHERE p.status IN ('active','login_required')
       AND NOT EXISTS (
         SELECT 1 FROM "session" s
         WHERE s."userId" = p."userId"
           AND s."expiresAt" > NOW() - ($1 || ' days')::interval
       )`,
    [String(days)]
  );

  const byUser = new Map<string, number>();
  let errors = 0;
  for (const r of rows) {
    try {
      await removePlaidItem(r.userId, r.itemId);
      byUser.set(r.userId, (byUser.get(r.userId) ?? 0) + 1);
    } catch (err) {
      errors++;
      log.warn("plaid.cleanup", "remove failed", {
        userId: r.userId,
        itemId: r.itemId,
        ...errorInfo(err),
      });
    }
  }

  log.info("plaid.cleanup", "inactive cleanup complete", {
    days,
    users: byUser.size,
    itemsRemoved: rows.length - errors,
    errors,
  });

  return {
    users: byUser.size,
    itemsRemoved: rows.length - errors,
    errors,
  };
}

// ─── Link + token exchange ───────────────────────────────────────────

/**
 * Create a short-lived link_token the client uses to open Plaid Link.
 * Products scoped to `investments` only — Plaid enforces this at Link
 * time, which means even if future code tried to call bank endpoints,
 * the access_token wouldn't grant access.
 */
export async function createLinkToken(opts: {
  userId: string;
  webhookUrl?: string;
  /** For re-auth flows when an existing Item needs Login Required */
  accessToken?: string;
}): Promise<string> {
  const client = plaidClient();
  const resp = await client.linkTokenCreate({
    user: {
      // Opaque to Plaid — never sent any user PII in this field.
      client_user_id: opts.userId,
    },
    client_name: "ClearPath Invest",
    products: [Products.Investments],
    country_codes: [CountryCode.Us],
    language: "en",
    webhook: opts.webhookUrl,
    access_token: opts.accessToken, // re-auth flow
  });
  return resp.data.link_token;
}

/**
 * Exchange the `public_token` (ephemeral, from Link onSuccess) for a
 * long-lived `access_token`, encrypt it, persist the plaid_item row,
 * and return the new item's DB id.
 *
 * Idempotent on `itemId` — if this user already has this Item, we
 * update the access_token (covers re-auth) instead of erroring.
 */
export async function exchangePublicToken(
  userId: string,
  publicToken: string
): Promise<{ id: string; itemId: string; institutionName: string | null }> {
  const client = plaidClient();
  const exch = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });
  const accessToken = exch.data.access_token;
  const itemId = exch.data.item_id;

  // Pull institution metadata — nice for UI ("Linked Schwab on Apr 19")
  let institutionName: string | null = null;
  let institutionId: string | null = null;
  try {
    const itemResp = await client.itemGet({ access_token: accessToken });
    institutionId = itemResp.data.item.institution_id ?? null;
    if (institutionId) {
      const instResp = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = instResp.data.institution.name ?? null;
    }
  } catch (err) {
    // Non-fatal — the Item is still valid without institution metadata.
    log.warn("plaid", "institution lookup failed", {
      itemId,
      ...errorInfo(err),
    });
  }

  const id = crypto.randomUUID();
  const encryptedToken = encryptSecret(accessToken);

  await pool.query(
    `INSERT INTO "plaid_item"
      (id, "userId", "itemId", "accessTokenEncrypted", "institutionId",
       "institutionName", "status", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW())
     ON CONFLICT ("itemId") DO UPDATE SET
       "accessTokenEncrypted" = EXCLUDED."accessTokenEncrypted",
       "institutionId" = COALESCE(EXCLUDED."institutionId", "plaid_item"."institutionId"),
       "institutionName" = COALESCE(EXCLUDED."institutionName", "plaid_item"."institutionName"),
       "status" = 'active',
       "statusDetail" = NULL,
       "updatedAt" = NOW()`,
    [id, userId, itemId, encryptedToken, institutionId, institutionName]
  );

  log.info("plaid", "item exchanged", {
    userId,
    itemId,
    institutionName,
    env: plaidEnvName(),
  });

  return { id, itemId, institutionName };
}

// ─── Access token helpers ────────────────────────────────────────────

async function getAccessTokenForItem(
  userId: string,
  itemId: string
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT "accessTokenEncrypted"
     FROM "plaid_item"
     WHERE "userId" = $1 AND "itemId" = $2 AND "status" <> 'removed'
     LIMIT 1`,
    [userId, itemId]
  );
  if (rows.length === 0) return null;
  return decryptSecret((rows[0] as { accessTokenEncrypted: string }).accessTokenEncrypted);
}

// ─── Holdings sync ───────────────────────────────────────────────────

type SyncResult = {
  accounts: number;
  holdings: number;
  errors: string[];
};

/**
 * Pull `/investments/holdings/get` and upsert into our `holding`
 * table. Keyed by (userId, ticker, accountName) so the same position
 * across separate sub-accounts (e.g. Schwab IRA + Schwab Roth IRA)
 * stays distinct.
 *
 * Also upserts `plaid_account` for each sub-account so we have stable
 * display labels on the Portfolio page.
 */
export async function syncHoldings(
  userId: string,
  itemId: string
): Promise<SyncResult> {
  const accessToken = await getAccessTokenForItem(userId, itemId);
  if (!accessToken) {
    return { accounts: 0, holdings: 0, errors: ["item not found"] };
  }

  const client = plaidClient();
  const resp = await client.investmentsHoldingsGet({
    access_token: accessToken,
  });

  const { accounts, holdings, securities } = resp.data;
  const secById = new Map(securities.map((s) => [s.security_id, s]));
  const acctById = new Map(accounts.map((a) => [a.account_id, a]));

  let accountsUpserted = 0;
  let holdingsUpserted = 0;
  const errors: string[] = [];

  // 1. Upsert each account row (name + subtype)
  for (const acct of accounts) {
    try {
      await pool.query(
        `INSERT INTO "plaid_account"
          (id, "itemId", "userId", "plaidAccountId", name, "officialName",
           mask, type, subtype, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT ("plaidAccountId") DO UPDATE SET
           name = EXCLUDED.name,
           "officialName" = EXCLUDED."officialName",
           mask = EXCLUDED.mask,
           type = EXCLUDED.type,
           subtype = EXCLUDED.subtype,
           "updatedAt" = NOW()`,
        [
          crypto.randomUUID(),
          itemId,
          userId,
          acct.account_id,
          acct.name,
          acct.official_name ?? null,
          acct.mask ?? null,
          acct.type,
          acct.subtype ?? null,
        ]
      );
      accountsUpserted++;
    } catch (err) {
      errors.push(`account ${acct.account_id}: ${describe(err)}`);
    }
  }

  // 2. Wipe any prior Plaid holdings for these accounts (hard refresh
  //    — simpler than diff-syncing and Plaid's holdings endpoint
  //    returns the authoritative full snapshot each call).
  const plaidAccountIds = accounts.map((a) => a.account_id);
  if (plaidAccountIds.length > 0) {
    await pool.query(
      `DELETE FROM "holding"
       WHERE "userId" = $1
         AND source = 'plaid'
         AND "plaidAccountId" = ANY($2::text[])`,
      [userId, plaidAccountIds]
    );
  }

  // 3. Insert current holdings
  for (const h of holdings) {
    const sec = secById.get(h.security_id);
    const acct = acctById.get(h.account_id);
    const ticker = pickTicker(sec);
    if (!ticker) continue; // skip securities we can't map to a ticker (rare)

    const accountLabel = formatAccountLabel(acct);
    const assetClass = classifyPlaidSecurity(sec);
    const shares = Number(h.quantity);
    const institutionPrice = h.institution_price ?? null;
    const value =
      institutionPrice !== null ? shares * Number(institutionPrice) : null;

    try {
      await pool.query(
        `INSERT INTO "holding"
          (id, "userId", ticker, shares, "costBasis", "avgPrice", currency,
           "accountName", "plaidAccountId", source, "lastSyncedAt",
           "lastPrice", "lastValue", "assetClass")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'plaid', NOW(), $10, $11, $12)
         ON CONFLICT ("userId", ticker, COALESCE("accountName", ''::text)) DO UPDATE SET
           shares = EXCLUDED.shares,
           "costBasis" = EXCLUDED."costBasis",
           "avgPrice" = EXCLUDED."avgPrice",
           currency = EXCLUDED.currency,
           "plaidAccountId" = EXCLUDED."plaidAccountId",
           source = 'plaid',
           "lastSyncedAt" = NOW(),
           "lastPrice" = EXCLUDED."lastPrice",
           "lastValue" = EXCLUDED."lastValue",
           "assetClass" = COALESCE(EXCLUDED."assetClass", "holding"."assetClass")`,
        [
          crypto.randomUUID(),
          userId,
          ticker,
          shares,
          h.cost_basis ?? null,
          h.cost_basis != null && shares > 0
            ? Number(h.cost_basis) / shares
            : null,
          h.iso_currency_code ?? "USD",
          accountLabel,
          h.account_id,
          institutionPrice,
          value,
          assetClass,
        ]
      );
      holdingsUpserted++;
    } catch (err) {
      errors.push(`holding ${h.security_id}: ${describe(err)}`);
    }
  }

  // 4. Mark item as synced
  await pool.query(
    `UPDATE "plaid_item"
     SET "lastSyncedAt" = NOW(), "updatedAt" = NOW()
     WHERE "itemId" = $1`,
    [itemId]
  );

  log.info("plaid", "holdings sync complete", {
    userId,
    itemId,
    accountsUpserted,
    holdingsUpserted,
    errors: errors.length,
  });

  return { accounts: accountsUpserted, holdings: holdingsUpserted, errors };
}

// ─── Transactions sync ───────────────────────────────────────────────

/**
 * Pull `/investments/transactions/get` for the last `days` days and
 * insert any new rows into plaid_transaction. Dedup by
 * plaidTransactionId (unique index). Safe to call repeatedly — never
 * creates duplicates.
 */
export async function syncTransactions(
  userId: string,
  itemId: string,
  days = 30
): Promise<{ inserted: number; errors: string[] }> {
  const accessToken = await getAccessTokenForItem(userId, itemId);
  if (!accessToken) return { inserted: 0, errors: ["item not found"] };

  const client = plaidClient();
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let inserted = 0;
  const errors: string[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const resp = await client.investmentsTransactionsGet({
      access_token: accessToken,
      start_date: fmt(start),
      end_date: fmt(end),
      options: { count: pageSize, offset },
    });

    const { investment_transactions: txs, securities } = resp.data;
    const secById = new Map(securities.map((s) => [s.security_id, s]));

    for (const t of txs) {
      const sec = secById.get(t.security_id ?? "");
      const ticker = pickTicker(sec);
      try {
        await pool.query(
          `INSERT INTO "plaid_transaction"
            (id, "userId", "itemId", "plaidAccountId", "plaidTransactionId",
             ticker, "securityName", type, subtype, quantity, price, amount,
             fees, currency, "tradeDate", "settleDate", "createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())
           ON CONFLICT ("plaidTransactionId") DO NOTHING`,
          [
            crypto.randomUUID(),
            userId,
            itemId,
            t.account_id,
            t.investment_transaction_id,
            ticker,
            sec?.name ?? null,
            t.type,
            t.subtype ?? null,
            t.quantity,
            t.price,
            t.amount,
            t.fees ?? null,
            t.iso_currency_code ?? "USD",
            t.date,
            null, // settle date not in Plaid's schema
          ]
        );
        inserted++;
      } catch (err) {
        errors.push(`tx ${t.investment_transaction_id}: ${describe(err)}`);
      }
    }

    offset += txs.length;
    if (txs.length < pageSize) break;
    // Safety: Plaid caps this endpoint at ~2 years of data. We only
    // pull `days` days so shouldn't hit that, but belt-and-suspenders.
    if (offset > 2000) break;
  }

  log.info("plaid", "transactions sync complete", {
    userId,
    itemId,
    days,
    inserted,
    errors: errors.length,
  });

  return { inserted, errors };
}

// ─── Remove (disconnect) ─────────────────────────────────────────────

export async function removePlaidItem(
  userId: string,
  itemId: string
): Promise<{ ok: boolean }> {
  const accessToken = await getAccessTokenForItem(userId, itemId);
  if (!accessToken) return { ok: false };

  try {
    await plaidClient().itemRemove({ access_token: accessToken });
  } catch (err) {
    // If Plaid already considers it gone, carry on — our next step
    // marks it removed locally either way.
    log.warn("plaid", "item remove upstream failed (continuing)", {
      itemId,
      ...errorInfo(err),
    });
  }

  await pool.query(
    `UPDATE "plaid_item"
     SET "status" = 'removed', "updatedAt" = NOW()
     WHERE "itemId" = $1 AND "userId" = $2`,
    [itemId, userId]
  );

  // Also wipe any Plaid-sourced holdings
  await pool.query(
    `DELETE FROM "holding"
     WHERE "userId" = $1
       AND source = 'plaid'
       AND "plaidAccountId" IN (
         SELECT "plaidAccountId" FROM "plaid_account"
         WHERE "itemId" = $2 AND "userId" = $1
       )`,
    [userId, itemId]
  );

  log.info("plaid", "item removed", { userId, itemId });
  return { ok: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function pickTicker(sec: Security | undefined): string | null {
  if (!sec) return null;
  // Plaid returns ticker_symbol for listed securities. Fall back to
  // proxy_security_id only as last resort (rarely useful for our UI).
  return (
    sec.ticker_symbol ??
    sec.proxy_security_id ??
    null
  );
}

function formatAccountLabel(acct: AccountBase | undefined): string | null {
  if (!acct) return null;
  // "Schwab IRA · *4321" — short, unambiguous, fits table columns.
  const parts: string[] = [];
  if (acct.official_name || acct.name) {
    parts.push(acct.official_name ?? acct.name);
  } else if (acct.subtype) {
    parts.push(String(acct.subtype));
  }
  if (acct.mask) parts.push(`*${acct.mask}`);
  return parts.join(" · ") || null;
}

/**
 * Map Plaid security type/subtype into our internal asset-class
 * taxonomy so the dashboard Sector mix + Holdings table groupings
 * render correctly across SnapTrade + Plaid origins.
 */
function classifyPlaidSecurity(sec: Security | undefined): string | null {
  if (!sec) return null;
  const t = (sec.type ?? "").toLowerCase();
  if (t.includes("equity")) return "stock";
  if (t.includes("etf")) return "etf";
  if (t.includes("mutual")) return "mutual_fund";
  if (t.includes("fixed")) return "bond";
  if (t.includes("cash")) return "cash";
  if (t.includes("crypto")) return "crypto";
  if (t.includes("option")) return "option";
  return null;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return String(err).slice(0, 200);
}

// ─── Webhook verification (JWT / ES256) ──────────────────────────────

/**
 * Verify a Plaid webhook request.
 *
 * Plaid signs each webhook with an ES256 JWT in the `Plaid-Verification`
 * header. The JWT's body carries a sha256 of the request body, so
 * tampering with either invalidates the signature.
 *
 * To go to production safely, set:
 *   - PLAID_ENV=production
 *   - The environment must be able to call `/webhook_verification_key/get`
 *
 * In sandbox, Plaid still signs webhooks, but we can optionally accept
 * them without full verification (`PLAID_WEBHOOK_ALLOW_UNVERIFIED=1`)
 * to make local development easier. Never set that in production.
 */
export async function verifyPlaidWebhook(
  rawBody: string,
  signatureHeader: string | null
): Promise<{ ok: boolean; reason?: string }> {
  const allowUnverified =
    plaidEnvName() === "sandbox" &&
    process.env.PLAID_WEBHOOK_ALLOW_UNVERIFIED === "1";

  if (!signatureHeader) {
    if (allowUnverified) {
      log.warn("plaid.webhook", "accepting unverified webhook (sandbox)");
      return { ok: true };
    }
    return { ok: false, reason: "missing Plaid-Verification header" };
  }

  try {
    const [headerB64, payloadB64, signatureB64] = signatureHeader.split(".");
    if (!headerB64 || !payloadB64 || !signatureB64) {
      return { ok: false, reason: "malformed jwt" };
    }

    const headerJson = JSON.parse(
      Buffer.from(headerB64, "base64url").toString("utf8")
    ) as { kid?: string; alg?: string };

    if (headerJson.alg !== "ES256") {
      return { ok: false, reason: `unexpected alg: ${headerJson.alg}` };
    }
    const kid = headerJson.kid;
    if (!kid) return { ok: false, reason: "missing kid" };

    // Fetch (or cache) the public key
    const key = await getWebhookVerificationKey(kid);
    if (!key) return { ok: false, reason: "unknown key id" };

    // Verify ES256 signature
    const signingInput = `${headerB64}.${payloadB64}`;
    const sigBytes = Buffer.from(signatureB64, "base64url");
    // Plaid uses JWS style (concat r|s); Node's verify needs DER.
    const sigDer = jwsToDer(sigBytes);

    const publicKey = crypto.createPublicKey({
      key: key,
      format: "jwk",
    });
    const ok = crypto.verify(
      "sha256",
      Buffer.from(signingInput),
      publicKey,
      sigDer
    );

    if (!ok) return { ok: false, reason: "signature mismatch" };

    // Also check the JWT body's sha256 matches the raw webhook body
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    ) as { request_body_sha256?: string; iat?: number };

    const expected = crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex");
    if (payload.request_body_sha256 !== expected) {
      return { ok: false, reason: "body hash mismatch" };
    }

    // Reject webhooks older than 5 minutes (replay protection)
    if (payload.iat) {
      const ageSec = Date.now() / 1000 - payload.iat;
      if (ageSec > 300) return { ok: false, reason: "stale webhook" };
    }

    return { ok: true };
  } catch (err) {
    log.error("plaid.webhook", "verification threw", { ...errorInfo(err) });
    return { ok: false, reason: "verification threw" };
  }
}

// Simple in-memory key cache. Keys rarely rotate; new instances pay
// one Plaid API call.
const keyCache = new Map<string, object>();

async function getWebhookVerificationKey(
  kid: string
): Promise<object | null> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  try {
    const resp = await plaidClient().webhookVerificationKeyGet({
      key_id: kid,
    });
    const key = resp.data.key as unknown as object;
    keyCache.set(kid, key);
    return key;
  } catch (err) {
    log.warn("plaid.webhook", "key fetch failed", { kid, ...errorInfo(err) });
    return null;
  }
}

/**
 * Convert a JWS concatenated (r|s) signature into ASN.1/DER-encoded
 * form so Node's crypto.verify can consume it.
 */
function jwsToDer(raw: Buffer): Buffer {
  // JWS: 32-byte r || 32-byte s for P-256
  if (raw.length !== 64) throw new Error("bad es256 signature length");
  const r = stripLeadingZeros(raw.subarray(0, 32));
  const s = stripLeadingZeros(raw.subarray(32, 64));

  const encodeInt = (i: Buffer) => {
    // Prepend 0x00 if high bit set (DER INTEGER is signed)
    const needsPad = i[0] & 0x80;
    const body = needsPad ? Buffer.concat([Buffer.from([0x00]), i]) : i;
    return Buffer.concat([Buffer.from([0x02, body.length]), body]);
  };

  const rDer = encodeInt(r);
  const sDer = encodeInt(s);
  const seq = Buffer.concat([rDer, sDer]);
  return Buffer.concat([Buffer.from([0x30, seq.length]), seq]);
}

function stripLeadingZeros(buf: Buffer): Buffer {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i++;
  return buf.subarray(i);
}

// Keep the Plaid types re-exported so route handlers don't need a
// second import line.
export type { PlaidHolding, InvestmentTransaction, AccountBase };
