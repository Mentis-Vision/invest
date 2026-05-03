// src/components/dashboard/year-outlook/risk-landscape.tsx
//
// Server component. Denser layout for the Phase 2 risk metrics — same
// numbers RiskTile + VarTile surface on the homepage, but reorganized
// into a single 8-cell grid for the year-outlook surface so the user
// sees the full risk picture without scrolling between two cards.
//
// Empty-state convention: each cell falls back to "—" when its
// upstream loader returned null. We never throw — a slow warehouse
// degrades to em-dashes, not a crashed page.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PortfolioRisk } from "@/lib/dashboard/metrics/risk";
import type { VarResult } from "@/lib/dashboard/metrics/var";

interface RiskLandscapeProps {
  risk: PortfolioRisk | null;
  varResult: VarResult | null;
  /** Total invested capital — drives VaR dollar exposure cells. */
  portfolioValue: number;
}

function fmtRatio(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) {
    return "—";
  }
  return n.toFixed(2);
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) {
    return "—";
  }
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtDollars(
  fraction: number | null | undefined,
  total: number,
): string {
  if (
    fraction === null ||
    fraction === undefined ||
    !Number.isFinite(fraction) ||
    fraction === 0 ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return "—";
  }
  const dollars = fraction * total;
  const sign = dollars < 0 ? "−" : "";
  return `${sign}$${Math.abs(Math.round(dollars)).toLocaleString("en-US")}`;
}

interface CellProps {
  label: string;
  value: string;
  subValue?: string;
  colorVar?: string;
}

function Cell({ label, value, subValue, colorVar }: CellProps) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className="text-lg font-bold tabular-nums"
        style={colorVar ? { color: `var(${colorVar})` } : undefined}
      >
        {value}
      </div>
      {subValue ? (
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {subValue}
        </div>
      ) : null}
    </div>
  );
}

export function RiskLandscape({
  risk,
  varResult,
  portfolioValue,
}: RiskLandscapeProps) {
  const sample = risk?.sampleSize ?? varResult?.sampleSize ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Risk landscape · {sample}d
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Cell label="Sharpe" value={fmtRatio(risk?.sharpe)} />
          <Cell label="Sortino" value={fmtRatio(risk?.sortino)} />
          <Cell
            label="Max DD"
            value={fmtPct(risk?.maxDrawdownPct)}
            colorVar="--sell"
          />
          <Cell label="β vs SPY" value={fmtRatio(risk?.beta)} />
          <Cell
            label="VaR 95 · 1d"
            value={fmtPct(varResult?.var95Daily, 2)}
            subValue={fmtDollars(varResult?.var95Daily, portfolioValue)}
            colorVar="--hold"
          />
          <Cell
            label="VaR 99 · 1d"
            value={fmtPct(varResult?.var99Daily, 2)}
            subValue={fmtDollars(varResult?.var99Daily, portfolioValue)}
            colorVar="--decisive"
          />
          <Cell
            label="CVaR 95"
            value={fmtPct(varResult?.cvar95Daily, 2)}
            subValue={fmtDollars(varResult?.cvar95Daily, portfolioValue)}
            colorVar="--sell"
          />
          <Cell
            label="VaR 95 · 1mo"
            value={fmtPct(varResult?.var95Monthly, 2)}
            subValue={fmtDollars(varResult?.var95Monthly, portfolioValue)}
            colorVar="--hold"
          />
        </div>
      </CardContent>
    </Card>
  );
}
