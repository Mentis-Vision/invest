import { pool } from "../db";
import { log, errorInfo } from "../log";
import { SEED_TICKERS, SEED_UNIVERSE } from "./seed-universe";

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
 *
 * SEED UNION
 * ----------
 * The returned set is `union(holdings, SEED_UNIVERSE)`. The seed list
 * is a static, hand-curated constant (S&P 500 + Nasdaq 100 + Dow 30 +
 * retail favorites + foreign ADRs + popular ETFs) imported from
 * ./seed-universe.ts. It carries ZERO user attribution — it's a
 * compiled-in constant, not a DB read, not a userId. Adding it does
 * NOT weaken AGENTS.md rule #9: the rule forbids new callers that
 * read `holding.ticker`; the seed list is a disjoint, public set
 * unioned INTO this function's return value.
 */
export async function getTickerUniverse(): Promise<string[]> {
  const seed = new Set<string>(SEED_TICKERS.map((t) => t.toUpperCase()));
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ticker FROM "holding" WHERE ticker IS NOT NULL`
    );
    for (const r of rows as Array<Record<string, unknown>>) {
      const t = r.ticker;
      if (typeof t === "string" && t.length > 0) seed.add(t.toUpperCase());
    }
    return Array.from(seed);
  } catch (err) {
    log.warn("warehouse.universe", "getTickerUniverse failed", errorInfo(err));
    // Fall back to just the seed set — better than an empty universe
    // (the seed is a compiled constant, can't fail).
    return Array.from(seed);
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
 *
 * SEED UNION
 * ----------
 * Like getTickerUniverse, the result is unioned with SEED_UNIVERSE so
 * the nightly refresh primes the warehouse for programmatic /stocks/[ticker]
 * pages even when no user holds the ticker. Holdings win on asset_class
 * conflicts (a real user classification beats the seed default) — this
 * means crypto stays correctly classified if any user holds it. The seed
 * list itself contains NO crypto (see seed-universe.ts "INTENTIONAL
 * EXCLUSIONS").
 */
export type ClassifiedTicker = {
  ticker: string;
  assetClass: "equity" | "etf" | "crypto" | "other";
};

export async function getClassifiedUniverse(): Promise<ClassifiedTicker[]> {
  const out = new Map<string, ClassifiedTicker["assetClass"]>();

  // Seed first — holdings will override below.
  for (const seed of SEED_UNIVERSE) {
    out.set(seed.ticker.toUpperCase(), seed.assetClass);
  }

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
    for (const r of rows as Array<Record<string, unknown>>) {
      const ticker = typeof r.ticker === "string" ? r.ticker : null;
      if (!ticker) continue;
      const ac = String(r.asset_class ?? "equity");
      const normalized: ClassifiedTicker["assetClass"] =
        ac === "crypto" || ac === "etf" || ac === "equity" || ac === "other"
          ? ac
          : "equity";
      // Holdings override seed classification (real data beats defaults).
      out.set(ticker.toUpperCase(), normalized);
    }
  } catch (err) {
    log.warn(
      "warehouse.universe",
      "getClassifiedUniverse failed",
      errorInfo(err)
    );
    // Keep the seed-only result — same fallback philosophy as
    // getTickerUniverse.
  }

  return Array.from(out.entries()).map(([ticker, assetClass]) => ({
    ticker,
    assetClass,
  }));
}
