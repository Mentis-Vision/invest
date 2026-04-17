"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Search } from "lucide-react";
import { getHoldings } from "@/lib/client/holdings-cache";
import type { Holding } from "@/lib/client/holdings-cache";

// Existing widgets (kept — each is a clean cardless-or-carded unit)
import AllocationDonut from "@/components/dashboard/allocation-donut";
import RecDistribution from "@/components/dashboard/rec-distribution";
import HitRateGauge from "@/components/dashboard/hit-rate-gauge";
import UpcomingEvaluations from "@/components/dashboard/upcoming-evaluations";
import AlertFeed from "@/components/dashboard/alert-feed";
import TickerCard, {
  type TickerCardDensity,
} from "@/components/dashboard/ticker-card";

// New editorial-terminal composition layer
import PortfolioHero from "@/components/dashboard/portfolio-hero";
import KpiStrip from "@/components/dashboard/kpi-strip";
import AllocationTable from "@/components/dashboard/allocation-table";
import MacroStrip from "@/components/dashboard/macro-strip";
import { DrillProvider, Drillable } from "@/components/dashboard/drill-context";
import DrillPanel from "@/components/dashboard/drill-panel";

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

type WarehouseBundle = {
  market: Parameters<typeof TickerCard>[0]["market"];
  sentiment: Parameters<typeof TickerCard>[0]["sentiment"];
  fundamentals: Parameters<typeof TickerCard>[0]["fundamentals"];
};

const MAX_HOLDING_CARDS = 8;

/**
 * Editorial-terminal dashboard.
 *
 * Structure (top-to-bottom):
 *   1. Portfolio hero — oversized Fraunces total + timeframe sparkline
 *   2. KPI strip — 5 compact drillable tiles
 *   3. Overnight alerts (only when present)
 *   4. Allocation: donut (2/3) + table (1/3) — both drill to allocation panel
 *   5. Track record: distribution bar (2/3) + hit-rate gauge (1/3)
 *   6. Holdings grid — tiered TickerCards with drill-to-position underneath
 *   7. Upcoming evaluations
 *   8. Macro context strip
 *
 * Every clickable data point opens the right-side slide-over DrillPanel
 * via the shared DrillProvider context.
 */
export default function DashboardView({
  userName,
}: {
  userName?: string;
}) {
  return (
    <DrillProvider>
      <DashboardBody userName={userName ?? "there"} />
      <DrillPanel />
    </DrillProvider>
  );
}

