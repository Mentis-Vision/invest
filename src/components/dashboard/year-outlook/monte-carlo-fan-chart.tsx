"use client";

// src/components/dashboard/year-outlook/monte-carlo-fan-chart.tsx
//
// Client island for the Monte-Carlo retirement card. Renders the
// p10 / p50 / p90 paths as three lines on a single recharts
// LineChart. The horizontal axis is years from today; the vertical
// axis is portfolio value in dollars.
//
// Empty / null parents handled in the wrapping server component —
// this file assumes it's only mounted when paths exist.

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";

interface FanChartPoint {
  year: number;
  p10: number;
  p50: number;
  p90: number;
}

interface MonteCarloFanChartProps {
  data: FanChartPoint[];
  targetValue: number;
}

function fmtDollarsShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

type TooltipPayloadEntry = {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string;
};
type TooltipRenderProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: number | string;
};

function ChartTooltip(props: TooltipRenderProps) {
  if (!props.active || !props.payload?.length) return null;
  const yr = typeof props.label === "number" ? props.label.toFixed(1) : props.label;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold">Year {yr}</div>
      {props.payload.map((entry) => {
        const v = typeof entry.value === "number" ? entry.value : Number(entry.value);
        return (
          <div key={entry.dataKey} className="font-mono" style={{ color: entry.color }}>
            {entry.name}: {fmtDollarsShort(v)}
          </div>
        );
      })}
    </div>
  );
}

export function MonteCarloFanChart(props: MonteCarloFanChartProps) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={props.data} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="year"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => `${v.toFixed(0)}y`}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 10 }}
          />
          <YAxis
            tickFormatter={fmtDollarsShort}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 10 }}
            width={50}
          />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine
            y={props.targetValue}
            stroke="var(--decisive)"
            strokeDasharray="4 4"
            label={{
              value: `target ${fmtDollarsShort(props.targetValue)}`,
              fill: "var(--decisive)",
              fontSize: 10,
              position: "insideTopRight",
            }}
          />
          <Line
            type="monotone"
            dataKey="p10"
            name="10th"
            stroke="var(--sell)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="p50"
            name="median"
            stroke="var(--foreground)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="p90"
            name="90th"
            stroke="var(--buy)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
