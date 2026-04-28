/**
 * In-tab holdings cache.
 *
 * Dashboard + Portfolio both fetch /api/snaptrade/holdings on mount.
 * Before this module they duplicated the call on every navigation. Now
 * they share a module-level promise with a 60-second TTL.
 *
 * Contract:
 *   - getHoldings()           → cached fetch (60s TTL)
 *   - refreshHoldings()       → bypass cache, refetch, update subscribers
 *   - subscribe(cb)           → called with every new value (incl. initial)
 *
 * This is intentionally NOT a React Context or SWR — it's a vanilla
 * module singleton keyed to the tab's lifetime. That's the right fit for
 * a single-user dashboard where the server session is the source of
 * truth anyway.
 */

export type Holding = {
  ticker: string;
  name: string;
  shares: number;
  price: number;
  value: number;
  costBasis: number | null;
  institutionName: string | null;
  accountName: string | null;
  sector: string | null;
  industry: string | null;
  assetClass?: string;
};

export type HoldingsSnapshot = {
  connected: boolean;
  holdings: Holding[];
  /** Sum of market value (shares × price) across all positions. */
  totalValue: number;
  /**
   * Today's $ change across the portfolio, computed per-holding from
   * each position's intraday price move (NOT from a portfolio-total
   * snapshot diff — that approach mis-attributes a newly linked
   * account's full balance as a same-day gain). Null if no holding
   * had a usable quote (cash-only portfolio or every fetch failed).
   */
  dayChangeDollar?: number | null;
  /**
   * Today's % change across the covered (quote-having) portion of the
   * portfolio. Denominator is yesterday's close of those holdings, so
   * the percentage stays meaningful when accounts get added or
   * removed mid-session.
   */
  dayChangePct?: number | null;
  /**
   * Broker-reported total balance across all linked accounts — includes
   * cash, money-market, settlement balances, etc. Null if the broker
   * didn't report it. The delta between this and totalValue is cash drag.
   */
  brokerageBalance?: number | null;
  balanceCurrency?: string;
  institutions?: string[];
  accountCount?: number;
  message?: string;
  /**
   * ISO timestamp of the most recent successful sync from any linked
   * brokerage. The client renders this as "Updated X ago" so users can
   * judge how fresh the portfolio numbers are before acting on them.
   * Null when no sync has ever completed (first-time linking).
   */
  lastSyncedAt?: string | null;
};

const TTL_MS = 60_000;

type CacheEntry = {
  at: number;
  promise: Promise<HoldingsSnapshot>;
};

let current: CacheEntry | null = null;
const listeners = new Set<(s: HoldingsSnapshot) => void>();

async function fetchHoldings(): Promise<HoldingsSnapshot> {
  const res = await fetch("/api/snaptrade/holdings");
  if (!res.ok) {
    return {
      connected: false,
      holdings: [],
      totalValue: 0,
      message: `Request failed (${res.status})`,
    };
  }
  const data = (await res.json()) as Partial<HoldingsSnapshot>;
  const snap: HoldingsSnapshot = {
    connected: !!data.connected,
    holdings: data.holdings ?? [],
    totalValue: data.totalValue ?? 0,
    dayChangeDollar: data.dayChangeDollar ?? null,
    dayChangePct: data.dayChangePct ?? null,
    brokerageBalance: data.brokerageBalance,
    balanceCurrency: data.balanceCurrency,
    institutions: data.institutions,
    accountCount: data.accountCount,
    message: data.message,
    lastSyncedAt: data.lastSyncedAt ?? null,
  };
  for (const cb of listeners) cb(snap);
  return snap;
}

export function getHoldings(): Promise<HoldingsSnapshot> {
  const now = Date.now();
  if (current && now - current.at < TTL_MS) {
    return current.promise;
  }
  const promise = fetchHoldings();
  current = { at: now, promise };
  return promise;
}

export async function refreshHoldings(): Promise<HoldingsSnapshot> {
  const promise = fetchHoldings();
  current = { at: Date.now(), promise };
  return promise;
}

export function subscribe(cb: (s: HoldingsSnapshot) => void): () => void {
  listeners.add(cb);
  // Fire once with the latest known value if we have one.
  if (current) {
    current.promise.then(cb).catch(() => {});
  }
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Invalidate on successful SnapTrade sync so the next fetch is fresh.
 * Returns the refetched snapshot.
 */
export async function invalidateAndRefresh(): Promise<HoldingsSnapshot> {
  current = null;
  return refreshHoldings();
}
