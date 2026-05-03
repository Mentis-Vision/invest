"use client";

// src/components/dashboard/year-outlook/pacing-chart.tsx
//
// Client island for the PacingCard's recharts trajectory plot. Kept
// thin: receives an already-shaped { year, value } series and a target
// value for the dashed horizontal reference. No business logic here —
// all math happens server-side in pacing-card.tsx + year-outlook.ts.

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
} from "recharts";
import type { ProjectionSeriesPoint } from "@/lib/dashboard/year-outlook";

interface PacingChartProps {
  series: ProjectionSeriesPoint[];
  /** Target wealth — drawn as a horizontal reference line. */
  targetValue: number;
}

function fmtAxisDollars(n: number): string {
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`;
  return `$${abs.toFixed(0)}`;
}

type TooltipPayloadEntry = { payload?: ProjectionSeriesPoint; value?: number };
type TooltipRenderProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
};

function ChartTooltip(props: TooltipRenderProps) {
  const p = props.payload?.[0]?.payload;
  if (!props.active || !p) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <div className="font-mono">{p.year}</div>
      <div className="font-semibold">{fmtAxisDollars(p.value)}</div>
    </div>
  );
}

export function PacingChart({ series, targetValue }: PacingChartProps) {
  if (series.length < 2) {
    return (
      <div className="text-xs text-muted-foreground">
        Trajectory will populate once a target date is set in the future.
      </div>
    );
  }
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={series}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        >
          <XAxis
            dataKey="year"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={fmtAxisDollars}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip content={<ChartTooltip />} />
          {targetValue > 0 && (
            <ReferenceLine
              y={targetValue}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
              label={{
                value: "target",
                position: "right",
                fontSize: 10,
                fill: "var(--muted-foreground)",
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--buy)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
