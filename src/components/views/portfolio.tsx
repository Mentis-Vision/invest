"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Link as LinkIcon, RefreshCw, Loader2 } from "lucide-react";
import { usePlaidLink } from "react-plaid-link";

type Holding = {
  ticker: string;
  name: string;
  shares: number;
  price: number;
  value: number;
  costBasis: number | null;
  institutionName: string | null;
  accountName: string | null;
};

type HoldingsResponse = {
  holdings: Holding[];
  connected?: boolean;
  totalValue?: number;
  institutions?: string[];
  message?: string;
};

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 10000 ? 0 : 2,
  }).format(n);
}

export default function PortfolioView() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [loadingHoldings, setLoadingHoldings] = useState(true);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfiguredMessage, setNotConfiguredMessage] = useState<string | null>(null);

  const loadHoldings = useCallback(async () => {
    setLoadingHoldings(true);
    try {
      const res = await fetch("/api/plaid/holdings");
      const data: HoldingsResponse = await res.json();
      if (data.message && !data.connected) {
        setNotConfiguredMessage(data.message);
      }
      setHoldings(data.holdings ?? []);
      setTotalValue(data.totalValue ?? 0);
      setConnected(!!data.connected);
    } catch {
      setError("Could not load holdings.");
    } finally {
      setLoadingHoldings(false);
    }
  }, []);

  useEffect(() => {
    loadHoldings();
  }, [loadHoldings]);

  const requestLinkToken = useCallback(async () => {
    setError(null);
    setLoadingToken(true);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "plaid_not_configured") {
          setNotConfiguredMessage(data.message);
          return;
        }
        setError(data.message ?? "Could not start brokerage linking.");
        return;
      }
      setLinkToken(data.linkToken);
    } catch {
      setError("Could not reach our server. Try again in a moment.");
    } finally {
      setLoadingToken(false);
    }
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      try {
        const res = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicToken }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.message ?? "Could not link brokerage.");
          return;
        }
        setLinkToken(null);
        await loadHoldings();
        await fetch("/api/plaid/sync", { method: "POST" }).catch(() => {});
      } catch {
        setError("Link failed. Try again.");
      }
    },
    [loadHoldings]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => setLinkToken(null),
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const handleConnect = () => {
    if (linkToken && ready) {
      open();
    } else {
      requestLinkToken();
    }
  };

  const sectors = holdings.reduce<Record<string, number>>((acc, h) => {
    // Without sector data we bucket by ticker's first letter as a placeholder.
    // Full sector rollup requires a holdings.getSector() lookup — deferred.
    const bucket = h.institutionName ?? "Unclassified";
    acc[bucket] = (acc[bucket] ?? 0) + h.value;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">My Portfolio</h2>
          <p className="text-sm text-muted-foreground">
            A detailed look at your current holdings — synced from your brokerage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                fetch("/api/plaid/sync", { method: "POST" }).then(loadHoldings);
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          )}
          <Button size="sm" onClick={handleConnect} disabled={loadingToken}>
            {loadingToken ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LinkIcon className="mr-2 h-4 w-4" />
            )}
            {connected ? "Link another account" : "Connect Brokerage"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {notConfiguredMessage && !connected && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Coming soon.</span>{" "}
            {notConfiguredMessage}
          </CardContent>
        </Card>
      )}

      {connected && holdings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Total value</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">
                  {money(totalValue)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Positions</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">
                  {holdings.length}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Institutions</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">
                  {Object.keys(sectors).length}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Largest position</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">
                  {holdings.length > 0
                    ? `${Math.round(
                        (Math.max(...holdings.map((h) => h.value)) / totalValue) * 100
                      )}%`
                    : "—"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holdings</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingHoldings ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading your positions…
            </div>
          ) : holdings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Plus className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-medium">No holdings yet</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Connect your brokerage account to sync your portfolio automatically.
                We only request read-only access.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={handleConnect}
                disabled={loadingToken}
              >
                {loadingToken && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Connect Brokerage
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-3 py-2 font-medium">Ticker</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 text-right font-medium">Shares</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-right font-medium">Value</th>
                    <th className="px-3 py-2 font-medium">Account</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings
                    .slice()
                    .sort((a, b) => b.value - a.value)
                    .map((h, i) => (
                      <tr key={`${h.ticker}-${h.accountName}-${i}`} className="border-b last:border-0">
                        <td className="px-3 py-3 font-mono font-medium">{h.ticker}</td>
                        <td className="px-3 py-3 text-muted-foreground">{h.name}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {h.shares.toLocaleString("en-US", {
                            maximumFractionDigits: 4,
                          })}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {money(h.price)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-medium">
                          {money(h.value)}
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">
                          {h.institutionName ? (
                            <Badge variant="outline" className="font-normal">
                              {h.institutionName}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Brokerage data is read-only. We never initiate trades or move money on
        your behalf. Positions reflect the last sync from your institution and
        may lag real-time.
      </p>
    </div>
  );
}
