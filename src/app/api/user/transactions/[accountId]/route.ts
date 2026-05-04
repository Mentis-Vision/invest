// src/app/api/user/transactions/[accountId]/route.ts
// Per-connection purge endpoint. Spec §8 — user-control surface.
// Wraps txn-purge + reconstructed-snapshot purge in a single
// transaction, then re-runs reconstruction so the chart re-stabilizes
// against the user's remaining connections.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";
import { reconstructHistoricalSnapshots } from "@/lib/broker-history/reconstruct";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { accountId } = await params;
  const userId = session.user.id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txnRes = await client.query(
      `DELETE FROM broker_transactions
       WHERE "userId" = $1 AND account_id = $2
       RETURNING id`,
      [userId, accountId],
    );
    const transactionsDeleted = txnRes.rowCount ?? 0;
    const snapRes = await client.query(
      `DELETE FROM portfolio_snapshot
       WHERE "userId" = $1 AND COALESCE(source, 'observed') = 'reconstructed'
       RETURNING id`,
      [userId],
    );
    const snapshotsDeleted = snapRes.rowCount ?? 0;
    await client.query("COMMIT");

    // Fire-and-forget: re-reconstruct against whatever connections
    // remain. Failure here is non-fatal — we already returned the user
    // a clean DB state, and the next snapshot run will retry.
    await reconstructHistoricalSnapshots(userId).catch((err) =>
      log.warn("user.transactions.purge", "reconstruct after purge failed", {
        userId,
        err: String(err),
      }),
    );

    log.info("user.transactions.purge", "complete", {
      userId,
      accountId,
      transactionsDeleted,
      snapshotsDeleted,
    });
    return NextResponse.json({
      ok: true,
      transactionsDeleted,
      snapshotsDeleted,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    log.error("user.transactions.purge", "failed", {
      userId,
      accountId,
      err: String(err),
    });
    return NextResponse.json({ error: "purge_failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
