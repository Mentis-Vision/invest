// src/components/dashboard/market-regime-tile.tsx
//
// Async server component. Renders the Phase 2 Market Regime composite
// (Batch D) — a single 4-bucket label (RISK_ON / NEUTRAL / FRAGILE /
// STRESS) with three signal sub-rows + a Buffett-indicator chip when
// available. Replaces the "Macro" placeholder tile that previously
// rendered an em-dash in /app/page.tsx.
//
// Empty-state convention: the regime classifier always returns a
// label (NEUTRAL when nothing is wired) and the tile always renders;
// individual signals show "—" when unavailable, matching the
// RiskTile pattern. We never throw on missing data — FRED outages
// degrade to "NEUTRAL" with empty reasons, not a crashed tile.

import { getMarketRegime } from "@/lib/dashboard/metrics/regime-loader";
import { getMacroValuation } from "@/lib/dashboard/metrics/macro-valuation";
import type { RegimeLabel } from "@/lib/dashboard/metrics/regime";

const LABEL_COLOR: Record<RegimeLabel, string> = {
  RISK_ON: "var(--buy)",
  NEUTRAL: "var(--foreground)",
  FRAGILE: "var(--sell)",
  STRESS: "var(--sell)",
};

const LABEL_DISPLAY: Record<RegimeLabel, string> = {
  RISK_ON: "Risk-on",
  NEUTRAL: "Neutral",
  FRAGILE: "Fragile",
  STRESS: "Stress",
};

function fmtVix(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

function fmtRatio(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function fmtFOMC(days: number): string {
  if (days >= 999) return "—";
  if (days === 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

function fmtBuffett(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export async function MarketRegimeTile() {
  // Both fetches are independent — run them in parallel so a slow
  // FRED leg doesn't gate the other.
  const [regime, valuation] = await Promise.all([
    getMarketRegime(),
    getMacroValuation(),
  ]);
  const { signals, classification } = regime;
  const labelColor = LABEL_COLOR[classification.label];

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded p-3">
      <div className="text-[10px] tracking-widest uppercase text-[var(--muted-foreground)] mb-2">
        Market Regime
      </div>
      <div
        className="text-center font-bold text-base mb-2"
        style={{ color: labelColor }}
      >
        {LABEL_DISPLAY[classification.label]}
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px] text-center">
        <div>
          <div className="text-[var(--muted-foreground)]">VIX</div>
          <div className="font-semibold text-[var(--foreground)]">
            {fmtVix(signals.vixLevel)}
          </div>
        </div>
        <div>
          <div className="text-[var(--muted-foreground)]">9D/VIX</div>
          <div className="font-semibold text-[var(--foreground)]">
            {fmtRatio(signals.vixTermRatio)}
          </div>
        </div>
        <div>
          <div className="text-[var(--muted-foreground)]">FOMC</div>
          <div className="font-semibold text-[var(--foreground)]">
            {fmtFOMC(signals.daysToFOMC)}
          </div>
        </div>
      </div>
      {valuation.buffett !== null && (
        <div className="mt-2 pt-2 border-t border-[var(--border)] flex items-center justify-between text-[10px]">
          <span className="text-[var(--muted-foreground)]">Buffett</span>
          <span className="font-semibold text-[var(--foreground)]">
            {fmtBuffett(valuation.buffett)}
            {valuation.buffettBand ? (
              <span className="ml-1 text-[var(--muted-foreground)]">
                · {valuation.buffettBand}
              </span>
            ) : null}
          </span>
        </div>
      )}
    </div>
  );
}
