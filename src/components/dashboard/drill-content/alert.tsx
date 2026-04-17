"use client";

import { DrillHeader, DrillBody, DrillSection, DrillFooterLink } from "./panel-shell";

/**
 * Alert detail. Minimal for now — surfaces the alert ID and a
 * research link. Real structured rendering (full alert_event row,
 * related context, dismiss action) will follow once the alerts
 * API exposes per-id GET.
 */
export function DrillAlert({
  alertId,
  ticker,
  title,
}: {
  alertId: string;
  ticker: string | null;
  title: string;
}) {
  return (
    <>
      <DrillHeader
        eyebrow="Alert"
        title={<span>{title}</span>}
        subtitle={
          <span className="font-mono tabular-nums text-[10px] uppercase tracking-widest opacity-70">
            id {alertId.slice(0, 8)}
          </span>
        }
      />
      <DrillBody>
        {ticker && (
          <DrillSection label="Related ticker">
            <DrillFooterLink
              href={`/app?view=research&ticker=${encodeURIComponent(ticker)}`}
            >
              Run research on {ticker}
            </DrillFooterLink>
          </DrillSection>
        )}
        <DrillSection label="What this means">
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            Alerts are generated overnight from free data sources (Yahoo
            price, SEC Form 4, portfolio concentration). They cost zero AI
            spend. Clicking <em>Run research</em> above is a paid AI query
            that asks the panel to weigh this signal in context.
          </p>
        </DrillSection>
      </DrillBody>
    </>
  );
}
