"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Wallet,
  History,
  Search,
  Loader2,
  Minus,
} from "lucide-react";

type Portfolio = {
  connected: boolean;
  holdingsCount: number;
  totalValue: number;
};

type TrackRecord = {
  totals: { total: number; buys: number; sells: number; holds: number };
  outcomes: { evaluated: number; wins: number; losses: number; flats: number; acted: number };
};

type Macro = Array<{
  indicator: string;
  value: string;
  date: string;
  deltaLabel?: string;
}>;

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 10000 ? 0 : 2,
  }).format(n);
}

export default function DashboardView() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [track, setTrack] = useState<TrackRecord | null>(null);
  const [macro, setMacro] = useState<Macro | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/snaptrade/holdings").then((r) => r.json()).catch(() => null),
      fetch("/api/track-record").then((r) => r.json()).catch(() => null),
      fetch("/api/macro").then((r) => r.json()).catch(() => null),
    ]).then(([pRaw, tRaw, mRaw]: [unknown, unknown, unknown]) => {
      if (!alive) return;
      const p = pRaw as {
        connected?: boolean;
        holdings?: unknown[];
        totalValue?: number;
      } | null;
      setPortfolio({
        connected: !!p?.connected,
        holdingsCount: p?.holdings?.length ?? 0,
        totalValue: p?.totalValue ?? 0,
      });
      setTrack(tRaw as TrackRecord | null);
      setMacro((mRaw as { snapshot?: Macro } | null)?.snapshot ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const hitRate =
    track && track.outcomes.evaluated > 0
      ? Math.round((track.outcomes.wins / track.outcomes.evaluated) * 100)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Overview</h2>
        <p className="text-sm text-muted-foreground">
          Your research-desk home. Every call we&rsquo;ve made, every dollar
          tracked.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Wallet className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Portfolio Value</p>
              <p className="text-2xl font-semibold tracking-tight">
                {loading ? "…" : portfolio?.connected ? money(portfolio.totalValue) : "—"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {portfolio?.connected
                  ? `${portfolio.holdingsCount} positions`
                  : "No brokerage linked"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Activity className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Recommendations (30d)</p>
              <p className="text-2xl font-semibold tracking-tight">
                {loading ? "…" : track?.totals.total ?? 0}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {track ? `${track.totals.buys} buy · ${track.totals.holds} hold · ${track.totals.sells} sell` : ""}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <History className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Hit rate (evaluated)</p>
              <p className="text-2xl font-semibold tracking-tight">
                {loading ? "…" : hitRate !== null ? `${hitRate}%` : "—"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {track && track.outcomes.evaluated > 0
                  ? `${track.outcomes.evaluated} outcomes tracked`
                  : "No outcomes yet"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent track record</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading track record…
              </div>
            ) : !track || track.totals.total === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No recommendations yet. Run your first research query to start
                  building a track record.
                </p>
                <Link
                  href="/app?view=research"
                  className="mt-4 inline-flex items-center rounded-md bg-[var(--buy)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition hover:opacity-90"
                >
                  <Search className="mr-2 h-4 w-4" />
                  Start research
                </Link>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-3 text-center">
                  <MiniStat label="Wins" value={track.outcomes.wins} tone="buy" />
                  <MiniStat label="Flats" value={track.outcomes.flats} tone="muted" />
                  <MiniStat label="Losses" value={track.outcomes.losses} tone="sell" />
                  <MiniStat label="You acted" value={track.outcomes.acted} tone="muted" />
                </div>
                <p className="mt-4 text-[11px] text-muted-foreground">
                  Past recommendation outcomes are informational only. Not a
                  guarantee of future performance. Not investment advice.
                </p>
                <div className="mt-4 flex gap-2">
                  <Link
                    href="/app/history"
                    className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-accent/50"
                  >
                    Full history
                  </Link>
                  {track.outcomes.losses > 0 && (
                    <Link
                      href="/app/history?filter=losses"
                      className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-accent/50"
                    >
                      The misses
                    </Link>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Macro snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : !macro || macro.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Macro data unavailable.
              </p>
            ) : (
              macro.slice(0, 6).map((m) => (
                <div key={m.indicator} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{m.indicator}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{m.value}</span>
                    {m.deltaLabel && <DeltaBadge delta={m.deltaLabel} />}
                  </div>
                </div>
              ))
            )}
            <p className="pt-2 text-[10px] text-muted-foreground">
              Source: FRED (Federal Reserve Economic Data). 12-month deltas.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "buy" | "sell" | "muted";
}) {
  const color =
    tone === "buy"
      ? "text-[var(--buy)]"
      : tone === "sell"
      ? "text-[var(--sell)]"
      : "text-foreground";
  return (
    <div>
      <div className={`text-2xl font-semibold tracking-tight ${color}`}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: string }) {
  const isPositive = delta.startsWith("+");
  const isNegative = delta.startsWith("-");
  const variant = isPositive ? "default" : isNegative ? "destructive" : "secondary";
  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  return (
    <Badge variant={variant} className="text-[10px] font-mono">
      <Icon className="mr-0.5 h-2.5 w-2.5" />
      {delta}
    </Badge>
  );
}
