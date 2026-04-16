"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Recommendation distribution across the user's recent history.
 * Rendered as a horizontal stacked bar — more intuitive than a pie for
 * ordinal categories (BUY < HOLD < SELL < INSUFFICIENT). Built with
 * plain divs (no chart lib dependency needed for a 4-segment stack).
 */

type Totals = {
  total: number;
  buys: number;
  sells: number;
  holds: number;
};

export default function RecDistribution({
  totals,
  insufficientCount = 0,
  loading,
}: {
  totals: Totals | null;
  insufficientCount?: number;
  loading: boolean;
}) {
  const total =
    (totals?.total ?? 0) + (insufficientCount ?? 0) || 0;

  const segments: Array<{
    label: string;
    count: number;
    color: string;
    textClass: string;
  }> = [
    {
      label: "BUY",
      count: totals?.buys ?? 0,
      color: "var(--buy)",
      textClass: "text-[var(--buy)]",
    },
    {
      label: "HOLD",
      count: totals?.holds ?? 0,
      color: "var(--hold)",
      textClass: "text-[var(--hold)]",
    },
    {
      label: "SELL",
      count: totals?.sells ?? 0,
      color: "var(--sell)",
      textClass: "text-[var(--sell)]",
    },
    {
      label: "INSUFFICIENT",
      count: insufficientCount ?? 0,
      color: "var(--muted-foreground)",
      textClass: "text-muted-foreground",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Our call distribution</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Last 30 days. We bias to HOLD when evidence is ambiguous.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-20 animate-pulse rounded-md bg-muted/40" />
        ) : total === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No recommendations yet.
          </div>
        ) : (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {segments.map((s) => {
                const pct = (s.count / total) * 100;
                if (pct === 0) return null;
                return (
                  <div
                    key={s.label}
                    style={{ width: `${pct}%`, background: s.color }}
                    title={`${s.label}: ${s.count} (${pct.toFixed(0)}%)`}
                  />
                );
              })}
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              {segments.map((s) => {
                const pct = total > 0 ? (s.count / total) * 100 : 0;
                return (
                  <li key={s.label} className="flex flex-col">
                    <span className={`font-mono font-semibold ${s.textClass}`}>
                      {s.count}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {s.label} · {pct.toFixed(0)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
