"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet, Activity, History, Search, Loader2 } from "lucide-react";
import { getHoldings } from "@/lib/client/holdings-cache";
import type { Holding } from "@/lib/client/holdings-cache";
import AllocationDonut from "@/components/dashboard/allocation-donut";
import RecDistribution from "@/components/dashboard/rec-distribution";
import HitRateGauge from "@/components/dashboard/hit-rate-gauge";
import UpcomingEvaluations from "@/components/dashboard/upcoming-evaluations";
import MacroContext from "@/components/dashboard/macro-context";
import LargestPosition from "@/components/dashboard/largest-position";
import PortfolioSparkline from "@/components/dashboard/portfolio-sparkline";
import AlertFeed from "@/components/dashboard/alert-feed";
import TickerCard, {
  type TickerCardDensity,
} from "@/components/dashboard/ticker-card";

type PortfolioPoint = {
  date: string;
  totalValue: number;
  positionCount: number;
};

type TrackRecord = {
  totals: { total: number; buys: number; sells: number; holds: number };
  outcomes: {
    evaluated: number;
    wins: number;
    losses: number;
    flats: number;
    acted: number;
  };
  portfolioSeries?: PortfolioPoint[];
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

type WarehouseBundle = {
  market: Parameters<typeof TickerCard>[0]["market"];
  sentiment: Parameters<typeof TickerCard>[0]["sentiment"];
  fundamentals: Parameters<typeof TickerCard>[0]["fundamentals"];
};

const MAX_HOLDING_CARDS = 8;

export default function DashboardView() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [connected, setConnected] = useState(false);
  const [track, setTrack] = useState<TrackRecord | null>(null);
  const [macro, setMacro] = useState<Macro | null>(null);
  const [loading, setLoading] = useState(true);
  const [density, setDensity] = useState<TickerCardDensity>("basic");
  const [warehouseByTicker, setWarehouseByTicker] = useState<
    Record<string, WarehouseBundle>
  >({});

  useEffect(() => {
    let alive = true;
    Promise.all([
      getHoldings().catch(() => null),
      fetch("/api/track-record").then((r) => r.json()).catch(() => null),
      fetch("/api/macro").then((r) => r.json()).catch(() => null),
      fetch("/api/user/profile").then((r) => r.json()).catch(() => null),
    ]).then(([pRaw, tRaw, mRaw, profRaw]: [unknown, unknown, unknown, unknown]) => {
      if (!alive) return;
      const p = pRaw as {
        connected?: boolean;
        holdings?: Holding[];
        totalValue?: number;
      } | null;
      const prof = profRaw as
        | { profile?: { preferences?: { density?: TickerCardDensity } } }
        | null;
      setConnected(!!p?.connected);
      setHoldings(p?.holdings ?? []);
      setTotalValue(p?.totalValue ?? 0);
      setTrack(tRaw as TrackRecord | null);
      setMacro((mRaw as { snapshot?: Macro } | null)?.snapshot ?? []);
      const preferred = prof?.profile?.preferences?.density;
      if (
        preferred === "basic" ||
        preferred === "standard" ||
        preferred === "advanced"
      ) {
        setDensity(preferred);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Fetch warehouse-backed per-ticker data for the top N positions so the
  // TickerCard grid has something to render. One call per unique ticker;
  // /api/warehouse/ticker/[ticker] is rate-limited at 120/hr.
  useEffect(() => {
    if (holdings.length === 0) return;
    let alive = true;
    const topTickers = [...new Set(holdings.map((h) => h.ticker))].slice(
      0,
      MAX_HOLDING_CARDS
    );
    Promise.all(
      topTickers.map((t) =>
        fetch(`/api/warehouse/ticker/${encodeURIComponent(t)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    ).then((rows) => {
      if (!alive) return;
      const next: Record<string, WarehouseBundle> = {};
      topTickers.forEach((t, i) => {
        const row = rows[i] as
          | {
              market: WarehouseBundle["market"];
              sentiment: WarehouseBundle["sentiment"];
              fundamentals: WarehouseBundle["fundamentals"];
            }
          | null;
        if (row) {
          next[t.toUpperCase()] = {
            market: row.market,
            sentiment: row.sentiment,
            fundamentals: row.fundamentals,
          };
        }
      });
      setWarehouseByTicker(next);
    });
    return () => {
      alive = false;
    };
  }, [holdings]);

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

      {/* Top KPI strip */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Wallet className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Portfolio Value</p>
              <p className="text-2xl font-semibold tracking-tight">
                {loading
                  ? "…"
                  : connected
                  ? money(totalValue)
                  : "—"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {connected
                  ? `${holdings.length} positions`
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
              <p className="text-sm text-muted-foreground">
                Recommendations (30d)
              </p>
              <p className="text-2xl font-semibold tracking-tight">
                {loading ? "…" : track?.totals.total ?? 0}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {track
                  ? `${track.totals.buys} buy · ${track.totals.holds} hold · ${track.totals.sells} sell`
                  : ""}
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
              <p className="text-sm text-muted-foreground">
                Hit rate (evaluated)
              </p>
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

      {/* Today's macro context */}
      <MacroContext macro={macro} loading={loading} />

      {/* Overnight-changes alert feed — $0 cost, rule-based from free data.
          Only renders when there are undismissed alerts. */}
      <AlertFeed />

      {/* Portfolio value sparkline — data from nightly portfolio_snapshot cron */}
      <PortfolioSparkline
        series={track?.portfolioSeries ?? []}
        loading={loading}
      />

      {/* Portfolio row: allocation donut + largest position */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <AllocationDonut
            holdings={holdings}
            totalValue={totalValue}
            loading={loading}
          />
        </div>
        <LargestPosition
          holdings={holdings}
          totalValue={totalValue}
          loading={loading}
        />
      </div>

      {/* Track-record row: distribution bar + hit-rate gauge */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <RecDistribution
            totals={track?.totals ?? null}
            loading={loading}
          />
        </div>
        <HitRateGauge outcomes={track?.outcomes ?? null} loading={loading} />
      </div>

      {/* Tiered holdings grid — top N positions with warehouse-backed data */}
      {holdings.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold tracking-tight">
              Your holdings
            </h3>
            <span className="text-[11px] text-muted-foreground">
              Density:{" "}
              <Link
                href="/app/settings"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {density}
              </Link>
              {" · "}
              {Math.min(holdings.length, MAX_HOLDING_CARDS)} of {holdings.length}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {holdings.slice(0, MAX_HOLDING_CARDS).map((h) => {
              const bundle = warehouseByTicker[h.ticker.toUpperCase()];
              return (
                <TickerCard
                  key={h.ticker}
                  ticker={h.ticker}
                  market={bundle?.market ?? null}
                  sentiment={bundle?.sentiment ?? null}
                  fundamentals={bundle?.fundamentals ?? null}
                  density={density}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming evaluations */}
      <UpcomingEvaluations />

      {/* Quick-start when empty */}
      {!loading && (!track || track.totals.total === 0) && (
        <Card>
          <CardContent className="py-6 text-center">
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
            {loading && <Loader2 className="mt-2 h-4 w-4 animate-spin" />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
