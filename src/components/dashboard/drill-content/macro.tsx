"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
} from "recharts";
import { DrillHeader, DrillBody, DrillSection } from "./panel-shell";

/**
 * Macro indicator drill-down — now with 12-month trend sparkline
 * pulled from /api/macro (same cached payload the dashboard already uses).
 * Explainers supply plain-English "why it matters" copy per series.
 */
const EXPLAINERS: Record<string, { title: string; story: string }> = {
  CPIAUCSL: {
    title: "Consumer Price Index",
    story:
      "Broad headline inflation. When CPI is persistently above ~3%, bonds " +
      "repricing is the usual first-order effect — equity multiples compress " +
      "because the discount rate is higher. We surface the 12-month delta " +
      "rather than the raw index because the raw number is an arbitrary 1982 baseline.",
  },
  UNRATE: {
    title: "Unemployment rate",
    story:
      "Labor-market tightness. Sustained UNRATE below 4% often precedes wage-driven " +
      "inflation; sharp jumps above 4.5% are historically one of the earliest " +
      "recession signals. Leading indicator for consumer-discretionary and " +
      "small-cap sectors in particular.",
  },
  DGS10: {
    title: "10-Year Treasury yield",
    story:
      "The benchmark discount rate. Growth stocks (high future earnings) are most " +
      "sensitive — a 100bp rise in 10Y yields typically compresses long-duration " +
      "equity multiples 10–15%. Watch the spread vs the 2Y yield for the " +
      "classic recession-forecasting inversion.",
  },
  DFF: {
    title: "Federal Funds Rate",
    story:
      "The Fed's overnight target — the floor for every other short-term rate. " +
      "Rate-cut cycles typically help rate-sensitive sectors (housing, REITs, " +
      "long-duration growth). Rate-hike cycles compress multiples and punish " +
      "leverage.",
  },
  VIXCLS: {
    title: "VIX Volatility Index",
    story:
      "Implied 30-day S&P 500 volatility. Below 15 is calm complacency; " +
      "15-25 is normal; above 30 is panic territory. Sudden spikes often " +
      "mark short-term market bottoms (capitulation) but not always.",
  },
};

type MacroSnapshot = {
  indicator: string;
  value: string;
  date: string;
  deltaLabel?: string;
  trend12mo?: Array<{ date: string; value: string }>;
};

export function DrillMacro({
  indicator,
  label,
}: {
  indicator: string;
  label: string;
}) {
  const copy = EXPLAINERS[indicator];
  const [snapshot, setSnapshot] = useState<MacroSnapshot[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/macro")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { snapshot?: MacroSnapshot[] } | null) => {
        if (!alive) return;
        setSnapshot(data?.snapshot ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Find this indicator in the snapshot either by exact series code or by
  // the human label that the macro strip uses.
  const item = useMemo(() => {
    if (!snapshot) return null;
    return (
      snapshot.find((s) => s.indicator === label) ??
      snapshot.find((s) => s.indicator === indicator) ??
      null
    );
  }, [snapshot, indicator, label]);

  const trend = useMemo(() => {
    if (!item?.trend12mo) return [];
    return item.trend12mo
      .map((p) => ({
        date: p.date,
        value: Number(p.value),
      }))
      .filter((p) => Number.isFinite(p.value));
  }, [item]);

  return (
    <>
      <DrillHeader
        eyebrow="Macro indicator"
        title={<span>{copy?.title ?? label}</span>}
        subtitle={
          <>
            <span className="font-mono text-[10px] uppercase tracking-widest opacity-70">
              {indicator} · FRED
            </span>
            {item && (
              <span className="ml-3 font-mono tabular-nums text-base text-[var(--foreground)]">
                {item.value}
                {item.deltaLabel && (
                  <span
                    className={`ml-2 text-xs ${
                      item.deltaLabel.startsWith("+")
                        ? "text-[var(--buy)]"
                        : item.deltaLabel.startsWith("-") ||
                            item.deltaLabel.startsWith("−")
                          ? "text-[var(--sell)]"
                          : "text-[var(--muted-foreground)]"
                    }`}
                  >
                    {item.deltaLabel}
                  </span>
                )}
              </span>
            )}
          </>
        }
      />
      <DrillBody>
        <DrillSection
          label="12-month trend"
          description={
            loading
              ? "loading…"
              : trend.length > 0
                ? `${trend.length} months`
                : "history unavailable"
          }
        >
          {loading ? (
            <div className="flex h-24 items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <Loader2 className="h-3 w-3 animate-spin" /> loading macro series…
            </div>
          ) : trend.length < 2 ? (
            <p className="text-xs text-[var(--muted-foreground)]">
              Trend not available for this series.
            </p>
          ) : (
            <div className="h-24 -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={trend}
                  margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
                >
                  <defs>
                    <linearGradient id="macroFill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--buy)"
                        stopOpacity={0.18}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--buy)"
                        stopOpacity={0}
                      />
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
                      fontSize: 11,
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                    }}
                    labelFormatter={(v) =>
                      new Date(String(v)).toLocaleDateString("en-US", {
                        month: "short",
                        year: "numeric",
                      })
                    }
                    formatter={(v) => {
                      const n = typeof v === "number" ? v : Number(v);
                      return [
                        Number.isFinite(n) ? n.toFixed(2) : "—",
                        indicator,
                      ];
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="var(--buy)"
                    strokeWidth={1.5}
                    fill="url(#macroFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </DrillSection>

        <DrillSection label="Why it matters">
          <p className="text-sm leading-relaxed text-[var(--foreground)]">
            {copy?.story ??
              "This indicator is part of the macro context the analyst panel " +
                "receives before weighing a recommendation."}
          </p>
        </DrillSection>
        <DrillSection label="Data source">
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            St. Louis Fed FRED. Values update daily (or at release cadence for
            monthly series). We pull the latest reading plus a 12-month trend —
            no real-time streaming, no intraday churn.
          </p>
        </DrillSection>
      </DrillBody>
    </>
  );
}
