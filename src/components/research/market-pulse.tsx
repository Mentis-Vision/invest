"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";

/**
 * Today's market pulse — a single editorial strip that lands on the
 * research page so users get value before typing a ticker.
 *
 * Two rows:
 *   - Index closes (SPY / QQQ / IWM) — pulled from the warehouse
 *   - Macro headline (10Y yield, Fed funds, CPI) — pulled from the
 *     daily FRED snapshot
 *
 * Data sources are already in place; this component just composes them.
 * If either endpoint fails, the corresponding row hides — no error UI
 * (this is a peripheral signal, not the main content).
 */

type IndexBar = {
  ticker: string;
  close: number | null;
  changePct: number | null;
};

type MacroEntry = {
  series: string;
  label: string;
  value: number;
  unit?: string;
  delta?: number;
};

const INDICES: Array<{ ticker: string; label: string }> = [
  { ticker: "SPY", label: "S&P 500" },
  { ticker: "QQQ", label: "Nasdaq" },
  { ticker: "IWM", label: "Russell 2000" },
];

const MACRO_KEYS = ["DGS10", "FEDFUNDS", "CPIAUCSL"];

export function MarketPulse() {
  const [indices, setIndices] = useState<IndexBar[]>([]);
  const [macro, setMacro] = useState<MacroEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const tasks: Array<Promise<unknown>> = [
      ...INDICES.map((i) =>
        fetch(`/api/warehouse/ticker/${i.ticker}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => ({
            ticker: i.ticker,
            close: d?.market?.close ?? null,
            changePct: d?.market?.changePct ?? null,
          }))
          .catch(() => null)
      ),
      fetch(`/api/macro`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.snapshot ?? [])
        .catch(() => []),
    ];
    Promise.all(tasks).then((results) => {
      if (!alive) return;
      const idxResults = results.slice(0, INDICES.length) as Array<IndexBar | null>;
      const macroResult = (results[INDICES.length] as MacroEntry[]) ?? [];
      setIndices(idxResults.filter(Boolean) as IndexBar[]);
      setMacro(
        macroResult
          .filter((m) => MACRO_KEYS.includes(m.series))
          .sort((a, b) => MACRO_KEYS.indexOf(a.series) - MACRO_KEYS.indexOf(b.series))
      );
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="h-3 w-24 animate-pulse rounded bg-[var(--secondary)]" />
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded bg-[var(--secondary)]/60"
            />
          ))}
        </div>
      </div>
    );
  }

  const anyData = indices.some((i) => i.close != null) || macro.length > 0;
  if (!anyData) return null;

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
        <Activity className="h-3 w-3" />
        Today&rsquo;s market pulse
      </div>

      {indices.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {indices.map((i) => {
            const meta = INDICES.find((x) => x.ticker === i.ticker);
            const tone =
              i.changePct == null
                ? "neutral"
                : i.changePct > 0
                  ? "up"
                  : i.changePct < 0
                    ? "down"
                    : "neutral";
            const TrendIcon = tone === "up" ? TrendingUp : tone === "down" ? TrendingDown : null;
            return (
              <div key={i.ticker} className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                  {meta?.label ?? i.ticker}
                </div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="font-mono tabular-nums text-base font-medium text-[var(--foreground)]">
                    {i.close != null
                      ? `$${i.close.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "—"}
                  </span>
                  {i.changePct != null && (
                    <span
                      className={`inline-flex items-center gap-0.5 text-xs font-mono tabular-nums ${
                        tone === "up"
                          ? "text-[var(--buy)]"
                          : tone === "down"
                            ? "text-[var(--sell)]"
                            : "text-[var(--muted-foreground)]"
                      }`}
                    >
                      {TrendIcon && <TrendIcon className="h-3 w-3" />}
                      {i.changePct > 0 ? "+" : ""}
                      {i.changePct.toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {macro.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-[var(--border)] pt-3 text-xs">
          {macro.map((m) => (
            <div key={m.series} className="flex items-baseline gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                {m.label}
              </span>
              <span className="font-mono tabular-nums text-[var(--foreground)]">
                {formatMacroValue(m)}
              </span>
              {typeof m.delta === "number" && (
                <span
                  className={`text-[10px] font-mono tabular-nums ${
                    m.delta > 0
                      ? "text-[var(--decisive)]"
                      : m.delta < 0
                        ? "text-[var(--buy)]"
                        : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {m.delta > 0 ? "+" : ""}
                  {m.delta.toFixed(2)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatMacroValue(m: MacroEntry): string {
  if (m.unit === "Percent" || m.series === "DGS10" || m.series === "FEDFUNDS") {
    return `${m.value.toFixed(2)}%`;
  }
  // CPI — show as YoY pct (FRED returns level; we don't have YoY computed
  // here so just render the level).
  return m.value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
