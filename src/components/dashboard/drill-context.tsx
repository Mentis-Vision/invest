"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Holding } from "@/lib/client/holdings-cache";

/**
 * Drill-down target: every clickable data point on the dashboard resolves
 * to one of these shapes. The right-side Sheet dispatches on `kind` to
 * render typed content.
 *
 * Intentionally discriminated so downstream switch-statements are
 * exhaustive — adding a new kind forces everyone to handle it.
 */
export type DrillTarget =
  | { kind: "ticker"; ticker: string }
  | { kind: "allocation"; bucket: string; holdings: Holding[]; totalValue: number }
  | { kind: "position"; holding: Holding }
  | {
      kind: "kpi";
      metric:
        | "total_value"
        | "day_change"
        | "period_change"
        | "hit_rate"
        | "positions"
        | "alerts_active"
        | "cash_share";
      label: string;
      valueLabel: string;
    }
  | { kind: "alert"; alertId: string; ticker: string | null; title: string }
  | { kind: "macro"; indicator: string; label: string };

type DrillContextValue = {
  target: DrillTarget | null;
  open: (target: DrillTarget) => void;
  close: () => void;
};

const DrillContext = createContext<DrillContextValue | null>(null);

export function DrillProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<DrillTarget | null>(null);
  const open = useCallback((t: DrillTarget) => setTarget(t), []);
  const close = useCallback(() => setTarget(null), []);
  const value = useMemo(() => ({ target, open, close }), [target, open, close]);
  return <DrillContext.Provider value={value}>{children}</DrillContext.Provider>;
}

export function useDrill(): DrillContextValue {
  const ctx = useContext(DrillContext);
  if (!ctx)
    throw new Error("useDrill() must be used inside a <DrillProvider>");
  return ctx;
}

/**
 * Tiny wrapper for turning any element into a drillable control.
 * Adds a trailing "↗" arrow on hover, underline-on-hover, and keyboard
 * accessibility. Use this EVERYWHERE a data point should be explorable.
 */
export function Drillable({
  target,
  children,
  className = "",
  as = "button",
  ariaLabel,
}: {
  target: DrillTarget;
  children: ReactNode;
  className?: string;
  as?: "button" | "span";
  ariaLabel?: string;
}) {
  const { open } = useDrill();
  const handle = useCallback(() => open(target), [open, target]);

  const base =
    "group relative cursor-pointer inline-flex items-baseline gap-1 " +
    "text-left transition-colors duration-150 " +
    "hover:text-[var(--buy)] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--buy)]/50 " +
    "focus-visible:rounded-sm";

  if (as === "span") {
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={handle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handle();
          }
        }}
        aria-label={ariaLabel}
        className={`${base} ${className}`}
      >
        {children}
        <span
          aria-hidden
          className="ml-0.5 inline-block translate-y-[1px] opacity-0 transition-all duration-150 group-hover:opacity-60 text-[0.7em]"
        >
          ↗
        </span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handle}
      aria-label={ariaLabel}
      className={`${base} ${className}`}
    >
      {children}
      <span
        aria-hidden
        className="ml-0.5 inline-block translate-y-[1px] opacity-0 transition-all duration-150 group-hover:opacity-60 text-[0.7em]"
      >
        ↗
      </span>
    </button>
  );
}
