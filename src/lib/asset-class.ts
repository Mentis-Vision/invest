/**
 * Asset class classification.
 *
 * Our research pipeline is equity-oriented (SEC filings, Form 4 insider
 * trades, Yahoo fundamentals) — which falls apart on crypto, ETFs of
 * ETFs, bonds, cash. Classifying on holdings sync lets us:
 *   1. Render a correct dashboard donut (crypto as its own slice, not
 *      forced into "Technology" just because Yahoo said so).
 *   2. Skip SEC + Form 4 tool paths for crypto in the analyst pipeline.
 *   3. Warn users before attempting research on an asset class we don't
 *      support well.
 *
 * Heuristics (ordered, first hit wins):
 *   1. Known crypto ticker set.
 *   2. Yahoo `quoteType` hint (when metadata lookup provides it).
 *   3. Known ETF ticker set.
 *   4. Default: equity.
 *
 * Conservative: unknown crypto will fall through to equity and produce
 * a poor research result, but won't misclassify a real stock.
 */

export type AssetClass = "equity" | "etf" | "crypto" | "bond" | "cash" | "unknown";

/**
 * Curated crypto ticker list. Covers top ~80 coins by market cap as of
 * early 2026, plus the major stablecoins. Expand as users show up with
 * long-tail tickers. SPK = Spark (FPL / Spark Protocol) — in demo user
 * portfolio.
 */
const CRYPTO_TICKERS = new Set<string>([
  // Majors
  "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "TRX", "AVAX", "DOT", "LINK",
  "MATIC", "LTC", "SHIB", "BCH", "ATOM", "XLM", "ETC", "NEAR", "FIL", "HBAR",
  // DeFi + L2
  "UNI", "AAVE", "MKR", "CRV", "SUSHI", "COMP", "SNX", "YFI", "1INCH", "LDO",
  "RPL", "ARB", "OP", "IMX", "STRK", "BLUR",
  // L1 / alt-L1
  "ALGO", "VET", "ICP", "EGLD", "THETA", "FTM", "KAVA", "ONE", "ROSE", "XTZ",
  "FLOW", "MINA", "APT", "SUI", "SEI", "INJ", "TIA", "KAS",
  // Meme / niche
  "PEPE", "WIF", "BONK", "FLOKI", "BRETT",
  // Gaming / metaverse
  "SAND", "MANA", "AXS", "GALA", "ENJ", "APE", "ILV",
  // Infra / oracle
  "GRT", "BAT", "ZEC", "DASH", "QNT", "RNDR", "TAO", "FET", "AGIX",
  // Stables (rarely held but do appear)
  "USDT", "USDC", "DAI", "BUSD", "TUSD", "USDP", "FDUSD", "PYUSD",
  // Demo-user specific
  "SPK",
]);

/**
 * Curated ETF list — limited. Most ETFs will get classified as "equity"
 * which is fine for rendering; we only need the biggest ones to show
 * as ETF in the donut.
 */
const ETF_TICKERS = new Set<string>([
  "SPY", "QQQ", "VTI", "VOO", "IWM", "DIA", "EFA", "VEA", "EEM", "VWO",
  "BND", "AGG", "TLT", "HYG", "LQD", "SHY",
  "XLK", "XLF", "XLE", "XLV", "XLY", "XLI", "XLP", "XLU", "XLB",
  "GLD", "SLV", "USO", "UNG",
  "ARKK", "ARKG", "ARKW", "SOXX",
]);

export function isKnownCrypto(ticker: string): boolean {
  return CRYPTO_TICKERS.has(ticker.toUpperCase());
}

export function isKnownEtf(ticker: string): boolean {
  return ETF_TICKERS.has(ticker.toUpperCase());
}

/**
 * Classify from what we know about the ticker. `quoteType` is Yahoo's
 * classification when available (e.g. "CRYPTOCURRENCY", "ETF", "EQUITY").
 */
export function classifyAsset(
  ticker: string,
  hints?: { quoteType?: string | null; typeDisp?: string | null }
): AssetClass {
  const t = ticker.toUpperCase();

  // Hint-driven classification first — Yahoo's own tag is the most reliable.
  const qt = (hints?.quoteType ?? "").toUpperCase();
  const td = (hints?.typeDisp ?? "").toUpperCase();
  if (qt === "CRYPTOCURRENCY" || td.includes("CRYPTO")) return "crypto";
  if (qt === "ETF" || td === "ETF") return "etf";
  if (qt === "MUTUALFUND") return "etf"; // treat funds as ETF-ish for UI
  if (qt === "BOND") return "bond";
  if (qt === "CURRENCY") return "cash";

  // Fall back to curated lists.
  if (CRYPTO_TICKERS.has(t)) return "crypto";
  if (ETF_TICKERS.has(t)) return "etf";

  // Unknown short tickers (<= 3 chars with no hyphen / dot) that weren't
  // matched to Yahoo data often turn out to be crypto on SnapTrade. If the
  // Yahoo lookup returned NO sector AND NO name, lean toward crypto.
  if (hints && !hints.quoteType && t.length <= 4 && /^[A-Z]+$/.test(t)) {
    // Conservative: only if there's literally nothing from Yahoo.
    // We return "unknown" and let the caller decide.
    return "unknown";
  }

  return "equity";
}

/**
 * Short label for UI rendering.
 */
export function assetClassLabel(c: AssetClass): string {
  switch (c) {
    case "equity":
      return "Stocks";
    case "etf":
      return "ETFs";
    case "crypto":
      return "Crypto";
    case "bond":
      return "Bonds";
    case "cash":
      return "Cash";
    default:
      return "Unclassified";
  }
}

/**
 * Does the research pipeline's equity-specific tooling (SEC filings,
 * Form 4) apply to this asset class? If false, the analyst prompt should
 * skip those tools and note the limitation.
 */
export function supportsSecTools(c: AssetClass): boolean {
  return c === "equity" || c === "etf";
}
