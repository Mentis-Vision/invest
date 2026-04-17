"use client";

import { useEffect } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useDrill } from "./drill-context";
import { DrillTicker } from "./drill-content/ticker";
import { DrillAllocation } from "./drill-content/allocation";
import { DrillPosition } from "./drill-content/position";
import { DrillKpi } from "./drill-content/kpi";
import { DrillAlert } from "./drill-content/alert";
import { DrillMacro } from "./drill-content/macro";

/**
 * Right-side slide-over that dispatches on target.kind and renders the
 * appropriate typed detail view. Closes on Escape (shadcn default) and
 * on outside click.
 *
 * The panel is wide (max-w-xl on mobile, 720px on desktop) so we have
 * room for real charts + tables. Keyboard focus returns to the trigger
 * on close via Radix's built-in focus management.
 */
export default function DrillPanel() {
  const { target, close } = useDrill();

  // Lock body scroll for the duration of the panel.
  useEffect(() => {
    if (!target) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [target]);

  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-[720px] p-0 bg-[var(--background)] border-l border-[var(--border)]"
      >
        <div className="flex h-full flex-col">{target && renderBody(target)}</div>
      </SheetContent>
    </Sheet>
  );
}

function renderBody(t: NonNullable<ReturnType<typeof useDrill>["target"]>) {
  switch (t.kind) {
    case "ticker":
      return <DrillTicker ticker={t.ticker} />;
    case "allocation":
      return (
        <DrillAllocation
          bucket={t.bucket}
          holdings={t.holdings}
          totalValue={t.totalValue}
        />
      );
    case "position":
      return <DrillPosition holding={t.holding} />;
    case "kpi":
      return (
        <DrillKpi metric={t.metric} label={t.label} valueLabel={t.valueLabel} />
      );
    case "alert":
      return (
        <DrillAlert
          alertId={t.alertId}
          ticker={t.ticker}
          title={t.title}
        />
      );
    case "macro":
      return <DrillMacro indicator={t.indicator} label={t.label} />;
  }
}
