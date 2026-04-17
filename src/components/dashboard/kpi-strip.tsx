"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import type { Holding } from "@/lib/client/holdings-cache";
import { Drillable } from "./drill-context";
import { pct, pctRawSigned, compact } from "./format";

/**
 * A row of five compact, drillable KPIs. Each tile is an editorial
 * stat card: uppercase label, oversized mono number, subtle trend hint.
 * Clicking any tile opens the KPI drill panel with the "how this is
 * computed" explainer.
 *
 * Design rationale: keep the numbers huge and the chrome minimal —
 * the tile should read at a glance without hunting for the value.
 */
export default function KpiStrip({
  totalValue,
  holdings,
  dayChangePct,
  hitRatePct,
  activeAlerts,
  loading,
}: {
  totalValue: number;
  holdings: Holding[];
  dayChangePct: number | null;
  hitRatePct: number | null;
  activeAlerts: number | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-[88px] rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
          >
            <div className="h-2 w-14 animate-pulse rounded bg-[var(--secondary)]" />
            <div className="mt-2.5 h-7 w-20 animate-pulse rounded bg-[var(--secondary)]" />
            <div className="mt-2 h-2 w-24 animate-pulse rounded bg-[var(--secondary)]/60" />
          </div>
        ))}
      </div>
    );
  }

  const positionCount = holdings.length;

  const { cashValue, cashShare } = useMemo(() => {
    const cashClasses = new Set(["cash", "money_market", "mmf"]);
    const cash = holdings.reduce((sum, h) => {
      const cls = (h.assetClass ?? "").toLowerCase();
      const isCash =
        cashClasses.has(cls) ||
        h.ticker.toUpperCase().endsWith("CASH") ||
        h.ticker.toUpperCase() === "CASH";
      return isCash ? sum + (Number(h.value) || 0) : sum;
    }, 0);
    return {
      cashValue: cash,
      cashShare: totalValue > 0 ? cash / totalValue : 0,
    };
  }, [holdings, totalValue]);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <KpiTile
        label="Today"
        value={dayChangePct != null ? pctRawSigned(dayChangePct) : "—"}
        tone={
          dayChangePct == null
            ? "neutral"
            : dayChangePct > 0
              ? "up"
              : dayChangePct < 0
                ? "down"
                : "neutral"
        }
        context={
          dayChangePct != null
            ? "since your last sync"
            : "connect brokerage to see"
        }
        drill={{
          kind: "kpi",
          metric: "day_change",
          label: "Today",
          valueLabel: pctRawSigned(dayChangePct),
        }}
      />
      <KpiTile
        label="Positions"
        value={`${positionCount}`}
        context={positionCount > 0 ? "distinct holdings" : "none yet"}
        drill={{
          kind: "kpi",
          metric: "positions",
          label: "Positions",
          valueLabel: `${positionCount}`,
        }}
      />
      <KpiTile
        label="Hit rate"
        value={hitRatePct != null ? `${Math.round(hitRatePct)}%` : "—"}
        tone={
          hitRatePct == null
            ? "neutral"
            : hitRatePct >= 60
              ? "up"
              : hitRatePct < 45
                ? "down"
                : "neutral"
        }
        context={hitRatePct != null ? "evaluated recs" : "no outcomes yet"}
        drill={{
          kind: "kpi",
          metric: "hit_rate",
          label: "Hit rate",
          valueLabel: hitRatePct != null ? `${Math.round(hitRatePct)}%` : "—",
        }}
      />
      <KpiTile
        label="Alerts"
        value={activeAlerts != null ? `${activeAlerts}` : "—"}
        tone={
          activeAlerts != null && activeAlerts > 0 ? "warn" : "neutral"
        }
        context={
          activeAlerts != null && activeAlerts > 0
            ? "undismissed overnight"
            : "all caught up"
        }
        drill={{
          kind: "kpi",
          metric: "alerts_active",
          label: "Active alerts",
          valueLabel: activeAlerts != null ? `${activeAlerts}` : "—",
        }}
      />
      <KpiTile
        label="Cash"
        value={pct(cashShare)}
        context={
          cashValue > 0 ? `~${compact(cashValue)} idle` : "all invested"
        }
        drill={{
          kind: "kpi",
          metric: "cash_share",
          label: "Cash share",
          valueLabel: pct(cashShare),
        }}
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  context,
  tone = "neutral",
  drill,
}: {
  label: string;
  value: ReactNode;
  context?: string;
  tone?: "up" | "down" | "warn" | "neutral";
  drill: Parameters<typeof Drillable>[0]["target"];
}) {
  const valueTone =
    tone === "up"
      ? "text-[var(--buy)]"
      : tone === "down"
        ? "text-[var(--sell)]"
        : tone === "warn"
          ? "text-[var(--decisive)]"
          : "text-[var(--foreground)]";

  return (
    <div className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] transition-all duration-200 hover:border-[var(--foreground)]/40 hover:-translate-y-[1px] hover:shadow-[0_4px_20px_-12px_rgba(26,22,19,0.3)]">
      <Drillable
        target={drill}
        ariaLabel={`Open details on ${label.toLowerCase()}`}
        className="!block !cursor-pointer w-full text-left px-4 pt-3 pb-3.5 !hover:no-underline"
      >
        <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
          {label}
        </div>
        <div
          className={`mt-1 font-mono tabular-nums text-2xl sm:text-[28px] leading-none ${valueTone}`}
        >
          {value}
        </div>
        {context && (
          <div className="mt-1.5 text-[10px] text-[var(--muted-foreground)]">
            {context}
          </div>
        )}
      </Drillable>
    </div>
  );
}
