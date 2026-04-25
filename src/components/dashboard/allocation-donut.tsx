"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { Holding } from "@/lib/client/holdings-cache";
import { sumMoney, normalizeWeights } from "@/lib/money";

/**
 * Portfolio allocation donut chart.
 *
 * Groups holdings by sector when equity data is available; by asset class
 * when it isn't (e.g. crypto-heavy portfolios). Uses the Editorial Warm
 * palette for coherence with the rest of the UI.
 *
 * Keeps computation light — no chart animation that might lag, no
 * recomputation on every parent rerender (memoized).
 */

type Segment = {
  name: string;
  value: number;
  pct: number;
  color: string;
};

// Editorial Warm-compatible palette. Deterministic by label so same
// bucket → same color across navigations.
const PALETTE = [
  "#2D5F3F", // forest green (primary)
  "#9A7B3F", // gold (hold)
  "#B54F2A", // rust (decisive)
  "#8B1F2A", // wine (sell)
  "#4A6B7E", // slate blue
  "#6B8E5A", // sage
  "#8B6B3E", // caramel
  "#5F5F5F", // warm grey
  "#7A4F6B", // mauve
  "#4F6B7A", // dusty blue
];

function colorFor(label: string, index: number): string {
  if (label === "Unclassified") return "#B0A99F";
  if (label === "Crypto" || label === "CRYPTO") return "#B54F2A";
  return PALETTE[index % PALETTE.length];
}

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 10000 ? 0 : 2,
  }).format(n);
}

type TooltipPayloadEntry = { payload?: Segment };
type TooltipRenderProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
};

function CustomTooltip(props: TooltipRenderProps) {
  const { active, payload } = props;
  if (!active || !payload?.length) return null;
  const seg = payload[0].payload;
  if (!seg) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <div className="font-medium">{seg.name}</div>
      <div className="mt-0.5 text-muted-foreground">
        {money(seg.value)} · {seg.pct.toFixed(1)}%
      </div>
    </div>
  );
}

export default function AllocationDonut({
  holdings,
  totalValue,
  loading,
}: {
  holdings: Holding[];
  totalValue: number;
  loading: boolean;
}) {
  const segments = useMemo<Segment[]>(() => {
    if (totalValue <= 0) return [];

    // Grouping logic:
    //   - Crypto-class holdings ALWAYS bucket as "Crypto" regardless of
    //     any stale Yahoo sector field (LINK/ATOM sometimes carry leftover
    //     sector="Technology" from earlier equity-only metadata lookups).
    //   - For non-crypto, prefer sector when we have coverage; otherwise
    //     fall back to asset-class labels.
    //
    // Rationale: a donut that splits BTC/ATOM/LINK across Technology and
    // Unclassified is misleading for a crypto portfolio. Same heuristic
    // applies on the server side in portfolio-review's prompt block.
    const nonCrypto = holdings.filter((h) => h.assetClass !== "crypto");
    const nonCryptoValue = sumMoney(...nonCrypto.map((h) => h.value));
    const withSectorValue = sumMoney(
      ...nonCrypto.filter((h) => h.sector).map((h) => h.value)
    );
    const sectorCoverage =
      nonCryptoValue > 0 ? withSectorValue / nonCryptoValue : 0;
    const bucketNonCryptoBySector = sectorCoverage >= 0.5;

    const buckets = new Map<string, number>();
    for (const h of holdings) {
      let key: string;
      if (h.assetClass === "crypto") {
        key = "Crypto";
      } else if (bucketNonCryptoBySector) {
        key = h.sector ?? "Unclassified";
      } else {
        key = labelForAssetClass(h.assetClass) ?? "Unclassified";
      }
      buckets.set(key, sumMoney(buckets.get(key) ?? 0, h.value));
    }

    const entries = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    // Allocation is the most prominent "sum to 100%" surface in the
    // product — percents adjacent to a pie chart. normalizeWeights
    // enforces exact-100 summation via largest-remainder; adjacent
    // slices of identical size will render as 33.3 / 33.3 / 33.4 (not
    // three 33.3s leaving 0.1 unaccounted).
    const pcts = normalizeWeights(
      entries.map(([, v]) => v),
      1
    );
    return entries.map(([name, value], i) => ({
      name,
      value,
      pct: pcts[i],
      color: colorFor(name, i),
    }));
  }, [holdings, totalValue]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Allocation</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-48 animate-pulse rounded-md bg-muted/40" />
        ) : segments.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Connect a brokerage to see your allocation.
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={segments}
                    innerRadius="60%"
                    outerRadius="95%"
                    paddingAngle={1}
                    dataKey="value"
                    isAnimationActive={false}
                    stroke="none"
                  >
                    {segments.map((seg) => (
                      <Cell key={seg.name} fill={seg.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="flex-1 space-y-1.5 text-xs">
              {segments.slice(0, 8).map((seg) => (
                <li
                  key={seg.name}
                  className="flex items-center gap-2 leading-tight"
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="flex-1 truncate">{seg.name}</span>
                  <span className="font-mono text-muted-foreground">
                    {seg.pct.toFixed(1)}%
                  </span>
                </li>
              ))}
              {segments.length > 8 && (
                <li className="text-[10px] text-muted-foreground">
                  +{segments.length - 8} more…
                </li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function labelForAssetClass(c?: string): string | null {
  if (!c) return null;
  switch (c) {
    case "equity":
      return "Stocks";
    case "etf":
      return "ETFs";
    case "crypto":
      return "Crypto";
    case "bond":
      return "Bonds";
    case "cash":
      return "Cash";
    default:
      return null;
  }
}
