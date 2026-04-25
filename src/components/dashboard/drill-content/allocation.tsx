"use client";

import { useMemo } from "react";
import type { Holding } from "@/lib/client/holdings-cache";
import { DrillHeader, DrillBody, DrillSection } from "./panel-shell";
import { money, moneyFull, pct } from "../format";
import { Drillable } from "../drill-context";
import { sumMoney } from "@/lib/money";

/**
 * Shows every holding that rolls up into the clicked allocation bucket
 * (sector or asset-class), ranked by market value. Each row is itself
 * drillable into a per-position panel.
 */
export function DrillAllocation({
  bucket,
  holdings,
  totalValue,
}: {
  bucket: string;
  holdings: Holding[];
  totalValue: number;
}) {
  const sorted = useMemo(
    () =>
      [...holdings].sort(
        (a, b) => effectiveValue(b) - effectiveValue(a)
      ),
    [holdings]
  );
  const bucketTotal = useMemo(
    () => sumMoney(...sorted.map((h) => effectiveValue(h))),
    [sorted]
  );
  const share = totalValue > 0 ? bucketTotal / totalValue : 0;

  return (
    <>
      <DrillHeader
        eyebrow="Allocation bucket"
        title={<span>{bucket}</span>}
        subtitle={
          <span className="font-mono tabular-nums">
            {moneyFull(bucketTotal)}{" "}
            <span className="text-[10px] uppercase tracking-wider opacity-70 ml-1">
              {pct(share)} of portfolio · {sorted.length} position
              {sorted.length === 1 ? "" : "s"}
            </span>
          </span>
        }
      />
      <DrillBody>
        <DrillSection
          label="Holdings in bucket"
          description="ranked by market value"
        >
          <ul className="divide-y divide-[var(--border)]">
            {sorted.map((h) => {
              const v = effectiveValue(h);
              const shareOfBucket = bucketTotal > 0 ? v / bucketTotal : 0;
              return (
                <li
                  key={`${h.ticker}-${h.accountName ?? ""}`}
                  className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 py-2 text-sm"
                >
                  <Drillable
                    target={{ kind: "position", holding: h }}
                    ariaLabel={`Open position detail for ${h.ticker}`}
                  >
                    <span className="font-mono font-medium">{h.ticker}</span>
                    <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                      {h.name}
                    </span>
                  </Drillable>
                  <span className="font-mono tabular-nums text-right">
                    {moneyFull(v)}
                  </span>
                  <span className="font-mono tabular-nums text-right text-xs text-[var(--muted-foreground)] w-[3.25rem]">
                    {pct(shareOfBucket)}
                  </span>
                </li>
              );
            })}
          </ul>
        </DrillSection>

        <DrillSection label="Concentration note">
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            This bucket accounts for{" "}
            <span className="font-mono text-[var(--foreground)]">
              {pct(share)}
            </span>{" "}
            of total portfolio value. Above 25% concentration triggers a
            dashboard alert; above 40% the system flags it as material
            idiosyncratic risk.
          </p>
        </DrillSection>
      </DrillBody>
    </>
  );
}

function effectiveValue(h: Holding): number {
  if (typeof h.value === "number" && Number.isFinite(h.value) && h.value > 0)
    return h.value;
  const shares = Number(h.shares) || 0;
  const price = Number(h.price) || 0;
  return shares * price;
}
