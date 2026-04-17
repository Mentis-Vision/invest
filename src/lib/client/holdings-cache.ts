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
   * Broker-reported total balance across all linked accounts — includes
   * cash, money-market, settlement balances, etc. Null if the broker
   * didn't report it. The delta between this and totalValue is cash drag.
   */
  brokerageBalance?: number | null;
  balanceCurrency?: string;
  institutions?: string[];
  accountCount?: number;
  message?: string;
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
    institutions: data.institutions,
    accountCount: data.accountCount,
    message: data.message,
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
