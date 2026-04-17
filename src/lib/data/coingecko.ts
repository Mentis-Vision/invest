import { log, errorInfo } from "../log";

/**
 * CoinGecko — tertiary crypto data source.
 *
 * Why we use it (after Alpha Vantage):
 *   AV's coin universe is conservative. Newer / smaller-cap tokens
 *   (SPK / Spark, HYPE / Hyperliquid, etc.) return "Invalid API call"
 *   and our warehouse leaves them empty — the drill panel then falls
 *   through to Yahoo's broken naked-symbol resolution. CoinGecko's
 *   coverage is much wider, and the basic /simple/price endpoint is
 *   free + key-less.
 *
 * Rate limits (free tier, no key):
 *   - 10–50 calls/min depending on time of day; we use Vercel's fetch
 *     cache aggressively to amortize.
 *   - Demo PRO tier (with COINGECKO_API_KEY) is 500 calls/min.
 *
 * Conventions:
 *   - CoinGecko keys coins by `id` (e.g. "bitcoin"), not symbol ("BTC").
 *     We maintain a hand-curated SYMBOL→ID map for the common cryptos
 *     a retail-investor portfolio might hold; unknown symbols return
 *     null (caller decides).
 *   - All public functions return null on failure so the caller can
 *     degrade gracefully.
 */

const BASE = "https://api.coingecko.com/api/v3";
const PRO_BASE = "https://pro-api.coingecko.com/api/v3";

function key(): string | null {
  return process.env.COINGECKO_API_KEY ?? null;
}

function baseUrl(): string {
  return key() ? PRO_BASE : BASE;
}

/**
 * Symbol → CoinGecko coin ID map. Hand-curated for the cryptos most
 * likely to appear in retail portfolios (top ~60 by market cap + the
 * holdings we've already seen in production). Unknown symbols return
 * null from the spot lookup.
 *
 * To add a new symbol: visit https://www.coingecko.com/en/coins/<name>,
 * the URL slug is the id. Or call /coins/list once and grep.
 */
const SYMBOL_TO_ID: Record<string, string> = {
  // Top cap
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  USDC: "usd-coin",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  TRX: "tron",
  AVAX: "avalanche-2",
  TON: "the-open-network",
  LINK: "chainlink",
  MATIC: "matic-network",
  DOT: "polkadot",
  NEAR: "near",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  ATOM: "cosmos",
  ETC: "ethereum-classic",
  XLM: "stellar",
  XMR: "monero",
  ICP: "internet-computer",
  FIL: "filecoin",
  HBAR: "hedera-hashgraph",
  CRO: "crypto-com-chain",
  // L2s + scaling
  ARB: "arbitrum",
  OP: "optimism",
  STRK: "starknet",
  IMX: "immutable-x",
  // DeFi
  UNI: "uniswap",
  AAVE: "aave",
  MKR: "maker",
  SNX: "havven",
  COMP: "compound-governance-token",
  CRV: "curve-dao-token",
  LDO: "lido-dao",
  GMX: "gmx",
  PENDLE: "pendle",
  // 2024-2025 wave
  SUI: "sui",
  TIA: "celestia",
  APT: "aptos",
  SEI: "sei-network",
  INJ: "injective-protocol",
  JUP: "jupiter-exchange-solana",
  WIF: "dogwifcoin",
  PEPE: "pepe",
  BONK: "bonk",
  ONDO: "ondo-finance",
  ENA: "ethena",
  HYPE: "hyperliquid",
  FET: "fetch-ai",
  RENDER: "render-token",
  RNDR: "render-token",
  WLD: "worldcoin-wld",
  TAO: "bittensor",
  // 2026 wave / less common but seen in real portfolios
  SPK: "spark",
  KAS: "kaspa",
  TRUMP: "official-trump",
};

export function coingeckoConfigured(): boolean {
  return true; // free tier needs no key
}

/**
 * Look up the CoinGecko coin ID for a symbol. Case-insensitive. Returns
 * null when we don't have a mapping — the caller skips the call rather
 * than burn a request guessing at IDs.
 */
export function symbolToCoinGeckoId(symbol: string): string | null {
  return SYMBOL_TO_ID[symbol.toUpperCase()] ?? null;
}

export type CGSpot = {
  symbol: string;
  id: string;
  price: number;
  change24hPct: number | null;
  marketCap: number | null;
  volume24h: number | null;
  lastUpdated: string | null;
};

/**
 * GET /simple/price for one coin in USD. Single round-trip, JSON
 * response < 1 KB. Uses Vercel's fetch cache (5 min revalidate) to
 * stay under CoinGecko's per-minute cap on heavy nights.
 */
export async function getCryptoSpotCoinGecko(
  symbol: string
): Promise<CGSpot | null> {
  const id = symbolToCoinGeckoId(symbol);
  if (!id) return null;
  const url = new URL(`${baseUrl()}/simple/price`);
  url.searchParams.set("ids", id);
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");
  url.searchParams.set("include_market_cap", "true");
  url.searchParams.set("include_24hr_vol", "true");
  url.searchParams.set("include_last_updated_at", "true");
  const k = key();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (k) headers["x-cg-pro-api-key"] = k;
  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 300 },
      headers,
    });
    if (!res.ok) {
      log.warn("coingecko", "non-2xx", {
        symbol,
        id,
        status: res.status,
      });
      return null;
    }
    const data = (await res.json()) as Record<
      string,
      | {
          usd?: number;
          usd_24h_change?: number;
          usd_market_cap?: number;
          usd_24h_vol?: number;
          last_updated_at?: number;
        }
      | undefined
    >;
    const row = data[id];
    if (!row || typeof row.usd !== "number" || row.usd <= 0) return null;
    return {
      symbol: symbol.toUpperCase(),
      id,
      price: row.usd,
      change24hPct: typeof row.usd_24h_change === "number" ? row.usd_24h_change : null,
      marketCap: typeof row.usd_market_cap === "number" ? row.usd_market_cap : null,
      volume24h: typeof row.usd_24h_vol === "number" ? row.usd_24h_vol : null,
      lastUpdated:
        typeof row.last_updated_at === "number"
          ? new Date(row.last_updated_at * 1000).toISOString()
          : null,
    };
  } catch (err) {
    log.warn("coingecko", "fetch failed", { symbol, ...errorInfo(err) });
    return null;
  }
}
