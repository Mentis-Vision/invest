// src/components/dashboard/year-outlook/pacing-card.tsx
//
// Server component (with a thin client island for the recharts plot).
// Composes:
//
//   - hasPacingInputs gate → empty-state CTA when goals incomplete
//   - pacingProjection from goals.ts → projected value, gap, required
//     CAGR, years remaining
//   - formatPacingNarrative from year-outlook.ts → the four display
//     lines the card lays out
//   - buildProjectionSeries → sample series for the trajectory chart
//
// The chart itself ships in a sibling `pacing-chart.tsx` because
// recharts is client-only. Server component owns the math + layout
// and passes the already-shaped series down as props.

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { pacingProjection } from "@/lib/dashboard/goals";
import {
  formatPacingNarrative,
  buildProjectionSeries,
  hasPacingInputs,
} from "@/lib/dashboard/year-outlook";
import type { UserGoals } from "@/lib/dashboard/goals-loader";
import { PacingChart } from "./pacing-chart";

const TONE_VAR: Record<"buy" | "sell" | "muted", string> = {
  buy: "var(--buy)",
  sell: "var(--sell)",
  muted: "var(--muted-foreground)",
};

interface PacingCardProps {
  goals: UserGoals | null;
  /** Current invested portfolio value in dollars. */
  currentValue: number;
}

export function PacingCard({ goals, currentValue }: PacingCardProps) {
  if (!goals || !hasPacingInputs(goals) || goals.targetDate === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Long-horizon pacing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Set your target wealth, target date, and current age to see
            where your trajectory lands and the CAGR you&apos;d need to
            close the gap.
          </p>
          <Link href="/app/settings/goals" className={buttonVariants()}>
            Set goals
          </Link>
        </CardContent>
      </Card>
    );
  }

  const targetDate = new Date(goals.targetDate);
  const projection = pacingProjection(
    currentValue,
    goals.monthlyContribution ?? 0,
    goals.targetWealth ?? 0,
    targetDate,
    0.07,
  );
  const narrative = formatPacingNarrative(projection, goals.targetDate);
  const series = buildProjectionSeries(
    currentValue,
    goals.monthlyContribution ?? 0,
    projection.yearsRemaining,
    0.07,
  );
  const targetValue = goals.targetWealth ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Long-horizon pacing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div
            className="text-2xl font-bold tabular-nums"
            style={{ color: TONE_VAR[narrative.tone] }}
          >
            {narrative.headline}
          </div>
          <div
            className="text-sm font-medium"
            style={{ color: TONE_VAR[narrative.tone] }}
          >
            {narrative.status}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Required CAGR
            </div>
            <div className="font-semibold text-foreground">
              {narrative.cagrLine.replace(/^Required CAGR:\s*/, "")}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Horizon
            </div>
            <div className="font-semibold text-foreground">
              {narrative.yearsLine}
            </div>
          </div>
        </div>
        <PacingChart series={series} targetValue={targetValue} />
      </CardContent>
    </Card>
  );
}