function DashboardBody({ userName }: { userName: string }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [connected, setConnected] = useState(false);
  const [institutions, setInstitutions] = useState<string[]>([]);
  const [accountCount, setAccountCount] = useState<number>(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [track, setTrack] = useState<TrackRecord | null>(null);
  const [macro, setMacro] = useState<Macro>([]);
  const [activeAlerts, setActiveAlerts] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [density, setDensity] = useState<TickerCardDensity>("basic");
  const [warehouseByTicker, setWarehouseByTicker] = useState<
    Record<string, WarehouseBundle>
  >({});

  useEffect(() => {
    let alive = true;
    Promise.all([
      getHoldings().catch(() => null),
      fetch("/api/track-record")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/macro")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/user/profile")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/alerts")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(
      ([pRaw, tRaw, mRaw, profRaw, aRaw]: [
        unknown,
        unknown,
        unknown,
        unknown,
        unknown,
      ]) => {
        if (!alive) return;
        const p = pRaw as
          | {
              connected?: boolean;
              holdings?: Holding[];
              totalValue?: number;
              institutions?: string[];
              accountCount?: number;
              lastSyncedAt?: string;
            }
          | null;
        const prof = profRaw as
          | { profile?: { preferences?: { density?: TickerCardDensity } } }
          | null;
        const alerts = aRaw as
          | { items?: Array<{ seen: boolean }> }
          | null;
        setConnected(!!p?.connected);
        setHoldings(p?.holdings ?? []);
        setTotalValue(p?.totalValue ?? 0);
        setInstitutions(p?.institutions ?? []);
        setAccountCount(p?.accountCount ?? 0);
        setLastSyncedAt(p?.lastSyncedAt ?? null);
        setTrack(tRaw as TrackRecord | null);
        setMacro(((mRaw as { snapshot?: Macro } | null)?.snapshot ?? []) as Macro);
        setActiveAlerts(
          Array.isArray(alerts?.items) ? alerts.items.length : 0
        );
        const preferred = prof?.profile?.preferences?.density;
        if (
          preferred === "basic" ||
          preferred === "standard" ||
          preferred === "advanced"
        ) {
          setDensity(preferred);
        }
        setLoading(false);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  // Re-fetch the user profile's density preference whenever the tab
  // regains focus. Handles the common flow: user opens Settings in a
  // new tab, changes density, comes back to the dashboard — without
  // this effect the old density stays until a full page reload.
  useEffect(() => {
    function onFocus() {
      fetch("/api/user/profile")
        .then((r) => (r.ok ? r.json() : null))
        .then((prof) => {
          const pref = prof?.profile?.preferences?.density;
          if (
            pref === "basic" ||
            pref === "standard" ||
            pref === "advanced"
          ) {
            setDensity(pref);
          }
        })
        .catch(() => {});
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Warehouse detail for the top N holdings — drives TickerCards + the
  // aggregate day-change computation below.
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

  // Value-weighted aggregate day change. Only uses tickers where the
  // warehouse knows today's change percent; others are ignored, and the
  // denominator shrinks accordingly so the result stays representative.
  const dayChangePct = useMemo(() => {
    if (holdings.length === 0) return null;
    let weighted = 0;
    let coveredValue = 0;
    for (const h of holdings) {
      const w = warehouseByTicker[h.ticker.toUpperCase()];
      const delta = w?.market?.changePct;
      if (delta == null) continue;
      const v = effectiveValue(h);
      weighted += (delta / 100) * v;
      coveredValue += v;
    }
    if (coveredValue === 0) return null;
    return ((weighted / coveredValue) * 100);
  }, [holdings, warehouseByTicker]);

  const hitRatePct =
    track && track.outcomes.evaluated > 0
      ? (track.outcomes.wins / track.outcomes.evaluated) * 100
      : null;

  const hasTrackRecord = Boolean(track && track.totals.total > 0);

  return (
    <div className="space-y-6">
      <PortfolioHero
        userName={userName}
        totalValue={totalValue}
        holdings={holdings}
        connected={connected}
        series={track?.portfolioSeries ?? []}
        dayChangePct={dayChangePct}
        loading={loading}
        lastSyncedAt={lastSyncedAt}
        accountCount={accountCount}
        institutions={institutions}
      />

      <KpiStrip
        totalValue={totalValue}
        holdings={holdings}
        dayChangePct={dayChangePct}
        hitRatePct={hitRatePct}
        activeAlerts={activeAlerts}
        loading={loading}
      />

      {/* Overnight-changes alert feed — only renders when there are alerts. */}
      <AlertFeed />

      {/* Connected but zero holdings — guide them to link or retry sync. */}
      {!loading && connected && holdings.length === 0 && (
        <Card className="border-[var(--hold)]/30 bg-[var(--hold)]/5">
          <CardContent className="py-5 text-center">
            <p className="text-base font-medium text-[var(--foreground)]">
              Connected, but no positions are showing yet.
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              If you just linked your brokerage, positions usually sync
              within a minute. Otherwise, go to{" "}
              <Link
                href="/app?view=portfolio"
                className="underline underline-offset-4 hover:text-[var(--foreground)]"
              >
                Portfolio → Refresh
              </Link>
              {" "}or link another account.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Allocation: donut + breakdown table. Both feed the same drill panel. */}
      {holdings.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AllocationDonut
              holdings={holdings}
              totalValue={totalValue}
              loading={loading}
            />
          </div>
          <AllocationTable
            holdings={holdings}
            totalValue={totalValue}
            loading={loading}
          />
        </div>
      )}

      {/* Track record */}
      {hasTrackRecord && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecDistribution totals={track?.totals ?? null} loading={loading} />
          </div>
          <HitRateGauge outcomes={track?.outcomes ?? null} loading={loading} />
        </div>
      )}

      {/* Holdings — tiered TickerCards, each with drill-to-position link */}
      {holdings.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-2">
            <h3 className="text-xl font-semibold tracking-tight">
              Holdings
              <span className="ml-3 text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)] font-sans font-normal">
                at a glance
              </span>
            </h3>
            <span className="text-[11px] text-[var(--muted-foreground)]">
              density{" "}
              <Link
                href="/app/settings"
                className="underline underline-offset-4 hover:text-[var(--foreground)]"
              >
                {density}
              </Link>
              <span className="mx-1.5 opacity-40">·</span>
              <span className="font-mono tabular-nums">
                {Math.min(holdings.length, MAX_HOLDING_CARDS)}
              </span>{" "}
              of{" "}
              <span className="font-mono tabular-nums">{holdings.length}</span>
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {holdings.slice(0, MAX_HOLDING_CARDS).map((h) => {
              const bundle = warehouseByTicker[h.ticker.toUpperCase()];
              return (
                <div key={h.ticker} className="flex flex-col gap-1.5">
                  <TickerCard
                    ticker={h.ticker}
                    market={bundle?.market ?? null}
                    sentiment={bundle?.sentiment ?? null}
                    fundamentals={bundle?.fundamentals ?? null}
                    density={density}
                  />
                  <div className="flex items-center justify-between px-1 text-[10px] text-[var(--muted-foreground)]">
                    <Drillable
                      target={{ kind: "position", holding: h }}
                      ariaLabel={`Open your ${h.ticker} position`}
                      className="!text-[10px]"
                    >
                      Your position
                    </Drillable>
                    <Drillable
                      target={{ kind: "ticker", ticker: h.ticker }}
                      ariaLabel={`Open warehouse detail for ${h.ticker}`}
                      className="!text-[10px]"
                    >
                      Warehouse detail
                    </Drillable>
                  </div>
                </div>
              );
            })}
          </div>
          {holdings.length > MAX_HOLDING_CARDS && (
            <div className="pt-1 text-right">
              <Link
                href="/app?view=portfolio"
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline underline-offset-4"
              >
                View all {holdings.length} positions →
              </Link>
            </div>
          )}
        </section>
      )}

      {/* Upcoming evaluations */}
      <UpcomingEvaluations />

      {/* Macro — compact strip */}
      <MacroStrip snapshot={macro} loading={loading} />

      {/* Empty-state CTA when no track record yet */}
      {!loading && !hasTrackRecord && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-lg font-medium text-[var(--foreground)]">
              Your research desk is empty.
            </p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Run your first research query to start building a track record.
            </p>
            <Link
              href="/app?view=research"
              className="mt-4 inline-flex items-center rounded-md bg-[var(--buy)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition hover:opacity-90"
            >
              <Search className="mr-2 h-4 w-4" />
              Start research
            </Link>
          </CardContent>
        </Card>
      )}

      {loading && !connected && (
        <div className="flex justify-center py-6 text-xs text-[var(--muted-foreground)]">
          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          loading…
        </div>
      )}
    </div>
  );
}

function effectiveValue(h: Holding): number {
  if (typeof h.value === "number" && Number.isFinite(h.value) && h.value > 0)
    return h.value;
  const shares = Number(h.shares) || 0;
  const price = Number(h.price) || 0;
  return shares * price;
}
