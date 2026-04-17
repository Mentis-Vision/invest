"use client";

import { DrillHeader, DrillBody, DrillSection } from "./panel-shell";

/**
 * Macro indicator drill-down — currently a minimal explainer. Pending
 * follow-up: pull historical FRED series from /api/macro and render
 * a sparkline so users can see the trend, not just today's value.
 */
const EXPLAINERS: Record<string, { title: string; story: string }> = {
  CPIAUCSL: {
    title: "Consumer Price Index",
    story:
      "Broad headline inflation. When CPI is persistently above ~3%, bonds " +
      "repricing is the usual first-order effect — equity multiples compress " +
      "because the discount rate is higher. We surface the 12-month delta " +
      "rather than the raw index because the raw number is an arbitrary 1982 baseline.",
  },
  UNRATE: {
    title: "Unemployment rate",
    story:
      "Labor-market tightness. Sustained UNRATE below 4% often precedes wage-driven " +
      "inflation; sharp jumps above 4.5% are historically one of the earliest " +
      "recession signals. Leading indicator for consumer-discretionary and " +
      "small-cap sectors in particular.",
  },
  DGS10: {
    title: "10-Year Treasury yield",
    story:
      "The benchmark discount rate. Growth stocks (high future earnings) are most " +
      "sensitive — a 100bp rise in 10Y yields typically compresses long-duration " +
      "equity multiples 10–15%. Watch the spread vs the 2Y yield for the " +
      "classic recession-forecasting inversion.",
  },
};

export function DrillMacro({
  indicator,
  label,
}: {
  indicator: string;
  label: string;
}) {
  const copy = EXPLAINERS[indicator];
  return (
    <>
      <DrillHeader
        eyebrow="Macro indicator"
        title={<span>{copy?.title ?? label}</span>}
        subtitle={
          <span className="font-mono text-[10px] uppercase tracking-widest opacity-70">
            {indicator} · FRED
          </span>
        }
      />
      <DrillBody>
        <DrillSection label="Why it matters">
          <p className="text-sm leading-relaxed text-[var(--foreground)]">
            {copy?.story ??
              "This indicator is part of the macro context the analyst panel " +
                "receives before weighing a recommendation."}
          </p>
        </DrillSection>
        <DrillSection label="Data source">
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            St. Louis Fed FRED. Values update daily (or at release cadence for
            monthly series). We pull the latest reading and the 12-month
            delta — no real-time streaming, no intraday churn.
          </p>
        </DrillSection>
      </DrillBody>
    </>
  );
}
