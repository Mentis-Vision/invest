// src/components/dashboard/year-outlook/macro-outlook.tsx
//
// Async server component. Composes the Phase 2 Batch D regime
// classifier with the Buffett indicator from macro-valuation. Same
// data the MarketRegimeTile uses on the homepage, just laid out for
// the year-outlook surface — bigger label, signal sub-row, and the
// Buffett band rendered as its own row instead of a footer chip.
//
// Empty-state: regime always returns a label (NEUTRAL when nothing is
// wired); Buffett may be null when FRED is down, in which case we
// hide the row entirely.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMarketRegime } from "@/lib/dashboard/metrics/regime-loader";
import { getMacroValuation } from "@/lib/dashboard/metrics/macro-valuation";
import type { RegimeLabel } from "@/lib/dashboard/metrics/regime";

const LABEL_DISPLAY: Record<RegimeLabel, string> = {
  RISK_ON: "Risk-on",
  NEUTRAL: "Neutral",
  FRAGILE: "Fragile",
  STRESS: "Stress",
};

const LABEL_COLOR: Record<RegimeLabel, string> = {
  RISK_ON: "var(--buy)",
  NEUTRAL: "var(--foreground)",
  FRAGILE: "var(--sell)",
  STRESS: "var(--sell)",
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
  if (days === 1) return "tomorrow";
  return `${days}d`;
}

export async function MacroOutlook() {
  const [regime, valuation] = await Promise.all([
    getMarketRegime(),
    getMacroValuation(),
  ]);
  const { signals, classification } = regime;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Macro outlook
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Market regime
          </div>
          <div
            className="text-2xl font-bold"
            style={{ color: LABEL_COLOR[classification.label] }}
          >
            {LABEL_DISPLAY[classification.label]}
          </div>
          {classification.reasons.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {classification.reasons.join(" · ")}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              VIX
            </div>
            <div className="font-semibold tabular-nums text-foreground">
              {fmtVix(signals.vixLevel)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              9D / VIX
            </div>
            <div className="font-semibold tabular-nums text-foreground">
              {fmtRatio(signals.vixTermRatio)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              FOMC
            </div>
            <div className="font-semibold tabular-nums text-foreground">
              {fmtFOMC(signals.daysToFOMC)}
            </div>
          </div>
        </div>
        {valuation.buffett !== null && (
          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between text-xs">
              <div>
                <span className="text-muted-foreground">Buffett indicator </span>
                <span className="font-semibold text-foreground tabular-nums">
                  {valuation.buffett.toFixed(2)}
                </span>
              </div>
              {valuation.buffettBand && (
                <span className="text-muted-foreground">
                  {valuation.buffettBand}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
