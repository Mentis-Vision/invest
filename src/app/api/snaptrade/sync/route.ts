import { NextResponse } from "next/server";
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
 * POST /api/snaptrade/sync
 * Pulls the last 90 days of transactions across the user's linked brokerages
 * and upserts them into the `trade` table (keyed by broker transaction id for
 * idempotency).
 */
export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!snaptradeConfigured()) {
    return NextResponse.json({ error: "snaptrade_not_configured" }, { status: 503 });
  }

  const { rows } = await pool.query(
    `SELECT 1 FROM "snaptrade_user" WHERE "userId" = $1 LIMIT 1`,
    [session.user.id]
  );
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, newTrades: 0, connected: false });
  }

  try {
    const { snaptradeUserId, userSecret } = await ensureSnaptradeUser(
      session.user.id
    );
    const inserted = await syncUserActivities(
      session.user.id,
      snaptradeUserId,
      userSecret
    );
    return NextResponse.json({ ok: true, newTrades: inserted, connected: true });
  } catch (err) {
    log.error("snaptrade.sync", "failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not sync trades. Try again." },
      { status: 500 }
    );
  }
}

/**
 * Shared helper — callable from the cron as well.
 */
export async function syncUserActivities(
  appUserId: string,
  snaptradeUserId: string,
  userSecret: string,
  daysBack = 90
): Promise<number> {
  const client = snaptradeClient();
  const endDate = new Date();
  const startDate = new Date(
    endDate.getTime() - daysBack * 24 * 60 * 60 * 1000
  );
  const fmt = (d: Date) => d.toISOString().split("T")[0];

  const resp = await client.transactionsAndReporting.getActivities({
    userId: snaptradeUserId,
    userSecret,
    startDate: fmt(startDate),
    endDate: fmt(endDate),
  });

  const activities = (resp.data ?? []) as Array<{
    id?: string;
    symbol?: { symbol?: { symbol?: string }; description?: string };
    option_symbol?: { ticker?: string };
    type?: string;
    units?: number;
    price?: number;
    amount?: number;
    fee?: number;
    trade_date?: string;
    settlement_date?: string;
    external_reference_id?: string;
  }>;

  let inserted = 0;
  for (const act of activities) {
    const ticker =
      act.symbol?.symbol?.symbol ??
      act.option_symbol?.ticker ??
      act.symbol?.description?.slice(0, 12).toUpperCase() ??
      null;
    if (!ticker) continue;

    const mapped = mapActivityType(act.type);
    if (!mapped) continue;

    const externalId =
      act.external_reference_id ?? act.id ?? `${ticker}-${act.trade_date}-${act.amount}`;

    const executedAt = act.trade_date
      ? new Date(act.trade_date)
      : act.settlement_date
      ? new Date(act.settlement_date)
      : new Date();

    try {
      const res = await pool.query(
        `INSERT INTO "trade" (id, "userId", ticker, type, shares, price, total, fees, "executedAt", "plaidTransactionId")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT ("plaidTransactionId") DO NOTHING`,
        [
          crypto.randomUUID(),
          appUserId,
          ticker,
          mapped,
          Math.abs(Number(act.units ?? 0)),
          Number(act.price ?? 0),
          Number(act.amount ?? 0),
          Number(act.fee ?? 0),
          executedAt,
          // We reuse the `plaidTransactionId` UNIQUE column to store the
          // broker-agnostic external id. SnapTrade reference id fits here.
          externalId,
        ]
      );
      if (res.rowCount) inserted += res.rowCount;
    } catch (err) {
      log.warn("snaptrade.sync", "trade insert failed", {
        ticker,
        ...errorInfo(err),
      });
    }
  }

  try {
    await pool.query(
      `UPDATE "snaptrade_user" SET "lastSyncedAt" = NOW() WHERE "userId" = $1`,
      [appUserId]
    );
  } catch {
    /* ignore */
  }

  return inserted;
}

function mapActivityType(type: string | undefined): string | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t === "buy") return "BUY";
  if (t === "sell") return "SELL";
  if (t === "dividend" || t === "distribution") return "DIVIDEND";
  if (t === "split" || t === "stock_split") return "SPLIT";
  if (t === "transfer") return "TRANSFER_IN";
  return null;
}
