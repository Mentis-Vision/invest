import { pool } from "./db";
import { log, errorInfo } from "./log";

/**
 * Demo verdict snapshots.
 *
 * Stores nightly-refreshed price + change-percent for the four demo
 * tickers shown on the landing page (NVDA, TSLA, AAPL, NFLX). The
 * verdict TEXT in the demo stays curated — it's marketing copy
 * showcasing the three-lens method, not a live brief. But the
 * price/delta on each card refreshes nightly so visitors see real
 * numbers, not a stale `$486.92` from whenever we last hand-edited
 * the component.
 *
 * Cron: /api/cron/demo-snapshot pulls Yahoo snapshots and upserts.
 * Read path: landing/page.tsx server-fetches all rows on render,
 * passes the map down to the client demo component.
 *
 * Falls back gracefully — if the table is empty (first deploy) or
 * a fetch failed, the demo component substitutes its hardcoded
 * defaults so visitors always see something.
 */

export const DEMO_TICKERS: ReadonlyArray<string> = [
  "NVDA",
  "TSLA",
  "AAPL",
  "NFLX",
];

export type DemoSnapshot = {
  ticker: string;
  price: number;
  changePct: number;
  capturedAt: string;
};

let _schemaEnsured = false;
async function ensureSchema(): Promise<void> {
  if (_schemaEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "demo_snapshot" (
        ticker TEXT PRIMARY KEY,
        price NUMERIC NOT NULL,
        "changePct" NUMERIC NOT NULL,
        "capturedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    _schemaEnsured = true;
  } catch (err) {
    // Don't block the demo render if schema bootstrap fails — fall
    // through to the hardcoded defaults at the call site.
    log.warn("demo-snapshot", "ensureSchema failed", errorInfo(err));
    _schemaEnsured = true;
  }
}

/**
 * Upsert one ticker's freshly-fetched price into the snapshot table.
 * Called by the cron handler per ticker.
 */
export async function writeDemoSnapshot(
  ticker: string,
  price: number,
  changePct: number
): Promise<void> {
  await ensureSchema();
  await pool.query(
    `INSERT INTO "demo_snapshot" (ticker, price, "changePct", "capturedAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (ticker) DO UPDATE SET
       price = EXCLUDED.price,
       "changePct" = EXCLUDED."changePct",
       "capturedAt" = NOW()`,
    [ticker, price, changePct]
  );
}

/**
 * Read all current demo snapshots into a ticker-keyed map. Empty map
 * if the table doesn't exist yet (first deploy) or the read fails —
 * the demo component handles missing tickers by substituting its
 * own defaults, so this is a soft failure path.
 */
export async function readDemoSnapshots(): Promise<Map<string, DemoSnapshot>> {
  await ensureSchema();
  const out = new Map<string, DemoSnapshot>();
  try {
    const { rows } = await pool.query<{
      ticker: string;
      price: string;
      changePct: string;
      capturedAt: Date;
    }>(`SELECT ticker, price, "changePct", "capturedAt" FROM "demo_snapshot"`);
    for (const r of rows) {
      out.set(r.ticker, {
        ticker: r.ticker,
        price: Number(r.price),
        changePct: Number(r.changePct),
        capturedAt: r.capturedAt.toISOString(),
      });
    }
  } catch (err) {
    log.warn("demo-snapshot", "readDemoSnapshots failed", errorInfo(err));
  }
  return out;
}
