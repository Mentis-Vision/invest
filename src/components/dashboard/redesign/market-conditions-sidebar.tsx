import Link from "next/link";
import { AsOfFootnote } from "@/components/dashboard/as-of-footnote";

export type RegimeLabel = "RISK_ON" | "NEUTRAL" | "FRAGILE" | "STRESS";

const COLOR_FOR_REGIME: Record<RegimeLabel, string> = {
  RISK_ON: "var(--buy)",
  NEUTRAL: "var(--foreground)",
  FRAGILE: "var(--decisive)",
  STRESS: "var(--sell)",
};

const READABLE: Record<RegimeLabel, string> = {
  RISK_ON: "Risk On",
  NEUTRAL: "Neutral",
  FRAGILE: "Fragile",
  STRESS: "Stress",
};

export function MarketConditionsSidebar({
  label,
  vix,
  vixTermStructure,
  daysToFOMC,
  real10Y,
  asOf,
}: {
  label: RegimeLabel | null;
  vix: number | null;
  vixTermStructure: "contango" | "backwardation" | null;
  daysToFOMC: number | null;
  real10Y: number | null;
  asOf: string | null;
}) {
  if (!label) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-4">
        <div className="text-[10px] tracking-widest uppercase text-[var(--hold)] font-bold">
          Market conditions
        </div>
        <div className="text-xs text-[var(--muted-foreground)] mt-2">
          Macro signals unavailable. Try again later.
        </div>
      </div>
    );
  }

  const color = COLOR_FOR_REGIME[label];

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-4 flex flex-col gap-2">
      <div className="text-[10px] tracking-widest uppercase text-[var(--hold)] font-bold">
        Market conditions
      </div>
      <div
        className="text-lg font-bold italic"
        style={{ color, fontFamily: "Fraunces, Georgia, serif" }}
      >
        {READABLE[label]}
      </div>
      <div className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">
        {vix !== null && (
          <>
            VIX {vix.toFixed(1)}
            {vixTermStructure && ` · ${vixTermStructure}`}
            <br />
          </>
        )}
        {daysToFOMC !== null && daysToFOMC < 999 && (
          <>
            FOMC in {daysToFOMC}d
            <br />
          </>
        )}
        {real10Y !== null && (
          <>Real 10Y {real10Y >= 0 ? "+" : ""}{real10Y.toFixed(1)}%</>
        )}
      </div>
      <Link
        href="/app/year-outlook"
        className="text-[9px] text-[var(--hold)] mt-1"
      >
        view full outlook →
      </Link>
      <AsOfFootnote source="Macro signals" asOf={asOf ?? undefined} />
    </div>
  );
}
