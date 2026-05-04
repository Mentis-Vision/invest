// src/lib/broker-history/queue.ts
// Thin DB wrappers over broker_history_queue.

import { pool } from "../db";
import { log } from "../log";
import type { BackfillJob, BackfillJobType, BrokerSource } from "./types";

interface QueueRow {
  id: string;
  userId: string;
  source: BrokerSource;
  account_id: string;
  job_type: BackfillJobType;
  status: BackfillJob["status"];
  attempts: number;
  last_error: string | null;
  earliest_txn_date: string | null;
  txn_count_inserted: number | null;
}

function toJob(r: QueueRow): BackfillJob {
  return {
    id: r.id,
    userId: r.userId,
    source: r.source,
    accountId: r.account_id,
    jobType: r.job_type,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    earliestTxnDate: r.earliest_txn_date,
    txnCountInserted: r.txn_count_inserted,
  };
}

export async function enqueueJob(
  userId: string,
  source: BrokerSource,
  accountId: string,
  jobType: BackfillJobType,
): Promise<void> {
  await pool.query(
    `INSERT INTO broker_history_queue ("userId", source, account_id, job_type, status)
     VALUES ($1, $2, $3, $4, 'queued')`,
    [userId, source, accountId, jobType],
  );
}

export async function popQueuedJobs(limit: number): Promise<BackfillJob[]> {
  const result = await pool.query<QueueRow>(
    `WITH next AS (
       SELECT id FROM broker_history_queue
       WHERE status = 'queued'
       ORDER BY "queuedAt" ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE broker_history_queue
     SET status = 'running',
         "startedAt" = NOW(),
         attempts = attempts + 1,
         "updatedAt" = NOW()
     FROM next
     WHERE broker_history_queue.id = next.id
     RETURNING broker_history_queue.id,
               broker_history_queue."userId",
               broker_history_queue.source,
               broker_history_queue.account_id,
               broker_history_queue.job_type,
               broker_history_queue.status,
               broker_history_queue.attempts,
               broker_history_queue.last_error,
               broker_history_queue.earliest_txn_date,
               broker_history_queue.txn_count_inserted`,
    [limit],
  );
  return result.rows.map(toJob);
}

export async function markJobDone(
  jobId: string,
  earliestTxnDate: string | null,
  txnCountInserted: number,
): Promise<void> {
  await pool.query(
    `UPDATE broker_history_queue
     SET status = 'done',
         "completedAt" = NOW(),
         earliest_txn_date = $2,
         txn_count_inserted = $3,
         last_error = NULL,
         "updatedAt" = NOW()
     WHERE id = $1`,
    [jobId, earliestTxnDate, txnCountInserted],
  );
}

export async function markJobFailed(jobId: string, error: string, maxAttempts = 5): Promise<void> {
  await pool.query(
    `UPDATE broker_history_queue
     SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'queued' END,
         last_error = $2,
         "updatedAt" = NOW()
     WHERE id = $1`,
    [jobId, error.slice(0, 1000), maxAttempts],
  );
  log.warn("broker-history.queue", "job failed", { jobId, error: error.slice(0, 200) });
}

export async function listEnqueuedFor(
  userId: string,
  accountId: string,
): Promise<BackfillJob[]> {
  const result = await pool.query<QueueRow>(
    `SELECT id, "userId", source, account_id, job_type, status, attempts,
            last_error, earliest_txn_date, txn_count_inserted
     FROM broker_history_queue
     WHERE "userId" = $1 AND account_id = $2
     ORDER BY "queuedAt" DESC
     LIMIT 20`,
    [userId, accountId],
  );
  return result.rows.map(toJob);
}
