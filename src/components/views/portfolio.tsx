"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Link as LinkIcon, RefreshCw, Loader2 } from "lucide-react";
import {
  getHoldings,
  invalidateAndRefresh,
  type Holding as CacheHolding,
} from "@/lib/client/holdings-cache";
import {
  DrillProvider,
  Drillable,
} from "@/components/dashboard/drill-context";
import DrillPanel from "@/components/dashboard/drill-panel";

// Use the shared Holding shape so drill-panel targets type-check.
type Holding = CacheHolding;

type HoldingsResponse = {
  holdings: Holding[];
  connected?: boolean;
  totalValue?: number;
  institutions?: string[];
  accountCount?: number;
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
  return (
    <DrillProvider>
      <PortfolioBody />
      <DrillPanel />
    </DrillProvider>
  );
}

function PortfolioBody() {
  const [loadingToken, setLoadingToken] = useState(false);
  const [loadingHoldings, setLoadingHoldings] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [brokerageBalance, setBrokerageBalance] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfiguredMessage, setNotConfiguredMessage] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollingRef = useRef<number | null>(null);

  const loadHoldings = useCallback(async (force = false) => {
    setLoadingHoldings(true);
    try {
      const data = force ? await invalidateAndRefresh() : await getHoldings();
      if (data.message && !data.connected) {
        setNotConfiguredMessage(data.message);
      }
      setHoldings(data.holdings ?? []);
      setTotalValue(data.totalValue ?? 0);
      setBrokerageBalance(data.brokerageBalance ?? null);
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

  // If a popup is open, poll holdings every 3s and close when linked.
  useEffect(() => {
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, []);

  // Listen for the snaptrade:connection_complete postMessage from our
  // /snaptrade/callback landing page. Lets us refresh holdings the instant
  // the user clicks "Done" in the SnapTrade popup instead of waiting for
  // the 1-second popup-closed poll. Origin-checked to avoid spoofed messages.
  useEffect(() => {
    function onMessage(evt: MessageEvent) {
      if (evt.origin !== window.location.origin) return;
      const data = evt.data as { type?: string } | null;
      if (data?.type !== "snaptrade:connection_complete") return;
      if (popupRef.current && !popupRef.current.closed) {
        try {
          popupRef.current.close();
        } catch {
          /* opener-only close may be blocked; user can close manually */
        }
      }
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      loadHoldings(true);
      fetch("/api/snaptrade/sync", { method: "POST" }).catch(() => {});
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadHoldings]);

  const startLinking = useCallback(async () => {
    setError(null);
    setLoadingToken(true);
    try {
      const res = await fetch("/api/snaptrade/login-url", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "snaptrade_not_configured") {
          setNotConfiguredMessage(data.message);
          return;
        }
        setError(data.message ?? "Could not start brokerage linking.");
        return;
      }

      const url: string = data.loginUrl;
      const w = Math.min(window.innerWidth * 0.9, 720);
      const h = Math.min(window.innerHeight * 0.9, 820);
      const left = window.screenX + (window.innerWidth - w) / 2;
      const top = window.screenY + (window.innerHeight - h) / 2;
      const popup = window.open(
        url,
        "snaptrade-link",
        `width=${w},height=${h},left=${left},top=${top}`
      );
      popupRef.current = popup;

      if (!popup) {
        setError(
          "Pop-up blocked. Enable pop-ups for this site, then try again."
        );
        return;
      }

      // Poll until popup closes, then refresh (bypassing cache).
      pollingRef.current = window.setInterval(async () => {
        if (popup.closed) {
          if (pollingRef.current) window.clearInterval(pollingRef.current);
          pollingRef.current = null;
          await loadHoldings(true);
          // Also trigger a trade sync in the background
          fetch("/api/snaptrade/sync", { method: "POST" }).catch(() => {});
        }
      }, 1000);
    } catch {
      setError("Could not reach our server. Try again in a moment.");
    } finally {
      setLoadingToken(false);
    }
  }, [loadHoldings]);

  const handleRefresh = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch("/api/snaptrade/sync", { method: "POST" }).catch(() => {});
      await loadHoldings(true);
    } finally {
      setSyncing(false);
    }
  }, [loadHoldings]);

  const institutions = holdings.reduce<Record<string, number>>((acc, h) => {
    const bucket = h.institutionName ?? h.accountName ?? "Unclassified";
    acc[bucket] = (acc[bucket] ?? 0) + h.value;
    return acc;
  }, {});

  const sectorBreakdown = holdings.reduce<Record<string, number>>((acc, h) => {
    const bucket = h.sector ?? "Unclassified";
    acc[bucket] = (acc[bucket] ?? 0) + h.value;
    return acc;
  }, {});
  const sectorRows = Object.entries(sectorBreakdown).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
            My Portfolio
          </h2>
          <p className="text-sm text-muted-foreground">
            A detailed look at your current holdings — synced from your brokerage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={syncing}>
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          )}
          <Button size="sm" onClick={startLinking} disabled={loadingToken}>
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
        <Card className="border-[var(--hold)]/30 bg-[var(--hold)]/5">
          <CardContent className="py-4 text-sm text-[var(--muted-foreground)]">
            <span className="font-medium text-[var(--foreground)]">
              Brokerage linking not available.
            </span>{" "}
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
                <div className="text-xs text-muted-foreground">Positions value</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">
                  {money(totalValue)}
                </div>
                {brokerageBalance != null && brokerageBalance > totalValue && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    Cash drag:{" "}
                    <span className="font-mono text-foreground/80">
                      {money(brokerageBalance - totalValue)}
                    </span>
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {brokerageBalance != null
                    ? "Brokerage balance"
                    : "Positions"}
                </div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">
                  {brokerageBalance != null
                    ? money(brokerageBalance)
                    : holdings.length}
                </div>
                {brokerageBalance != null && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    includes cash &amp; settlements
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Institutions</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">
                  {Object.keys(institutions).length}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Largest position</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">
                  {holdings.length > 0 && totalValue > 0
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

      {connected && sectorRows.length > 0 && totalValue > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sector breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sectorRows.map(([sector, value]) => {
                const pct = (value / totalValue) * 100;
                const bucketHoldings = holdings.filter(
                  (h) =>
                    (h.sector ?? "Unclassified") === sector
                );
                return (
                  <Drillable
                    key={sector}
                    target={{
                      kind: "allocation",
                      bucket: sector,
                      holdings: bucketHoldings,
                      totalValue,
                    }}
                    ariaLabel={`Open ${sector} sector detail`}
                    className="!block w-full !hover:no-underline"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span
                          className={
                            sector === "Unclassified"
                              ? "text-muted-foreground"
                              : "text-foreground"
                          }
                        >
                          {sector}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {money(value)} · {pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full ${
                            sector === "Unclassified"
                              ? "bg-muted-foreground/40"
                              : "bg-[var(--buy)]/60"
                          }`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </Drillable>
                );
              })}
            </div>
            <p className="mt-4 text-[11px] text-muted-foreground">
              Sector classification via Yahoo Finance; may be missing for
              non-US or niche tickers.
            </p>
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
                Read-only access — we never move money or place trades.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={startLinking}
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
                      <tr
                        key={`${h.ticker}-${h.accountName}-${i}`}
                        className="border-b last:border-0"
                      >
                        <td className="px-3 py-3 font-mono font-medium">
                          <Drillable
                            target={{ kind: "position", holding: h }}
                            ariaLabel={`Open ${h.ticker} position detail`}
                            className="!p-0"
                          >
                            {h.ticker}
                          </Drillable>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          <Drillable
                            target={{ kind: "ticker", ticker: h.ticker }}
                            ariaLabel={`Open ${h.ticker} warehouse detail`}
                            className="!block !p-0 !hover:no-underline"
                          >
                            <div>{h.name}</div>
                            {h.sector && (
                              <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                                {h.sector}
                                {h.industry ? ` · ${h.industry}` : ""}
                              </div>
                            )}
                          </Drillable>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {h.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(h.price)}</td>
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
        Brokerage data is read-only via SnapTrade. We never initiate trades or
        move money on your behalf. Positions reflect the last sync from your
        institution and may lag real-time.
      </p>
    </div>
  );
}
