// src/lib/broker-history/backfill.ts
// Orchestrator: dequeues jobs from broker_history_queue, dispatches
// to the per-source loader, then triggers fire-and-forget
// reconstruction. Reconciliation jobs only re-run the loader (they
// shouldn't shift reconstruction).

import { log, errorInfo } from "../log";
import { popQueuedJobs, markJobDone, markJobFailed } from "./queue";
import { backfillSnaptradeAccount } from "./snaptrade-loader";
import { backfillPlaidItem } from "./plaid-loader";
import { reconstructHistoricalSnapshots } from "./reconstruct";
import { pool } from "../db";

const MAX_PER_TICK = 5;

async function getPlaidItemForUser(userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ itemId: string }>(
    `SELECT "itemId" FROM "plaid_item" WHERE "userId" = $1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.itemId ?? null;
}

export async function runBackfillTick(): Promise<{ processed: number; failed: number }> {
  const jobs = await popQueuedJobs(MAX_PER_TICK);
  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      if (job.jobType === "full_backfill" || job.jobType === "delta_sync") {
        let result: { inserted: number; earliestTxnDate: string | null };
        if (job.source === "snaptrade") {
          result = await backfillSnaptradeAccount(job.userId, job.accountId);
        } else {
          const itemId = await getPlaidItemForUser(job.userId);
          if (!itemId) throw new Error("no plaid item for user");
          result = await backfillPlaidItem(job.userId, itemId, job.accountId);
        }
        await markJobDone(job.id, result.earliestTxnDate, result.inserted);
        // Fire-and-forget: reconstruction can take a while; don't block
        // the tick on it. Failures are logged inside reconstruct.
        reconstructHistoricalSnapshots(job.userId).catch((err) =>
          log.warn("broker-history.orchestrator", "reconstruct failed", {
            userId: job.userId,
            ...errorInfo(err),
          }),
        );
      } else if (job.jobType === "reconcile") {
        if (job.source === "snaptrade") {
          await backfillSnaptradeAccount(job.userId, job.accountId);
        } else {
          const itemId = await getPlaidItemForUser(job.userId);
          if (itemId) await backfillPlaidItem(job.userId, itemId, job.accountId);
        }
        await markJobDone(job.id, null, 0);
      }
      processed++;
    } catch (err) {
      await markJobFailed(job.id, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  return { processed, failed };
}
