"use client";

import { useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from "recharts";
import type { Holding } from "@/lib/client/holdings-cache";
import { Drillable } from "./drill-context";
import { moneyFull, pctRawSigned, freshness, timeGreeting } from "./format";

/**
 * The first thing the user sees. An editorial-grade headline with:
 *   - oversized serif portfolio total (Fraunces)
 *   - signed change with tone color
 *   - a timeframe selector that drives a sparkline beneath
 *   - supplementary metadata (positions, accounts, last sync)
 *
 * Everything is clickable — total value opens the "total_value" KPI
 * panel; the sparkline itself is a drillable "period_change" KPI.
 */

type Point = { date: string; totalValue: number };

type Timeframe = "1M" | "3M" | "YTD" | "1Y" | "ALL";

function filterSeries(series: Point[], tf: Timeframe): Point[] {
  if (series.length === 0) return [];
  if (tf === "ALL") return series;
  const now = new Date();
  let cutoff = new Date(now);
  if (tf === "1M") cutoff.setMonth(now.getMonth() - 1);
  else if (tf === "3M") cutoff.setMonth(now.getMonth() - 3);
  else if (tf === "YTD") cutoff = new Date(now.getFullYear(), 0, 1);
  else if (tf === "1Y") cutoff.setFullYear(now.getFullYear() - 1);
  const ct = cutoff.getTime();
  return series.filter((p) => new Date(p.date).getTime() >= ct);
}

export default function PortfolioHero({
  userName,
  totalValue,
  holdings,
  connected,
  series,
  dayChangePct,
  loading,
  lastSyncedAt,
  accountCount,
  institutions,
}: {
  userName: string;
  totalValue: number;
  holdings: Holding[];
  connected: boolean;
  series: Point[];
  dayChangePct: number | null;
  loading: boolean;
  lastSyncedAt: string | null;
  accountCount: number | null;
  institutions: string[] | null;
}) {
  const [tf, setTf] = useState<Timeframe>("1M");

  const filtered = useMemo(() => filterSeries(series, tf), [series, tf]);

  const periodChange = useMemo(() => {
    if (filtered.length < 2) return null;
    const first = filtered[0].totalValue;
    const last = filtered[filtered.length - 1].totalValue;
    if (first <= 0) return null;
    return ((last - first) / first) * 100;
  }, [filtered]);

  const positionCount = holdings.length;
  const assetClassCount = new Set(
    holdings.map((h) => h.assetClass ?? h.sector ?? "other")
  ).size;

  const greeting = timeGreeting();
  const firstName = (userName || "there").split(" ")[0];

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_1px_0_rgba(0,0,0,0.02),0_20px_30px_-24px_rgba(26,22,19,0.12)]"
      aria-labelledby="portfolio-hero-title"
    >
      {/* Decorative grain + gradient mesh — adds editorial warmth. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'180\' height=\'180\'><filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'2\'/></filter><rect width=\'100%\' height=\'100%\' filter=\'url(%23n)\' opacity=\'0.9\'/></svg>")',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full opacity-[0.10]"
        style={{
          background:
            "radial-gradient(closest-side, var(--buy), transparent 70%)",
        }}
      />

      <div className="relative px-6 pt-8 pb-6 sm:px-10 sm:pt-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div
              id="portfolio-hero-title"
              className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]"
            >
              {greeting}, {firstName} · {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {connected ? (
                loading ? (
                  // A dash at 82px reads as an error state, not loading.
                  // Skeleton block preserves the visual weight without
                  // the misleading "missing value" glyph.
                  <span
                    aria-label="Loading portfolio value"
                    className="inline-block h-[clamp(44px,6vw,82px)] w-[min(280px,60vw)] animate-pulse rounded-lg bg-[var(--secondary)]/70"
                  />
                ) : (
                  <Drillable
                    target={{
                      kind: "kpi",
                      metric: "total_value",
                      label: "Total portfolio value",
                      valueLabel: moneyFull(totalValue),
                    }}
                    as="span"
                    ariaLabel="Open details on total portfolio value"
                    className="!hover:no-underline"
                  >
                    <span className="font-serif font-light tracking-tight leading-[0.95] text-[clamp(44px,6vw,82px)] text-[var(--foreground)]">
                      {moneyFull(totalValue)}
                    </span>
                  </Drillable>
                )
              ) : (
                <span className="font-serif font-light tracking-tight leading-[0.95] text-[clamp(44px,6vw,82px)] text-[var(--muted-foreground)]">
                  Not connected
                </span>
              )}

              {dayChangePct != null && connected && (
                <Drillable
                  target={{
                    kind: "kpi",
                    metric: "day_change",
                    label: "Today's change",
                    valueLabel: pctRawSigned(dayChangePct),
                  }}
                  as="span"
                  ariaLabel="Open details on today's change"
                  className={`font-mono tabular-nums text-xl ${
                    dayChangePct > 0
                      ? "text-[var(--buy)]"
                      : dayChangePct < 0
                        ? "text-[var(--sell)]"
                        : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {pctRawSigned(dayChangePct)} today
                </Drillable>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
              {connected ? (
                <>
                  <Drillable
                    target={{
                      kind: "kpi",
                      metric: "positions",
                      label: "Positions",
                      valueLabel: `${positionCount}`,
                    }}
                    as="span"
                  >
                    <span className="font-mono tabular-nums text-[var(--foreground)]">
                      {positionCount}
                    </span>{" "}
                    position{positionCount === 1 ? "" : "s"}
                  </Drillable>
                  {assetClassCount > 0 && (
                    <span>
                      <span className="font-mono tabular-nums text-[var(--foreground)]">
                        {assetClassCount}
                      </span>{" "}
                      asset class{assetClassCount === 1 ? "" : "es"}
                    </span>
                  )}
                  {accountCount && accountCount > 0 && (
                    <span>
                      <span className="font-mono tabular-nums text-[var(--foreground)]">
                        {accountCount}
                      </span>{" "}
                      account{accountCount === 1 ? "" : "s"}
                      {institutions && institutions.length > 0 && (
                        <>
                          {" "}
                          <span className="opacity-70">
                            · {institutions.slice(0, 2).join(", ")}
                            {institutions.length > 2
                              ? ` +${institutions.length - 2}`
                              : ""}
                          </span>
                        </>
                      )}
                    </span>
                  )}
                  {lastSyncedAt && (
                    <span>Synced {freshness(lastSyncedAt)}</span>
                  )}
                </>
              ) : (
                <span>
                  Connect a brokerage to see live portfolio data.{" "}
                  <a
                    href="/app?view=integrations"
                    className="underline underline-offset-4 hover:text-[var(--foreground)]"
                  >
                    Link account ↗
                  </a>
                </span>
              )}
            </div>
          </div>

          {/* Timeframe selector */}
          {connected && filtered.length > 1 && (
            <div className="flex flex-row md:flex-col items-start md:items-end gap-2 shrink-0">
              <div
                role="tablist"
                aria-label="Timeframe"
                className="inline-flex rounded-full border border-[var(--border)] bg-[var(--background)] p-0.5 text-[11px]"
              >
                {(["1M", "3M", "YTD", "1Y", "ALL"] as Timeframe[]).map((t) => {
                  const active = t === tf;
                  return (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTf(t)}
                      className={`px-2.5 py-1 rounded-full font-medium uppercase tracking-wider transition-colors ${
                        active
                          ? "bg-[var(--foreground)] text-[var(--background)]"
                          : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
              {periodChange != null && (
                <Drillable
                  target={{
                    kind: "kpi",
                    metric: "period_change",
                    label: `${tf} change`,
                    valueLabel: pctRawSigned(periodChange),
                  }}
                  as="span"
                  className={`font-mono tabular-nums text-sm ${
                    periodChange > 0
                      ? "text-[var(--buy)]"
                      : periodChange < 0
                        ? "text-[var(--sell)]"
                        : ""
                  }`}
                >
                  {pctRawSigned(periodChange)} {tf.toLowerCase()}
                </Drillable>
              )}
            </div>
          )}
        </div>

        {/* Sparkline */}
        {connected && filtered.length > 1 && (
          <div className="mt-6 h-[88px] -mx-2 sm:-mx-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={filtered}
                margin={{ top: 4, right: 12, bottom: 4, left: 12 }}
              >
                <defs>
                  <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--buy)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--buy)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" hide />
                <Tooltip
                  cursor={{
                    stroke: "var(--foreground)",
                    strokeDasharray: "3 3",
                    opacity: 0.3,
                  }}
                  contentStyle={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                  }}
                  labelFormatter={(v) =>
                    new Date(String(v)).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }
                  formatter={(v) => [
                    moneyFull(typeof v === "number" ? v : Number(v)),
                    "Portfolio",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="totalValue"
                  stroke="var(--buy)"
                  strokeWidth={1.75}
                  fill="url(#heroFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}
