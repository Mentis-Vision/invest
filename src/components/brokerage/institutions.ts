/**
 * Institution routing table.
 *
 * Maps user-facing institution names to the correct provider behind the
 * scenes. Users never see "Plaid" or "SnapTrade" — they search for
 * their broker, and we route.
 *
 * Routing rule (set per-row in `provider`):
 *   - "plaid"     → launch Plaid Link (preferred where available)
 *   - "snaptrade" → launch SnapTrade flow (fallback for crypto + alt
 *                   brokers Plaid doesn't cover)
 *
 * Keep this list narrow to the institutions we've actually verified
 * against each provider. For any broker not in this table, users fall
 * back to either provider's own search inside the flow they launched.
 *
 * VERIFICATION STATUS (2026-04-21): categorizations are based on
 * Plaid's published Investments institution coverage and SnapTrade's
 * published integrations. Before treating this as authoritative,
 * spot-check at least one institution per provider in their live
 * institution search.
 */

export type Provider = "plaid" | "snaptrade";

export type Institution = {
  /** Stable ID, lowercase, no spaces. Used as React key + analytics tag. */
  id: string;
  /** User-facing display name. Capitalization exactly as the broker uses. */
  name: string;
  /** Extra search terms — abbreviations, former names, common misspellings. */
  aliases?: string[];
  /** Which provider handles this institution. */
  provider: Provider;
  /** Show as a chip at the top of the picker. ~6-8 flagged. */
  popular?: boolean;
  /** Classification tag shown next to name. "broker" | "crypto" | "robo". */
  kind: "broker" | "crypto" | "robo";
};

