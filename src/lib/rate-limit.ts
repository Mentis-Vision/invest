import { pool } from "./db";
import { log, errorInfo } from "./log";

/**
 * Postgres-backed sliding-window rate limiter.
 *
 * Why Postgres instead of Redis: we already have Neon. Upstash Redis would
 * give us sub-millisecond reads but this app's scale (individual investors)
 * doesn't need it. Latency budget here is ~50–100ms per check; AI calls
 * that follow are 10–30 seconds.
 *
 * Algorithm: fixed 60-second buckets summed over a window. Not a perfect
 * sliding window but prevents burst abuse and is idempotent on DB writes.
 *
 * If we cross ~100 qps sustained, migrate to Upstash Redis — tracked in
 * DEFERRED.md.
 */

export type RateLimitRule = {
  /** Unique identifier for this rule (used to scope keys). */
  name: string;
  /** Max requests allowed in the window. */
  limit: number;
  /** Window size in seconds. */
  windowSec: number;
};

export type RateLimitResult = {
  ok: boolean;
  /** Remaining requests in window. */
  remaining: number;
  /** Unix seconds when the oldest relevant bucket expires. */
  resetAt: number;
  /** For 429 Retry-After header. */
  retryAfterSec: number;
  /** Tier label that failed, for debugging. */
  rule: string;
};

/**
 * Rules. More restrictive rules win.
 */
export const RULES = {
  /** Research: expensive (3 model calls). 20/hour per user. */
  researchUser: { name: "research:user", limit: 20, windowSec: 60 * 60 },
  /** Research: 5/hour per anon IP. Stops bot spray from signed-out routes. */
  researchIp: { name: "research:ip", limit: 5, windowSec: 60 * 60 },
  /** Strategy: 10/hour per user. */
  strategyUser: { name: "strategy:user", limit: 10, windowSec: 60 * 60 },
  /** Waitlist: 10 submits per hour per IP (spam). */
  waitlistIp: { name: "waitlist:ip", limit: 10, windowSec: 60 * 60 },
  /** Auth: protect against password-spray brute force. */
  authIp: { name: "auth:ip", limit: 30, windowSec: 10 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Check a rate limit and increment the bucket if allowed.
 *
 * `key` should be scoped to the caller (userId or IP). Combined with the
 * rule name to form the final DB key.
 *
 * Returns `{ ok: false }` on failure OR when DB is unreachable — we fail
 * open rather than locking users out on infrastructure blip. Fail-open is
 * safer for UX; per-user cost cap (see usage.ts) is the real wallet shield.
 */
export async function checkRateLimit(
  rule: RateLimitRule,
  key: string
): Promise<RateLimitResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const bucketSec = 60; // 1-minute buckets
  const windowStartSec = nowSec - rule.windowSec;

  const fullKey = `${rule.name}:${key}`;
  const currentBucket = new Date(Math.floor(nowSec / bucketSec) * bucketSec * 1000);

  try {
    // Sum existing counts in window
    const { rows: sumRows } = await pool.query(
      `SELECT COALESCE(SUM("count"),0)::int AS total
       FROM "rate_limit"
       WHERE "key" = $1 AND "bucket" > to_timestamp($2)`,
      [fullKey, windowStartSec]
    );
    const current = (sumRows[0]?.total as number) ?? 0;

    if (current >= rule.limit) {
      // Over limit. Find earliest bucket to compute retryAfter.
      const { rows: oldestRows } = await pool.query(
        `SELECT EXTRACT(EPOCH FROM MIN("bucket"))::int AS oldest_sec
         FROM "rate_limit"
         WHERE "key" = $1 AND "bucket" > to_timestamp($2)`,
        [fullKey, windowStartSec]
      );
      const oldestSec = (oldestRows[0]?.oldest_sec as number) ?? nowSec;
      const resetAt = oldestSec + rule.windowSec;
      const retryAfterSec = Math.max(1, resetAt - nowSec);
      return {
        ok: false,
        remaining: 0,
        resetAt,
        retryAfterSec,
        rule: rule.name,
      };
    }

    // Under limit — increment current bucket
    await pool.query(
      `INSERT INTO "rate_limit" ("key","bucket","count")
       VALUES ($1, $2, 1)
       ON CONFLICT ("key","bucket") DO UPDATE SET "count" = "rate_limit"."count" + 1`,
      [fullKey, currentBucket]
    );

    return {
      ok: true,
      remaining: rule.limit - current - 1,
      resetAt: nowSec + rule.windowSec,
      retryAfterSec: 0,
      rule: rule.name,
    };
  } catch (err) {
    log.error("rate-limit", "check failed, failing open", {
      rule: rule.name,
      key: fullKey,
      ...errorInfo(err),
    });
    return {
      ok: true,
      remaining: rule.limit,
      resetAt: nowSec + rule.windowSec,
      retryAfterSec: 0,
      rule: rule.name,
    };
  }
}

/**
 * Extract the client IP from a request.
 * Falls back through x-forwarded-for, x-real-ip, cf-connecting-ip.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

/**
 * Fire-and-forget sweeper that trims old buckets. Called opportunistically
 * from rate-limit checks (~1% of the time). Cheap enough to not need a cron.
 */
export async function sweepStaleBuckets() {
  try {
    await pool.query(
      `DELETE FROM "rate_limit" WHERE "bucket" < NOW() - INTERVAL '2 hours'`
    );
  } catch {
    /* ignore sweep failures */
  }
}
