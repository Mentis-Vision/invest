// src/components/dashboard/year-outlook/monte-carlo-card.tsx
//
// Server component. Composes the Monte-Carlo loader with the fan-
// chart client island. Headline number is the 10,000-path success
// probability (paths whose terminal value reaches the user's
// targetWealth by targetDate / total paths).
//
// Empty-state convention:
//   - No goals row → render a goals-setup hint, no chart.
//   - Insufficient history (<50 days from portfolio AND benchmark)
//     → render a hint about the warehouse warming up.
//   - Otherwise render success% + p10/p25/p50/p75/p90 grid + fan
//     chart with a horizontal target reference line.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonteCarloFanChart } from "./monte-carlo-fan-chart";
import type { MonteCarloLoaderResult } from "@/lib/dashboard/metrics/monte-carlo-loader";

interface MonteCarloCardProps {
  result: MonteCarloLoaderResult | null;
}

const TRADING_DAYS_PER_YEAR = 252;

function fmtDollarsShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

interface PercentileCellProps {
  label: string;
  value: number;
  highlight?: boolean;
}

function PercentileCell({ label, value, highlight }: PercentileCellProps) {
  return (
    <div
      className={`rounded border bg-card p-2 ${
        highlight ? "border-foreground" : "border-border"
      }`}
    >
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="text-base font-bold tabular-nums">
        {fmtDollarsShort(value)}
      </div>
    </div>
  );
}

export function MonteCarloCard({ result }: MonteCarloCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Retirement probability (10k-path Monte Carlo)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {result ? <ResultBody result={result} /> : <EmptyState />}
        <p className="text-[10px] text-muted-foreground">
          Bootstrap simulation against your goal. Past returns do not
          guarantee future results. Informational only, not investment
          advice.
        </p>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="text-xs text-muted-foreground">
      Set a target wealth and target date in your goals to run the
      simulation. The bootstrap also needs at least 50 days of aligned
      portfolio history — if your warehouse is still warming up,
      check back in a few sessions.
    </div>
  );
}

function ResultBody({ result }: { result: MonteCarloLoaderResult }) {
  const successPct = result.successProbability;
  const successColor =
    successPct >= 0.8
      ? "var(--buy)"
      : successPct >= 0.5
        ? "var(--decisive)"
        : "var(--sell)";

  const fanData =
    result.paths !== null
      ? result.paths.p10.map((point, i) => ({
          year: point.day / TRADING_DAYS_PER_YEAR,
          p10: point.value,
          p50: result.paths!.p50[i]?.value ?? point.value,
          p90: result.paths!.p90[i]?.value ?? point.value,
        }))
      : [];

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Probability of meeting target
          </div>
          <div className="text-3xl font-bold tabular-nums" style={{ color: successColor }}>
            {fmtPct(successPct)}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Target {fmtDollarsShort(result.targetValue)} in{" "}
          {result.yearsRemaining.toFixed(1)} years from{" "}
          {fmtDollarsShort(result.currentValue)} today
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        <PercentileCell label="p10" value={result.percentiles.p10} />
        <PercentileCell label="p25" value={result.percentiles.p25} />
        <PercentileCell label="p50" value={result.percentiles.p50} highlight />
        <PercentileCell label="p75" value={result.percentiles.p75} />
        <PercentileCell label="p90" value={result.percentiles.p90} />
      </div>
      {fanData.length > 0 ? (
        <MonteCarloFanChart data={fanData} targetValue={result.targetValue} />
      ) : null}
      <p className="text-[10px] text-muted-foreground">
        {result.meta.paths.toLocaleString("en-US")} paths, bootstrapped from{" "}
        {result.source === "portfolio"
          ? `${result.meta.sampleSize} days of your portfolio history`
          : `${result.meta.sampleSize} days of SPY benchmark history (your portfolio history is still warming up)`}
        .
      </p>
    </>
  );
}
