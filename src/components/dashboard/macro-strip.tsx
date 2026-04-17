"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Drillable } from "./drill-context";

/**
 * Compact horizontal macro strip — four key indicators as clickable pills
 * with value + 12-month delta. Replaces the larger macro-context card
 * for the slimmer editorial dashboard; the same data, less chrome.
 */
type MacroItem = {
  indicator: string;
  value: string;
  date: string;
  deltaLabel?: string;
};

/**
 * Map human labels → FRED series codes so the drill panel can show the
 * right explainer. Unknown labels fall back to using the label itself.
 */
const LABEL_TO_CODE: Record<string, string> = {
  "10-Year Treasury Yield": "DGS10",
  "Fed Funds Rate": "DFF",
  "CPI YoY Inflation": "CPIAUCSL",
  "VIX Volatility Index": "VIXCLS",
  Unemployment: "UNRATE",
  "Unemployment Rate": "UNRATE",
};

const PRIORITY = [
  "10-Year Treasury Yield",
  "Fed Funds Rate",
  "CPI YoY Inflation",
  "VIX Volatility Index",
];

export default function MacroStrip({
  snapshot,
  loading,
}: {
  snapshot: MacroItem[];
  loading: boolean;
}) {
  const ordered = [...snapshot].sort((a, b) => {
    const ai = PRIORITY.indexOf(a.indicator);
    const bi = PRIORITY.indexOf(b.indicator);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg bg-[var(--secondary)]/60"
          />
        ))}
      </div>
    );
  }

  if (ordered.length === 0) return null;

  return (
    <section
      aria-label="Macro context"
      className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2.5"
    >
      <div className="mb-1 flex items-baseline justify-between px-1.5">
        <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
          Macro context
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          FRED · daily
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ordered.slice(0, 4).map((m) => {
          const code = LABEL_TO_CODE[m.indicator] ?? m.indicator;
          const direction = deltaDirection(m.deltaLabel);
          const Icon =
            direction === "up"
              ? TrendingUp
              : direction === "down"
                ? TrendingDown
                : Minus;
          return (
            <Drillable
              key={m.indicator}
              target={{ kind: "macro", indicator: code, label: m.indicator }}
              ariaLabel={`Open macro detail for ${m.indicator}`}
              className="!block w-full !hover:no-underline"
            >
              <div className="group rounded-lg px-3 py-2 transition-colors hover:bg-[var(--secondary)]/60">
                <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] truncate">
                  {shortLabel(m.indicator)}
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2">
                  <span className="font-mono tabular-nums text-lg leading-none text-[var(--foreground)]">
                    {m.value}
                  </span>
                  {m.deltaLabel && (
                    <span
                      className={`inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums ${
                        direction === "up"
                          ? "text-[var(--buy)]"
                          : direction === "down"
                            ? "text-[var(--sell)]"
                            : "text-[var(--muted-foreground)]"
                      }`}
                    >
                      <Icon className="h-2.5 w-2.5" />
                      {m.deltaLabel}
                    </span>
                  )}
                </div>
              </div>
            </Drillable>
          );
        })}
      </div>
    </section>
  );
}

function shortLabel(s: string): string {
  return s
    .replace("10-Year Treasury Yield", "10-Yr Treasury")
    .replace("Fed Funds Rate", "Fed Funds")
    .replace("CPI YoY Inflation", "CPI YoY")
    .replace("VIX Volatility Index", "VIX")
    .replace("Unemployment Rate", "Unemployment");
}

function deltaDirection(d?: string): "up" | "down" | "flat" {
  if (!d) return "flat";
  if (d.startsWith("+")) return "up";
  if (d.startsWith("-") || d.startsWith("−")) return "down";
  return "flat";
}
