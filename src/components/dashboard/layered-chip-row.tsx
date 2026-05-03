// src/components/dashboard/layered-chip-row.tsx
"use client";

import { CHIP_DEFINITIONS } from "@/lib/dashboard/chip-definitions";
import type { QueueChip } from "@/lib/dashboard/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// NOTE: No <TooltipProvider> here — it is hoisted once to /app/page.tsx (Task 14)
// so every chip row across Headline + Queue items shares a single provider.

export function LayeredChipRow({
  chips,
  maxVisible = 5,
}: {
  chips: QueueChip[];
  maxVisible?: number;
}) {
  const visible = chips.slice(0, maxVisible);
  const overflow = chips.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((chip, idx) => {
        const def = chip.tooltipKey ? CHIP_DEFINITIONS[chip.tooltipKey] : undefined;
        const pill = (
          <span className="text-[10px] bg-[var(--background)] border border-[var(--border)] text-[var(--muted-foreground)] px-2 py-0.5 rounded-full whitespace-nowrap cursor-help">
            <span className="font-semibold mr-1">{chip.label}</span>
            {chip.value}
          </span>
        );
        return def ? (
          <Tooltip key={`${chip.label}-${idx}`}>
            <TooltipTrigger render={pill} />
            <TooltipContent className="max-w-xs text-xs">{def}</TooltipContent>
          </Tooltip>
        ) : (
          <span key={`${chip.label}-${idx}`}>{pill}</span>
        );
      })}
      {overflow > 0 && (
        <span className="text-[10px] text-[var(--muted-foreground)] px-2 py-0.5">
          +{overflow} more
        </span>
      )}
    </div>
  );
}
