"use client";

import { useEffect, useState } from "react";
import { getHoldings } from "@/lib/client/holdings-cache";
import BlockGrid from "@/components/dashboard/block-grid";
import { DrillProvider } from "@/components/dashboard/drill-context";
import DrillPanel from "@/components/dashboard/drill-panel";

/**
 * The new dashboard (hybrid-v2 redesign).
 *
 * Structure:
 *   1. One-line greeting + portfolio day-change summary
 *   2. Customizable block grid (BlockGrid — handles everything else)
 *
 * The old big-hero / sectioned layout has been replaced entirely by
 * the grid. Blocks handle their own data fetching and empty states.
 * User's layout persists per-account in the dashboard_layout table.
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
  const [dayChangePct, setDayChangePct] = useState<number | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    // Portfolio day-change from track-record portfolioSeries (today vs
    // yesterday snapshot). Per-holding day change isn't in the
    // SnapTrade payload, so we use the series delta.
    Promise.all([
      getHoldings(),
      fetch("/api/track-record")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([d, tr]) => {
        if (!alive) return;
        setConnected(!!d.connected);
        const totalValue = d.totalValue ?? 0;
        const series = (tr?.portfolioSeries ?? []) as Array<{
          date: string;
          totalValue: number;
        }>;
        if (series.length >= 2 && totalValue > 0) {
          const prev = series[series.length - 2]?.totalValue ?? 0;
          if (prev > 0) {
            setDayChangePct(((totalValue - prev) / prev) * 100);
            return;
          }
        }
        setDayChangePct(null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const firstName = userName.split(" ")[0];
  const greeting = timeGreeting();
  const dayString = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="space-y-4">
      {/* One-line greeting + portfolio change — the only non-block
          element. Everything else lives in the customizable grid. */}
      <div className="flex flex-wrap items-baseline justify-between gap-4 pb-2">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground md:text-[22px]">
          {greeting}, {firstName}.{" "}
          {connected === false ? (
            <span className="font-normal text-muted-foreground">
              Link a brokerage to see your portfolio.
            </span>
          ) : dayChangePct != null ? (
            <>
              Portfolio is{" "}
              <span
                className={`font-medium ${
                  dayChangePct > 0
                    ? "text-[var(--buy)]"
                    : dayChangePct < 0
                      ? "text-[var(--sell)]"
                      : "text-muted-foreground"
                }`}
              >
                {dayChangePct > 0 ? "+" : ""}
                {dayChangePct.toFixed(2)}% today
              </span>
              .
            </>
          ) : (
            <span className="font-normal text-muted-foreground">
              Loading your latest…
            </span>
          )}
        </h1>
        <span className="text-[12px] text-muted-foreground">{dayString}</span>
      </div>

      <BlockGrid />
    </div>
  );
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Up late";
}
