// src/components/dashboard/risk-tile.tsx
//
// Server component: pulls realized portfolio risk metrics for the
// signed-in user and renders a 4-cell tile (Sharpe / Sortino / Max DD /
// β vs SPY). When the warehouse has fewer than 20 days of aligned data
// for the user's holdings, getPortfolioRisk returns null and every
// cell renders "—" — same convention the placeholder tiles use, so
// the empty state is visually consistent with the macro / pace tiles
// that fill in later batches.

import { getPortfolioRisk } from "@/lib/dashboard/metrics/risk-loader";
import { AsOfFootnote } from "@/components/dashboard/as-of-footnote";

function fmtRatio(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(2);
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export async function RiskTile({ userId }: { userId: string }) {
  const risk = await getPortfolioRisk(userId);
  const sample = risk?.sampleSize ?? 0;
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded p-3">
      <div className="text-[10px] tracking-widest uppercase text-[var(--muted-foreground)] mb-2">
        Portfolio Risk · {sample}d
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div className="text-center">
          <div className="text-[10px] text-[var(--muted-foreground)]">
            Sharpe
          </div>
          <div className="font-bold text-[var(--foreground)]">
            {risk ? fmtRatio(risk.sharpe) : "—"}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-[var(--muted-foreground)]">
            Sortino
          </div>
          <div className="font-bold text-[var(--foreground)]">
            {risk ? fmtRatio(risk.sortino) : "—"}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-[var(--muted-foreground)]">
            Max DD
          </div>
          <div className="font-bold text-[var(--sell)]">
            {risk ? fmtPct(risk.maxDrawdownPct) : "—"}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-[var(--muted-foreground)]">
            β vs SPY
          </div>
          <div className="font-bold text-[var(--foreground)]">
            {risk ? fmtRatio(risk.beta) : "—"}
          </div>
        </div>
      </div>
      <AsOfFootnote
        source={`Warehouse · ${sample}d sample`}
        asOf={risk?.asOf ?? null}
      />
    </div>
  );
}
