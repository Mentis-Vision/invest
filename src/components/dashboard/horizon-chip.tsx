// src/components/dashboard/horizon-chip.tsx
import type { HorizonTag } from "@/lib/dashboard/types";

const LABEL: Record<HorizonTag, string> = {
  TODAY: "TODAY",
  THIS_WEEK: "THIS WEEK",
  THIS_MONTH: "THIS MONTH",
  THIS_YEAR: "THIS YEAR",
};

const BG: Record<HorizonTag, string> = {
  TODAY: "bg-[var(--sell)]",
  THIS_WEEK: "bg-[var(--decisive)]",
  THIS_MONTH: "bg-[var(--hold)]",
  THIS_YEAR: "bg-[var(--buy)]",
};

export function HorizonChip({ horizon }: { horizon: HorizonTag }) {
  return (
    <span
      className={`text-[10px] tracking-wider font-bold uppercase text-white px-2 py-0.5 rounded-full ${BG[horizon]}`}
    >
      {LABEL[horizon]}
    </span>
  );
}
