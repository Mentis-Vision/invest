"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import type { Holding } from "@/lib/client/holdings-cache";

/**
 * Largest-position concentration card.
 *
 * Shows the user's biggest holding with its share of total portfolio.
 * A color-coded risk flag triggers at 25%+ (concentration risk) and
 * 40%+ (severe). Not a recommendation — a metric.
 *
 * Also clickable: links straight to Research on that ticker for a
 * one-touch deep dive.
 */

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 10000 ? 0 : 2,
  }).format(n);
}

export default function LargestPosition({
  holdings,
  totalValue,
  loading,
}: {
  holdings: Holding[];
  totalValue: number;
  loading: boolean;
}) {
  const largest =
    totalValue > 0 && holdings.length > 0
      ? holdings.slice().sort((a, b) => b.value - a.value)[0]
      : null;
  const pct = largest && totalValue > 0 ? (largest.value / totalValue) * 100 : 0;

  let tone: "ok" | "warn" | "severe" = "ok";
  if (pct >= 40) tone = "severe";
  else if (pct >= 25) tone = "warn";

  const cardCls =
    tone === "severe"
      ? "border-[var(--sell)]/40 bg-[var(--sell)]/5"
      : tone === "warn"
      ? "border-[var(--hold)]/40 bg-[var(--hold)]/5"
      : "";

  const textCls =
    tone === "severe"
      ? "text-[var(--sell)]"
      : tone === "warn"
      ? "text-[var(--hold)]"
      : "text-foreground";

  return (
    <Card className={cardCls}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          Largest position
          {tone !== "ok" && (
            <AlertTriangle className={`h-4 w-4 ${textCls}`} />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-20 animate-pulse rounded-md bg-muted/40" />
        ) : !largest ? (
          <p className="py-4 text-sm text-muted-foreground">
            No holdings to analyze.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <Link
                href={`/app?view=research&ticker=${encodeURIComponent(largest.ticker)}`}
                className="font-mono text-2xl font-semibold underline-offset-4 hover:underline"
              >
                {largest.ticker}
              </Link>
              <span
                className={`font-[family-name:var(--font-display)] text-3xl font-medium tracking-tight ${textCls}`}
              >
                {pct.toFixed(1)}%
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {largest.name} · {money(largest.value)}
            </p>
            {tone !== "ok" && (
              <p
                className={`mt-3 rounded-md border px-2 py-1.5 text-[11px] ${
                  tone === "severe"
                    ? "border-[var(--sell)]/30 bg-[var(--sell)]/10 text-[var(--sell)]"
                    : "border-[var(--hold)]/30 bg-[var(--hold)]/10 text-[var(--hold)]"
                }`}
              >
                {tone === "severe"
                  ? "Severe concentration — a single position above 40% is a major portfolio-level risk."
                  : "Concentration flag — single position above 25% carries elevated idiosyncratic risk."}
              </p>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground">
              Informational metric only. Not investment advice.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
