// src/components/dashboard/year-outlook/behavioral-audit-card.tsx
//
// Phase 4 Batch K4 — server component rendering three behavioral
// audit sub-cards (home bias / concentration drift / recency chase).
// Each sub-card is independently null-tolerant; when all three
// readings are null we render a friendly empty-state.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  BehavioralAudit,
  HomeBiasLevel,
  ConcentrationTrend,
  RecencyChaseLevel,
} from "@/lib/dashboard/metrics/behavioral-audit";

interface Props {
  audit: BehavioralAudit;
}

const HOME_BIAS_COLOR: Record<HomeBiasLevel, string> = {
  neutral: "var(--foreground)",
  moderate: "var(--decisive)",
  extreme: "var(--sell)",
};

const CONCENTRATION_COLOR: Record<ConcentrationTrend, string> = {
  stable: "var(--foreground)",
  rising: "var(--sell)",
  falling: "var(--buy)",
};

const RECENCY_COLOR: Record<RecencyChaseLevel, string> = {
  low: "var(--buy)",
  moderate: "var(--decisive)",
  high: "var(--sell)",
};

function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtPp(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}pp`;
}

export function BehavioralAuditCard({ audit }: Props) {
  const { homeBias, concentrationDrift, recencyChase } = audit;
  const allNull =
    homeBias === null && concentrationDrift === null && recencyChase === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Behavioral self-audit
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {allNull ? (
          <div className="text-xs text-muted-foreground">
            Not enough portfolio history yet — behavioral signals
            require at least a month of holdings + a few recorded
            recommendations. Check back once the cron has filled in.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Home bias */}
            <div className="rounded border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Home bias
              </div>
              {homeBias ? (
                <>
                  <div
                    className="text-lg font-bold tabular-nums"
                    style={{ color: HOME_BIAS_COLOR[homeBias.level] }}
                  >
                    {fmtPct(homeBias.usShare, 0)} US
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {fmtPp(homeBias.deltaPp)} vs {fmtPct(homeBias.baseline, 0)}{" "}
                    global
                  </div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold tabular-nums">—</div>
                  <div className="text-[10px] text-muted-foreground">
                    no equity holdings
                  </div>
                </>
              )}
            </div>

            {/* Concentration drift */}
            <div className="rounded border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Top-3 sectors
              </div>
              {concentrationDrift ? (
                <>
                  <div
                    className="text-lg font-bold tabular-nums"
                    style={{
                      color: CONCENTRATION_COLOR[concentrationDrift.trend],
                    }}
                  >
                    {fmtPct(concentrationDrift.currentTop3, 0)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {fmtPp(concentrationDrift.deltaPp)} vs 12mo ·{" "}
                    {concentrationDrift.trend}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold tabular-nums">—</div>
                  <div className="text-[10px] text-muted-foreground">
                    snapshot history pending
                  </div>
                </>
              )}
            </div>

            {/* Recency chase */}
            <div className="rounded border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Recency chase
              </div>
              {recencyChase ? (
                <>
                  <div
                    className="text-lg font-bold tabular-nums"
                    style={{ color: RECENCY_COLOR[recencyChase.level] }}
                  >
                    {recencyChase.chaseCount}/{recencyChase.totalCount}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    BUYs into YTD-winners · {recencyChase.level}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold tabular-nums">—</div>
                  <div className="text-[10px] text-muted-foreground">
                    fewer than 3 evaluated recs
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          Behavioral signals are descriptive, not prescriptive — high
          home bias or recency-chase isn&rsquo;t automatically wrong if
          it matches a deliberate plan. Informational only, not
          investment advice.
        </p>
      </CardContent>
    </Card>
  );
}
