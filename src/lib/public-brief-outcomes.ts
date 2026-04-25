import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { log, errorInfo } from "./log";
import { getOrFetchPrice } from "./outcomes";

/**
 * Public weekly brief outcome retrospective.
 *
 * Marketing-visible analog of the per-user `recommendation_outcome`
 * system. When a brief is published at /research/[slug] we schedule
 * four pending rows (7d / 30d / 90d / 365d). The daily cron evaluates
 * every row whose check_at has passed against today's price, records a
 * verdict (WIN / LOSS / FLAT), and the research page surfaces the
 * result as a public retrospective card.
 *
 * Shape mirrors `evaluatePendingOutcomes()` in src/lib/outcomes.ts but
 * operates on `public_weekly_brief_outcome` (system-scope, no user).
 *
 * The BUY/SELL/HOLD → win/loss/flat rules mirror the private evaluator:
 *   BUY  wins if price move > +THRESHOLD, loses if < -THRESHOLD, else FLAT
 *   SELL wins if price move < -THRESHOLD, loses if > +THRESHOLD, else FLAT
 *   HOLD wins if |price move| <= THRESHOLD, else FLAT (never a hard loss
 *        since HOLD is a do-nothing call)
 *
 * Benchmark delta (change_pct for SPY over the same window) is captured
 * in `benchmark_change_pct` when available so future aggregate views can
 * compute alpha; the verdict itself is absolute-move based to stay
 * consistent with the private evaluator.
 */

const THRESHOLD = 3; // percent — below which we call it FLAT
const BENCHMARK = "SPY";

const WINDOW_DAYS: Record<PublicBriefWindow, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

export type PublicBriefWindow = "7d" | "30d" | "90d" | "365d";
export type PublicBriefVerdict = "WIN" | "LOSS" | "FLAT";

export type PublicBriefOutcomeRow = {
  id: string;
  briefId: string;
  window: PublicBriefWindow;
  checkAt: string;
  status: "pending" | "completed" | "skipped";
  priceAtCheck: number | null;
  changePct: number | null;
  benchmarkChangePct: number | null;
  verdict: PublicBriefVerdict | null;
  evaluatedAt: string | null;
  createdAt: string;
};

/**
 * Insert the four pending outcome rows for a freshly published brief.
 *
 * Uses ON CONFLICT so re-scheduling a brief is idempotent — the unique
 * index on (brief_id, "window") ensures we only ever have one row per
 * combination.
 *
 * check_at is computed as brief.created_at + window, so the daily cron
 * picks these up on the right day regardless of wall-clock drift.
 */
export async function scheduleBriefOutcomes(
  briefId: string
): Promise<{ scheduled: number; checkAt: Record<PublicBriefWindow, string> }> {
  const { rows } = await pool.query<{ created_at: Date }>(
    `SELECT created_at FROM "public_weekly_brief" WHERE id = $1 LIMIT 1`,
    [briefId]
  );
  const brief = rows[0];
  if (!brief) {
    throw new Error(
      `public-brief-outcomes: brief ${briefId} not found; cannot schedule`
    );
  }

  const created =
    brief.created_at instanceof Date
      ? brief.created_at
      : new Date(brief.created_at);

  const checkAt: Record<PublicBriefWindow, string> = {
    "7d": "",
    "30d": "",
    "90d": "",
    "365d": "",
  };
  let scheduled = 0;

  for (const window of Object.keys(WINDOW_DAYS) as PublicBriefWindow[]) {
    const days = WINDOW_DAYS[window];
    const when = new Date(created.getTime() + days * 24 * 60 * 60 * 1000);
    checkAt[window] = when.toISOString();

    const id = randomUUID();
    const res = await pool.query(
      `INSERT INTO "public_weekly_brief_outcome"
         (id, brief_id, "window", check_at, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (brief_id, "window") DO NOTHING`,
      [id, briefId, window, when.toISOString()]
    );
    if ((res.rowCount ?? 0) > 0) scheduled++;
  }

  log.info("public-brief-outcomes", "scheduled", {
    briefId,
    scheduled,
    checkAt,
  });

  return { scheduled, checkAt };
}

