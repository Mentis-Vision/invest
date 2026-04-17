"use client";

import { useMemo } from "react";
import type { Holding } from "@/lib/client/holdings-cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Drillable } from "./drill-context";
import { money, pct } from "./format";

/**
 * Companion to the donut. Rolls holdings into buckets, sorts by size,
 * renders each as a clickable row with a bar showing its share. The
 * sector axis is preferred; falls back to asset class when sector isn't
 * available (e.g. crypto-heavy portfolios).
 *
 * Each row is drillable into the allocation panel, which lists the
 * member holdings.
 */
export default function AllocationTable({
  holdings,
  totalValue,
  loading,
}: {
  holdings: Holding[];
  totalValue: number;
  loading: boolean;
}) {
  const buckets = useMemo(() => {
    // Choose axis: sector if available for most positions, else asset class.
    const withSector = holdings.filter((h) => h.sector).length;
    const useSector = withSector >= holdings.length * 0.5;

    const groups = new Map<string, Holding[]>();
    for (const h of holdings) {
      const key = useSector
        ? h.sector ?? "Unclassified"
        : (h.assetClass ?? "Other").replace(/_/g, " ");
      const arr = groups.get(key) ?? [];
      arr.push(h);
      groups.set(key, arr);
    }

    return [...groups.entries()]
      .map(([bucket, items]) => {
        const value = items.reduce(
          (s, h) => s + effectiveValue(h),
          0
        );
        return { bucket, items, value };
      })
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  const topShare = buckets[0]?.value && totalValue > 0
    ? buckets[0].value / totalValue
    : 0;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2 border-b border-[var(--border)]">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-lg font-semibold tracking-tight">
            Allocation
          </CardTitle>
          {topShare > 0 && (
            <span className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)]">
              top bucket · {pct(topShare)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-9 animate-pulse rounded-md bg-[var(--secondary)]/60"
              />
            ))}
          </div>
        ) : buckets.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
            Connect a brokerage to see your allocation.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {buckets.map(({ bucket, items, value }, idx) => {
              const share = totalValue > 0 ? value / totalValue : 0;
              return (
                <li key={bucket} className="py-2">
                  <Drillable
                    target={{
                      kind: "allocation",
                      bucket,
                      holdings: items,
                      totalValue,
                    }}
                    ariaLabel={`Open ${bucket} allocation detail`}
                    className="!block w-full !hover:no-underline"
                  >
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate">
                        <span
                          className="inline-block h-2 w-2 rounded-full mr-2 align-middle"
                          style={{ background: bucketColor(idx) }}
                          aria-hidden
                        />
                        <span className="font-medium">{bucket}</span>
                        <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                          {items.length}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-right">
                        {money(value)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="relative h-1 flex-1 rounded-full bg-[var(--secondary)] overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.max(share * 100, 0.5)}%`,
                            background: bucketColor(idx),
                            opacity: 0.85,
                          }}
                        />
                      </div>
                      <span className="shrink-0 font-mono tabular-nums text-[11px] text-[var(--muted-foreground)] w-[3.25rem] text-right">
                        {pct(share)}
                      </span>
                    </div>
                  </Drillable>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function effectiveValue(h: Holding): number {
  if (typeof h.value === "number" && Number.isFinite(h.value) && h.value > 0)
    return h.value;
  const shares = Number(h.shares) || 0;
  const price = Number(h.price) || 0;
  return shares * price;
}

/**
 * Same palette sequence used by the donut so colors agree across
 * the two visualizations.
 */
const BUCKET_PALETTE = [
  "#2D5F3F",
  "#9A7B3F",
  "#B54F2A",
  "#8B1F2A",
  "#4A6B7E",
  "#6B8E5A",
  "#8B6B3E",
  "#5F5F5F",
  "#7A4F6B",
  "#4F6B7A",
];

function bucketColor(idx: number): string {
  return BUCKET_PALETTE[idx % BUCKET_PALETTE.length];
}
