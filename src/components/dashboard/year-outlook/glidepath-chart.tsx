"use client";

// src/components/dashboard/year-outlook/glidepath-chart.tsx
//
// Client island for the GlidepathVisualizer's donut. Outer ring is the
// actual stocks/bonds/cash split, inner ring is the target — the
// difference is what the parent's textual drift label calls out.
//
// When `actual` is null (allocation unknown — no holdings or only
// cash), we render only the target ring with a faded note in the
// caller's layout.

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import type { TargetAllocation } from "@/lib/dashboard/goals";

interface GlidepathChartProps {
  actual: TargetAllocation | null;
  target: TargetAllocation;
}

const STOCK_COLOR = "var(--buy)";
const BONDS_COLOR = "var(--decisive)";
const CASH_COLOR = "var(--muted-foreground)";

type DonutSlice = { name: string; value: number; color: string };

function buildSlices(triple: TargetAllocation): DonutSlice[] {
  return [
    { name: "Stocks", value: triple.stocksPct, color: STOCK_COLOR },
    { name: "Bonds", value: triple.bondsPct, color: BONDS_COLOR },
    { name: "Cash", value: triple.cashPct, color: CASH_COLOR },
  ];
}

type TooltipPayloadEntry = {
  name?: string;
  value?: number | string;
  payload?: DonutSlice;
};
type TooltipRenderProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
};

function ChartTooltip(props: TooltipRenderProps) {
  const entry = props.payload?.[0];
  if (!props.active || !entry?.payload) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold">{entry.payload.name}</div>
      <div className="font-mono">{entry.payload.value.toFixed(0)}%</div>
    </div>
  );
}

export function GlidepathChart({ actual, target }: GlidepathChartProps) {
  const targetSlices = buildSlices(target);
  const actualSlices = actual ? buildSlices(actual) : null;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<ChartTooltip />} />
          {/*
            Inner ring = TARGET. Slightly desaturated via lower opacity
            so the actual ring on the outside reads as the foreground.
          */}
          <Pie
            data={targetSlices}
            dataKey="value"
            nameKey="name"
            innerRadius={32}
            outerRadius={56}
            startAngle={90}
            endAngle={-270}
            stroke="var(--card)"
            isAnimationActive={false}
          >
            {targetSlices.map((s) => (
              <Cell
                key={`tgt-${s.name}`}
                fill={s.color}
                fillOpacity={0.4}
              />
            ))}
          </Pie>
          {actualSlices && (
            <Pie
              data={actualSlices}
              dataKey="value"
              nameKey="name"
              innerRadius={64}
              outerRadius={88}
              startAngle={90}
              endAngle={-270}
              stroke="var(--card)"
              isAnimationActive={false}
            >
              {actualSlices.map((s) => (
                <Cell key={`act-${s.name}`} fill={s.color} />
              ))}
            </Pie>
          )}
          <Legend
            verticalAlign="bottom"
            iconSize={8}
            wrapperStyle={{ fontSize: 11 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