/**
 * Evaluate every pending public-brief outcome whose check_at has
 * elapsed. Called from the daily /api/cron/evaluate-outcomes cron
 * after the per-user evaluator runs.
 *
 * For each row we pull the parent brief's recommendation + priceAtRec,
 * fetch today's price via the shared getOrFetchPrice() helper (warehouse
 * → price_snapshot → Yahoo), compute the percent move, capture SPY's
 * move over the same window for future alpha math, and persist.
 *
 * Errors on individual rows are logged but never fail the batch — one
 * delisted ticker shouldn't block every other brief's evaluation.
 */
export async function evaluatePendingPublicBriefOutcomes(
  limit = 200
): Promise<{ evaluated: number; skipped: number; failed: number }> {
  const { rows } = await pool.query(
    `SELECT o.id, o.brief_id, o."window", o.check_at,
            b.ticker, b.recommendation, b.price_at_rec, b.created_at AS brief_created_at
       FROM "public_weekly_brief_outcome" o
       JOIN "public_weekly_brief" b ON b.id = o.brief_id
      WHERE o.status = 'pending'
        AND o.check_at <= NOW()
      ORDER BY o.check_at ASC
      LIMIT $1`,
    [limit]
  );

  let evaluated = 0;
  let skipped = 0;
  let failed = 0;

  for (const raw of rows as Array<{
    id: string;
    brief_id: string;
    window: PublicBriefWindow;
    check_at: Date;
    ticker: string;
    recommendation: string;
    price_at_rec: string | number | null;
    brief_created_at: Date;
  }>) {
    try {
      const priceAtRec =
        raw.price_at_rec == null ? null : Number(raw.price_at_rec);

      if (priceAtRec == null || !Number.isFinite(priceAtRec) || priceAtRec <= 0) {
        await pool.query(
          `UPDATE "public_weekly_brief_outcome"
              SET status = 'skipped', evaluated_at = NOW()
            WHERE id = $1`,
          [raw.id]
        );
        skipped++;
        continue;
      }

      const currentPrice = await getOrFetchPrice(raw.ticker);
      if (currentPrice == null) {
        await pool.query(
          `UPDATE "public_weekly_brief_outcome"
              SET status = 'skipped', evaluated_at = NOW()
            WHERE id = $1`,
          [raw.id]
        );
        skipped++;
        continue;
      }

      const changePct = ((currentPrice - priceAtRec) / priceAtRec) * 100;

      // Best-effort SPY benchmark — don't block the row on a benchmark miss.
      let benchmarkChangePct: number | null = null;
      try {
        const benchNow = await getOrFetchPrice(BENCHMARK);
        const benchThen = await getBenchmarkPriceAt(raw.brief_created_at);
        if (
          benchNow != null &&
          benchThen != null &&
          Number.isFinite(benchThen) &&
          benchThen > 0
        ) {
          benchmarkChangePct = ((benchNow - benchThen) / benchThen) * 100;
        }
      } catch {
        /* benchmark best-effort only */
      }

      const verdict = categorizePublicBrief(raw.recommendation, changePct);

      await pool.query(
        `UPDATE "public_weekly_brief_outcome"
            SET status = 'completed',
                price_at_check = $1,
                change_pct = $2,
                benchmark_change_pct = $3,
                verdict = $4,
                evaluated_at = NOW()
          WHERE id = $5`,
        [currentPrice, changePct, benchmarkChangePct, verdict, raw.id]
      );
      evaluated++;
    } catch (err) {
      log.error("public-brief-outcomes", "evaluation failed", {
        outcomeId: raw.id,
        briefId: raw.brief_id,
        ticker: raw.ticker,
        window: raw.window,
        ...errorInfo(err),
      });
      failed++;
    }
  }

  log.info("public-brief-outcomes", "batch complete", {
    evaluated,
    skipped,
    failed,
  });
  return { evaluated, skipped, failed };
}

