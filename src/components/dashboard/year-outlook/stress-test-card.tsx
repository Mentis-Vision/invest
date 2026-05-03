// src/components/dashboard/year-outlook/stress-test-card.tsx
//
// Phase 4 Batch K5 — stress-test scenario card. Renders the user's
// projected portfolio drawdown under three historical replays
// (2008-09 GFC, 2020-Mar COVID, +100bps rates). Grayscale-to-red
// color ramp by severity so the worst-case scenario is visually
// loudest.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatStressReturn,
  type StressScenarioResult,
} from "@/lib/dashboard/metrics/stress-test";

interface Props {
  scenarios: StressScenarioResult[] | null;
  portfolioValue: number;
}

function severityColor(projected: number): string {
  // Negative drawdowns colored on a red ramp by magnitude.
  if (projected <= -0.4) return "var(--sell)";
  if (projected <= -0.2) return "var(--decisive)";
  if (projected < 0) return "var(--foreground)";
  return "var(--buy)";
}

function fmtDollarChange(projected: number, value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const dollar = projected * value;
  const abs = Math.abs(dollar);
  const sign = dollar < 0 ? "-" : "+";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function StressTestCard({ scenarios, portfolioValue }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Stress test
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {scenarios && scenarios.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {scenarios.map((s) => (
              <div
                key={s.label}
                className="rounded border border-border bg-card p-3"
              >
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {s.label}
                </div>
                <div
                  className="text-lg font-bold tabular-nums"
                  style={{ color: severityColor(s.projectedReturn) }}
                >
                  {formatStressReturn(s.projectedReturn)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {fmtDollarChange(s.projectedReturn, portfolioValue)} ·{" "}
                  {s.description}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Not enough portfolio history yet — stress projections
            require the Fama-French regression to converge, which
            needs roughly four months of aligned daily returns.
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          Projected returns apply hardcoded historical factor shocks
          (2008-09 GFC peak-to-trough, 2020-Mar COVID, rates +100bps)
          to your current Fama-French exposures. Alpha is excluded
          to avoid softening the bear-case. Informational only, not
          investment advice.
        </p>
      </CardContent>
    </Card>
  );
}
