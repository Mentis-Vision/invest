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

/**
 * Same privacy boundary as getTickerUniverse, but ALSO returns each
 * ticker's asset class so the refresh layer can route correctly:
 *   - equity / etf → Yahoo (broad coverage)
 *   - crypto → Alpha Vantage DIGITAL_CURRENCY (Yahoo resolves naked
 *     crypto symbols like BTC/LINK/ATOM to equity namesakes — the
 *     bug we're fixing)
 *
 * Returns a flat array of {ticker, assetClass} — still no userId, still
 * no map back to the user. Just the richer description needed for routing.
 */
export type ClassifiedTicker = {
  ticker: string;
  assetClass: "equity" | "etf" | "crypto" | "other";
};

export async function getClassifiedUniverse(): Promise<ClassifiedTicker[]> {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ticker,
              -- Worst-case asset class wins so we route through the
              -- safer source. If any user holds 'BTC' as crypto, treat
              -- it as crypto for the warehouse even if another row has
              -- it labeled equity.
              CASE
                WHEN bool_or(LOWER("assetClass") = 'crypto') THEN 'crypto'
                WHEN bool_or(LOWER("assetClass") = 'etf') THEN 'etf'
                WHEN bool_or("assetClass" IS NULL) THEN 'equity'
                ELSE COALESCE(LOWER(MAX("assetClass")), 'equity')
              END AS asset_class
       FROM "holding"
       WHERE ticker IS NOT NULL
       GROUP BY ticker`
    );
    return rows.map((r: Record<string, unknown>) => {
      const ac = String(r.asset_class ?? "equity");
      return {
        ticker: String(r.ticker),
        assetClass:
          ac === "crypto" || ac === "etf" || ac === "equity" || ac === "other"
            ? ac
            : "equity",
      };
    });
  } catch (err) {
    log.warn(
      "warehouse.universe",
      "getClassifiedUniverse failed",
      errorInfo(err)
    );
    return [];
  }
}
