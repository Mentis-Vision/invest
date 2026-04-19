"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, Check } from "lucide-react";
import { getHoldings } from "@/lib/client/holdings-cache";
import BlockGrid, { type BlockGridHandle } from "@/components/dashboard/block-grid";
import { DrillProvider } from "@/components/dashboard/drill-context";
import DrillPanel from "@/components/dashboard/drill-panel";

/**
 * Dashboard (hybrid-v2 redesign).
 *
 * Layout:
 *   [greeting] ———————————— [date] [⚙ Customize]
 *   [BlockGrid — customizable]
 *
 * The Customize button lives here (in the page header) rather than
 * inside BlockGrid so the grid has one less vertical element and the
 * toggle is always visible at the top of the page alongside the date.
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
  const gridRef = useRef<BlockGridHandle>(null);
  const [editing, setEditing] = useState(false);
  const [dayChangePct, setDayChangePct] = useState<number | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  // ── Hydration-safe time-dependent strings ────────────────────────
  // Server renders in UTC; the user is in their own timezone. If we
  // compute greeting/date at render time, SSR and client hydration
  // produce different text and React throws #418 (hydration mismatch),
  // which cascades into a Base UI menu error when the dropdown tries
  // to render into the broken tree. So we start empty (matches SSR
  // output byte-for-byte) and fill in after mount.
  const [greeting, setGreeting] = useState("");
  const [dayString, setDayString] = useState("");

  useEffect(() => {
    setGreeting(timeGreeting());
    setDayString(
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    );

    let alive = true;
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

  function handleCustomizeClick() {
    gridRef.current?.toggleEdit();
    setEditing((v) => !v);
  }

  return (
    <div className="space-y-4">
      {/* Header row: greeting (left) · date + Customize (right) */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-2">
        <h1
          // Time-dependent text is populated in useEffect; suppress
          // hydration warnings on this node so React doesn't error if
          // the server-rendered empty string differs from the client
          // value between re-render and paint.
          suppressHydrationWarning
          className="text-[20px] font-semibold tracking-[-0.02em] text-foreground md:text-[22px]"
        >
          {greeting ? (
            <>
              {greeting}, {firstName}.{" "}
            </>
          ) : (
            <>Welcome, {firstName}.{" "}</>
          )}
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
        <div className="flex items-center gap-3">
          <span
            suppressHydrationWarning
            className="text-[12px] text-muted-foreground"
          >
            {dayString}
          </span>
          <button
            type="button"
            onClick={handleCustomizeClick}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
              editing
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-foreground/80 hover:border-primary/50 hover:text-foreground"
            }`}
          >
            {editing ? (
              <>
                <Check className="h-3.5 w-3.5" /> Done
              </>
            ) : (
              <>
                <Settings className="h-3.5 w-3.5" /> Customize
              </>
            )}
          </button>
        </div>
      </div>

      <BlockGrid ref={gridRef} />
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