/**
 * Read all four outcome rows for a brief. Used by /research/[slug] to
 * render the retrospective card — returns every row regardless of
 * status so the page can decide what to display (completed → badge,
 * pending → "resolves at X" placeholder).
 *
 * Ordered by window ascending (7d → 30d → 90d → 365d) so the UI can
 * trust positional order without extra sort.
 */
export async function getOutcomesForBrief(
  briefId: string
): Promise<PublicBriefOutcomeRow[]> {
  const { rows } = await pool.query(
    `SELECT id, brief_id, "window", check_at, status,
            price_at_check, change_pct, benchmark_change_pct,
            verdict, evaluated_at, created_at
       FROM "public_weekly_brief_outcome"
      WHERE brief_id = $1
      ORDER BY CASE "window"
                 WHEN '7d'   THEN 1
                 WHEN '30d'  THEN 2
                 WHEN '90d'  THEN 3
                 WHEN '365d' THEN 4
                 ELSE 99
               END ASC`,
    [briefId]
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    briefId: String(r.brief_id),
    window: String(r.window) as PublicBriefWindow,
    checkAt:
      r.check_at instanceof Date
        ? r.check_at.toISOString()
        : String(r.check_at),
    status: String(r.status) as PublicBriefOutcomeRow["status"],
    priceAtCheck: r.price_at_check == null ? null : Number(r.price_at_check),
    changePct: r.change_pct == null ? null : Number(r.change_pct),
    benchmarkChangePct:
      r.benchmark_change_pct == null ? null : Number(r.benchmark_change_pct),
    verdict:
      r.verdict == null ? null : (String(r.verdict) as PublicBriefVerdict),
    evaluatedAt:
      r.evaluated_at == null
        ? null
        : r.evaluated_at instanceof Date
          ? r.evaluated_at.toISOString()
          : String(r.evaluated_at),
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
  }));
}

/**
 * Three-outcome categoriser for public briefs.
 *
 * HOLD is intentionally lenient — a HOLD that sat through a big move
 * still counts as FLAT rather than a LOSS because HOLD is a "do nothing"
 * recommendation; you only lose on a HOLD if you read it as buy-signal,
 * which is outside the brief's claim. This mirrors how the private
 * evaluator treats `hold_confirmed` (no move) vs `contrary_*` (user
 * traded against HOLD) — public briefs have no user action, so HOLD
 * reduces to FLAT when the move exceeds threshold.
 */
export function categorizePublicBrief(
  recommendation: string,
  changePct: number
): PublicBriefVerdict {
  const move = Number.isFinite(changePct) ? changePct : 0;
  if (recommendation === "BUY") {
    if (move > THRESHOLD) return "WIN";
    if (move < -THRESHOLD) return "LOSS";
    return "FLAT";
  }
  if (recommendation === "SELL") {
    if (move < -THRESHOLD) return "WIN";
    if (move > THRESHOLD) return "LOSS";
    return "FLAT";
  }
  // HOLD and anything unexpected — a narrow band is the hit, any bigger
  // move is FLAT (not a "loss" — HOLD never claims direction).
  if (Math.abs(move) <= THRESHOLD) return "WIN";
  return "FLAT";
}

/**
 * Look up SPY's closing price nearest the brief's creation timestamp.
 * Uses price_snapshot when available (captured daily), falls back to
 * null if nothing on or before the brief date — callers treat null as
 * "no benchmark for this row" and skip alpha math.
 */
async function getBenchmarkPriceAt(at: Date): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ price: string | number }>(
      `SELECT price FROM "price_snapshot"
        WHERE ticker = $1
          AND "capturedAt" <= $2::date
        ORDER BY "capturedAt" DESC
        LIMIT 1`,
      [BENCHMARK, at.toISOString().slice(0, 10)]
    );
    if (rows.length === 0) return null;
    const v = Number(rows[0].price);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
