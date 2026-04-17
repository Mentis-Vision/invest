import { pool } from "../db";
import { log, errorInfo } from "../log";

/**
 * THE PRIVACY BOUNDARY.
 *
 * This is the ONE place in the entire codebase that reads `holding.ticker`
 * for the warehouse refresh. It returns a deduplicated string[] — never an
 * object, never a userId, never a map.
 *
 * Callers: the nightly cron's refreshWarehouse() only.
 * Do NOT call this from request handlers.
 *
 * If a PR adds a caller in an app route, it is a privacy violation.
 */
export async function getTickerUniverse(): Promise<string[]> {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ticker FROM "holding" WHERE ticker IS NOT NULL`
    );
    return rows.map((r: Record<string, unknown>) => r.ticker as string);
  } catch (err) {
    log.warn("warehouse.universe", "getTickerUniverse failed", errorInfo(err));
    return [];
  }
}
