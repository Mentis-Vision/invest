"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

/**
 * Portfolio value sparkline.
 *
 * Data source: daily portfolio_snapshot rows persisted by the nightly
 * cron. Zero AI cost, zero external HTTP — just one SELECT we've already
 * piggybacked onto /api/track-record.
 *
 * Renders nothing meaningful until we have ≥2 snapshots, so the first
 * day after shipping this will show an empty-state note rather than a
 * single dot.
 */

type Point = {
  date: string;
  totalValue: number;
  positionCount: number;
};

type TooltipPayloadEntry = { payload?: Point; value?: number };
type TooltipRenderProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
};

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 10000 ? 0 : 2,
  }).format(n);
}

function CustomTooltip(props: TooltipRenderProps) {
  const p = props.payload?.[0]?.payload;
  if (!props.active || !p) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <div className="font-mono">{p.date}</div>
      <div className="mt-0.5 font-medium">{money(p.totalValue)}</div>
      <div className="text-muted-foreground">{p.positionCount} positions</div>
    </div>
  );
}

export default function PortfolioSparkline({
  series,
  loading,
}: {
  series: Point[];
  loading: boolean;
}) {
  const change = (() => {
    if (series.length < 2) return null;
    const first = series[0].totalValue;
    const last = series[series.length - 1].totalValue;
    if (first <= 0) return null;
    const pct = ((last - first) / first) * 100;
    return { first, last, pct };
  })();

  const toneClass =
    !change
      ? "text-foreground"
      : change.pct > 0
      ? "text-[var(--buy)]"
      : change.pct < 0
      ? "text-[var(--sell)]"
      : "text-foreground";

  const strokeColor =
    !change || change.pct >= 0 ? "var(--buy)" : "var(--sell)";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <CardTitle className="text-base">Portfolio value</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Daily snapshot, last {series.length || 0} days.
            </p>
          </div>
          {change && (
            <div className="text-right">
              <div
                className={`font-[family-name:var(--font-display)] text-2xl font-medium tracking-tight ${toneClass}`}
              >
                {change.pct >= 0 ? "+" : ""}
                {change.pct.toFixed(2)}%
              </div>
              <div className="text-[10px] text-muted-foreground">
                {money(change.first)} → {money(change.last)}
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-36 animate-pulse rounded-md bg-muted/40" />
        ) : series.length < 2 ? (
          <div className="flex h-36 items-center justify-center text-center text-sm text-muted-foreground">
            {series.length === 0
              ? "No portfolio history yet. Your first snapshot will land tonight at 14:00 UTC."
              : "Need at least 2 days of history to plot a trend. Check back tomorrow."}
          </div>
        ) : (
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={series}
                margin={{ top: 5, right: 5, left: 0, bottom: 5 }}
              >
                <defs>
                  <linearGradient
                    id="portfolio-gradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={strokeColor}
                      stopOpacity={0.25}
                    />
                    <stop
                      offset="100%"
                      stopColor={strokeColor}
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={60}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`
                  }
                  domain={["auto", "auto"]}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="totalValue"
                  stroke={strokeColor}
                  strokeWidth={2}
                  fill="url(#portfolio-gradient)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