export const INSTITUTIONS: Institution[] = [
  // ─── Major traditional brokers (Plaid) ─────────────────────────────
  {
    id: "schwab",
    name: "Charles Schwab",
    aliases: ["schwab", "td ameritrade", "tda", "schwab one", "schwab intelligent"],
    provider: "plaid",
    popular: true,
    kind: "broker",
  },
  {
    id: "fidelity",
    name: "Fidelity",
    aliases: ["fidelity investments", "fidelity netbenefits"],
    provider: "plaid",
    popular: true,
    kind: "broker",
  },
  {
    id: "vanguard",
    name: "Vanguard",
    aliases: ["vanguard brokerage", "vanguard personal advisor"],
    provider: "plaid",
    popular: true,
    kind: "broker",
  },
  {
    id: "etrade",
    name: "E*TRADE",
    aliases: ["etrade", "e-trade", "morgan stanley etrade"],
    provider: "plaid",
    kind: "broker",
  },
  {
    id: "merrill",
    name: "Merrill Edge",
    aliases: ["merrill", "merrill lynch", "bank of america merrill"],
    provider: "plaid",
    kind: "broker",
  },
  {
    id: "ally",
    name: "Ally Invest",
    aliases: ["ally", "ally financial"],
    provider: "plaid",
    kind: "broker",
  },
  {
    id: "chase",
    name: "Chase Self-Directed Investing",
    aliases: ["chase", "jp morgan", "j.p. morgan", "you invest", "jpmorgan chase"],
    provider: "plaid",
    kind: "broker",
  },
  {
    id: "wellsfargo",
    name: "Wells Fargo WellsTrade",
    aliases: ["wells fargo", "wellstrade"],
    provider: "plaid",
    kind: "broker",
  },
  {
    id: "morganstanley",
    name: "Morgan Stanley",
    aliases: ["morgan stanley wealth", "ms wealth"],
    provider: "plaid",
    kind: "broker",
  },
  {
    id: "ibkr",
    name: "Interactive Brokers",
    aliases: ["ibkr", "ib", "ibkr lite", "ibkr pro"],
    provider: "plaid",
    kind: "broker",
  },
  {
    id: "firstrade",
    name: "Firstrade",
    provider: "plaid",
    kind: "broker",
  },
  {
    id: "tradestation",
    name: "TradeStation",
    provider: "plaid",
    kind: "broker",
  },

  // ─── Modern / app-based brokers (Plaid) ────────────────────────────
  {
    id: "robinhood",
    name: "Robinhood",
    aliases: ["robinhood markets"],
    provider: "plaid",
    popular: true,
    kind: "broker",
  },
  {
    id: "sofi",
    name: "SoFi Invest",
    aliases: ["sofi", "sofi active invest", "sofi automated"],
    provider: "plaid",
    kind: "broker",
  },
  {
    id: "webull",
    name: "Webull",
    provider: "plaid",
    popular: true,
    kind: "broker",
  },
  {
    id: "public",
    name: "Public.com",
    aliases: ["public"],
    provider: "plaid",
    kind: "broker",
  },
  {
    id: "tastytrade",
    name: "tastytrade",
    aliases: ["tastyworks", "tasty"],
    provider: "plaid",
    kind: "broker",
  },
  {
    id: "stash",
    name: "Stash",
    provider: "plaid",
    kind: "broker",
  },

  // ─── Robo-advisors (Plaid) ─────────────────────────────────────────
  {
    id: "wealthfront",
    name: "Wealthfront",
    provider: "plaid",
    kind: "robo",
  },
  {
    id: "betterment",
    name: "Betterment",
    provider: "plaid",
    kind: "robo",
  },
  {
    id: "acorns",
    name: "Acorns",
    provider: "plaid",
    kind: "robo",
  },
  {
    id: "m1",
    name: "M1 Finance",
    aliases: ["m1"],
    provider: "plaid",
    kind: "robo",
  },

  // ─── Crypto exchanges (SnapTrade) ──────────────────────────────────
  {
    id: "coinbase",
    name: "Coinbase",
    aliases: ["coinbase pro", "coinbase prime"],
    provider: "snaptrade",
    popular: true,
    kind: "crypto",
  },
  {
    id: "kraken",
    name: "Kraken",
    provider: "snaptrade",
    kind: "crypto",
  },
  {
    id: "gemini",
    name: "Gemini",
    aliases: ["gemini active trader"],
    provider: "snaptrade",
    kind: "crypto",
  },
  {
    id: "binanceus",
    name: "Binance.US",
    aliases: ["binance", "binance us"],
    provider: "snaptrade",
    kind: "crypto",
  },
  {
    id: "cryptocom",
    name: "Crypto.com",
    aliases: ["crypto com"],
    provider: "snaptrade",
    kind: "crypto",
  },

  // ─── International / alternate brokers (SnapTrade) ─────────────────
  {
    id: "questrade",
    name: "Questrade",
    aliases: ["questrade canada"],
    provider: "snaptrade",
    kind: "broker",
  },
  {
    id: "wealthsimple",
    name: "Wealthsimple",
    aliases: ["wealthsimple trade", "wealthsimple canada"],
    provider: "snaptrade",
    kind: "broker",
  },
  {
    id: "alpaca",
    name: "Alpaca",
    provider: "snaptrade",
    kind: "broker",
  },
  {
    id: "etoro",
    name: "eToro",
    provider: "snaptrade",
    kind: "broker",
  },
  {
    id: "moomoo",
    name: "Moomoo",
    aliases: ["futu", "moomoo financial"],
    provider: "snaptrade",
    kind: "broker",
  },
];

/**
 * Filter institutions by a free-text query. Case-insensitive. Matches
 * against name and aliases. Prefix matches rank higher than substring
 * matches.
 */
export function searchInstitutions(query: string): Institution[] {
  const q = query.trim().toLowerCase();
  if (!q) return INSTITUTIONS;

  const scored: Array<{ inst: Institution; score: number }> = [];
  for (const inst of INSTITUTIONS) {
    const name = inst.name.toLowerCase();
    const aliases = inst.aliases?.map((a) => a.toLowerCase()) ?? [];
    let score = 0;

    if (name.startsWith(q)) score = 100;
    else if (aliases.some((a) => a.startsWith(q))) score = 90;
    else if (name.includes(q)) score = 50;
    else if (aliases.some((a) => a.includes(q))) score = 40;

    if (score > 0) {
      if (inst.popular) score += 5;
      scored.push({ inst, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.inst.name.localeCompare(b.inst.name))
    .map((s) => s.inst);
}

export const POPULAR_INSTITUTIONS = INSTITUTIONS.filter((i) => i.popular);

export const ALL_INSTITUTIONS_ALPHA = [...INSTITUTIONS].sort((a, b) =>
  a.name.localeCompare(b.name)
);
