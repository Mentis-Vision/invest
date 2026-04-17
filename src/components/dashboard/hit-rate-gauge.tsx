"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";

/**
 * Hit-rate gauge — a half-circle radial showing wins / evaluated.
 * Tone turns green at ≥60%, gold at 40–60%, wine below 40%.
 *
 * Links to /app/history?filter=losses so users can go straight to the
 * misses. Transparency > vanity.
 */

type Outcomes = {
  evaluated: number;
  wins: number;
  losses: number;
  flats: number;
  acted: number;
};

function toneFor(rate: number): { color: string; textClass: string } {
  if (rate >= 60) return { color: "#2D5F3F", textClass: "text-[var(--buy)]" };
  if (rate >= 40) return { color: "#9A7B3F", textClass: "text-[var(--hold)]" };
  return { color: "#8B1F2A", textClass: "text-[var(--sell)]" };
}

export default function HitRateGauge({
  outcomes,
  loading,
}: {
  outcomes: Outcomes | null;
  loading: boolean;
}) {
  const evaluated = outcomes?.evaluated ?? 0;
  const wins = outcomes?.wins ?? 0;
  const rate = evaluated > 0 ? (wins / evaluated) * 100 : 0;
  const { color, textClass } = toneFor(rate);

  const data = [{ name: "rate", value: rate, fill: color }];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-base">Hit rate</CardTitle>
          <Link
            href="/app/history"
            className="text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            See all →
          </Link>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Wins out of evaluated outcomes.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-40 animate-pulse rounded-md bg-muted/40" />
        ) : evaluated === 0 ? (
          <div className="flex h-40 items-center justify-center text-center text-sm text-muted-foreground">
            No outcomes evaluated yet.
            <br />
            <span className="text-[11px]">
              First checks run at 7 days.
            </span>
          </div>
        ) : (
          <div className="relative h-40">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                cx="50%"
                cy="100%"
                innerRadius="90%"
                outerRadius="140%"
                barSize={14}
                data={data}
                startAngle={180}
                endAngle={0}
              >
                <PolarAngleAxis
                  type="number"
                  domain={[0, 100]}
                  tick={false}
                />
                <RadialBar
                  background={{ fill: "var(--muted)" }}
                  dataKey="value"
                  cornerRadius={7}
                  isAnimationActive={false}
                />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end pb-2">
              <span
                className={`font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight ${textClass}`}
              >
                {rate.toFixed(0)}%
              </span>
              <span className="mt-1 text-[10px] text-muted-foreground">
                {wins} of {evaluated}
                {outcomes && outcomes.losses > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    <Link
                      href="/app/history?filter=losses"
                      className="underline-offset-4 hover:underline"
                    >
                      see the misses
                    </Link>
                  </>
                ) : null}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
