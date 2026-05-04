"use client";

import { useRef, useState } from "react";
import { Settings, Check } from "lucide-react";
import BlockGrid, { type BlockGridHandle } from "./block-grid";

/**
 * Client wrapper around BlockGrid that adds the Customize button.
 * BlockGrid itself expects the parent to provide one (per its header
 * comment) and exposes an imperative handle for toggling edit mode.
 *
 * Phase 7 mounted BlockGrid directly on /app/page.tsx (a server component)
 * which lost the Customize affordance. This restores it without needing
 * to make page.tsx a client component.
 */
export function CustomizableBlockGrid() {
  const ref = useRef<BlockGridHandle>(null);
  const [editing, setEditing] = useState(false);

  function handleClick() {
    ref.current?.toggleEdit();
    setEditing((v) => !v);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <button
          onClick={handleClick}
          className={
            editing
              ? "inline-flex items-center gap-1.5 rounded-md bg-[var(--foreground)] px-3 py-1.5 text-[12px] font-medium text-[var(--background)] hover:opacity-90"
              : "inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-[12px] font-medium text-foreground/80 hover:border-primary/50 hover:text-foreground"
          }
        >
          {editing ? (
            <>
              <Check className="h-3.5 w-3.5" /> Done
            </>
          ) : (
            <>
              <Settings className="h-3.5 w-3.5" /> Customize
            </>
          )}
        </button>
      </div>
      <BlockGrid ref={ref} />
    </div>
  );
}
