// src/components/dashboard/year-outlook/glidepath-visualizer.tsx
//
// Server component. Compares the user's actual stock allocation
// against the age-+-risk-tolerance glidepath target and renders a
// donut showing actual share with the target overlaid for reference.
//
// Empty-state branches:
//   - goals.currentAge or goals.riskTolerance missing → CTA card
//     pointing at /app/settings/goals
//   - allocation unknown (no holdings, only cash) → muted "Allocation
//     unknown" label, donut still renders the target ring

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { targetAllocation } from "@/lib/dashboard/goals";
import { computeGlidepathDrift } from "@/lib/dashboard/year-outlook";
import { getActualAllocationSplit } from "@/lib/dashboard/year-outlook-loader";
import type { UserGoals } from "@/lib/dashboard/goals-loader";
import { GlidepathChart } from "./glidepath-chart";

interface GlidepathVisualizerProps {
  userId: string;
  goals: UserGoals | null;
}

export async function GlidepathVisualizer({
  userId,
  goals,
}: GlidepathVisualizerProps) {
  const age = goals?.currentAge ?? null;
  const risk = goals?.riskTolerance ?? null;

  if (age === null || risk === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Allocation glidepath
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Set your age and risk tolerance to compute a target stocks /
            bonds / cash split — drift from target drives the
            rebalance prompt on your dashboard.
          </p>
          <Link href="/app/settings/goals" className={buttonVariants()}>
            Set goals
          </Link>
        </CardContent>
      </Card>
    );
  }

  const target = targetAllocation(age, risk);
  // Phase 4 Batch I: real bond/commodity classification via the static
  // ticker map. Bonds and cash now reflect actual holdings instead of
  // a target-ratio proxy.
  const actual = await getActualAllocationSplit(userId);
  const drift = computeGlidepathDrift(actual?.stocksPct ?? null, target);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Allocation glidepath
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <GlidepathChart actual={actual} target={target} />
        <div className="flex items-center justify-between text-xs">
          <div className="text-muted-foreground">
            Target ({age}yo · {risk}): {target.stocksPct}% / {target.bondsPct}%
            / {target.cashPct}%
          </div>
          <div className="font-semibold text-foreground">{drift.label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
