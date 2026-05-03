// src/components/dashboard/var-tile.tsx
//
// Server component: pulls historical VaR / CVaR for the signed-in
// user and renders a 4-cell tile (VaR95 1d, VaR99 1d, CVaR95 1d,
// VaR95 1mo). Each cell shows percentage and a dollar exposure
// estimate scaled by the current portfolio value.
//
// When the warehouse has fewer than 20 days of aligned data,
// getPortfolioVaR returns null and every cell renders "—" — same
// convention as RiskTile / MarketRegimeTile, so the empty state is
// visually consistent across the context-tile row.
//
// Color coding follows the dashboard's verdict palette: VaR95 in
// `--hold` gold (caution), VaR99 in `--decisive` blue (escalate),
// CVaR in `--sell` red (worst-case tail loss).

import {
  getPortfolioVaR,
  getPortfolioValue,
} from "@/lib/dashboard/metrics/risk-loader";
import { AsOfFootnote } from "@/components/dashboard/as-of-footnote";

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) {
    return "—";
  }
  return `${(n * 100).toFixed(2)}%`;
}

function fmtDollars(fraction: number | null | undefined, total: number): string {
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
  // VaR is negative; render as a negative dollar amount with a
  // dollar sign and rounded to the nearest dollar for compactness.
  const dollars = fraction * total;
  const sign = dollars < 0 ? "−" : "";
  return `${sign}$${Math.abs(Math.round(dollars)).toLocaleString("en-US")}`;
}

interface VarCellProps {
  label: string;
  fraction: number | null | undefined;
  portfolioValue: number;
  colorVar: string;
}

function VarCell({ label, fraction, portfolioValue, colorVar }: VarCellProps) {
  const pct = fmtPct(fraction);
  const usd = fmtDollars(fraction, portfolioValue);
  return (
    <div className="text-center">
      <div className="text-[10px] text-[var(--muted-foreground)]">{label}</div>
      <div className="font-bold" style={{ color: `var(${colorVar})` }}>
        {pct}
      </div>
      <div className="text-[9px] text-[var(--muted-foreground)]">{usd}</div>
    </div>
  );
}

export async function VarTile({ userId }: { userId: string }) {
  // Both reads are independent — fan them out in parallel so the
  // tile doesn't serialize a sequential warehouse + holdings query.
  const [varResult, portfolioValue] = await Promise.all([
    getPortfolioVaR(userId),
    getPortfolioValue(userId),
  ]);
  const sample = varResult?.sampleSize ?? 0;
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded p-3">
      <div className="text-[10px] tracking-widest uppercase text-[var(--muted-foreground)] mb-2">
        Value at Risk · {sample}d
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <VarCell
          label="VaR 95 · 1d"
          fraction={varResult?.var95Daily}
          portfolioValue={portfolioValue}
          colorVar="--hold"
        />
        <VarCell
          label="VaR 99 · 1d"
          fraction={varResult?.var99Daily}
          portfolioValue={portfolioValue}
          colorVar="--decisive"
        />
        <VarCell
          label="CVaR 95"
          fraction={varResult?.cvar95Daily}
          portfolioValue={portfolioValue}
          colorVar="--sell"
        />
        <VarCell
          label="VaR 95 · 1mo"
          fraction={varResult?.var95Monthly}
          portfolioValue={portfolioValue}
          colorVar="--hold"
        />
      </div>
      <AsOfFootnote
        source={`Warehouse · ${sample}d sample`}
        asOf={varResult?.asOf ?? null}
      />
    </div>
  );
}
