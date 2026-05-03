// src/components/dashboard/year-outlook/year-pace-headline.tsx
//
// Server component. Renders the top-of-page "Portfolio YTD vs SPY"
// headline for /app/year-outlook. Sources the same `ytdPct` /
// `benchYtdPct` numbers the year_pace_review queue item uses, so the
// surface agrees with the homepage card.
//
// Empty-state: when the warehouse has < 20 aligned daily samples,
// `getPortfolioRisk` returns null. We render "—" for both halves and
// a muted explanatory line, mirroring the RiskTile / VarTile
// convention.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface YearPaceHeadlineProps {
  /** Fractional YTD return — e.g. 0.052 = 5.2%. null when unavailable. */
  portfolioYtdPct: number | null;
  /** Same shape, computed on SPY. */
  benchYtdPct: number | null;
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const pct = n * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function toneFor(n: number | null): "buy" | "sell" | "muted" {
  if (n === null || !Number.isFinite(n) || n === 0) return "muted";
  return n > 0 ? "buy" : "sell";
}

const TONE_VAR: Record<"buy" | "sell" | "muted", string> = {
  buy: "var(--buy)",
  sell: "var(--sell)",
  muted: "var(--muted-foreground)",
};

export function YearPaceHeadline({
  portfolioYtdPct,
  benchYtdPct,
}: YearPaceHeadlineProps) {
  const portfolioTone = toneFor(portfolioYtdPct);
  const relTone =
    portfolioYtdPct !== null && benchYtdPct !== null
      ? toneFor(portfolioYtdPct - benchYtdPct)
      : "muted";
  const year = new Date().getUTCFullYear();
  const noData = portfolioYtdPct === null && benchYtdPct === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {year} year-pace
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Portfolio YTD
          </div>
          <div
            className="text-2xl font-bold tabular-nums"
            style={{ color: TONE_VAR[portfolioTone] }}
          >
            {fmtPct(portfolioYtdPct)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            SPY YTD
          </div>
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {fmtPct(benchYtdPct)}
          </div>
        </div>
        {!noData && (
          <div className="col-span-2 text-xs">
            <span className="text-muted-foreground">vs benchmark: </span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: TONE_VAR[relTone] }}
            >
              {portfolioYtdPct !== null && benchYtdPct !== null
                ? fmtPct(portfolioYtdPct - benchYtdPct)
                : "—"}
            </span>
          </div>
        )}
        {noData && (
          <p className="col-span-2 text-xs text-muted-foreground">
            Connect a brokerage and let the warehouse build at least 20
            days of aligned price history to populate YTD figures.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
