"use client";

import type { ReactNode } from "react";
import { GripVertical, X } from "lucide-react";
import type { BlockSize } from "@/lib/dashboard-layout";

/**
 * Shared chrome for every dashboard block.
 *
 * In view mode: just a white card with header + body.
 * In edit mode (editing=true):
 *   - dashed blue outline around the block
 *   - floating toolbar top-right with:
 *       · drag handle (⋮⋮) → draggable via HTML5 DnD at the block level
 *       · S / M / L / XL / Full pills → click to resize (onResize callback)
 *       · × hide → removes the block (onHide callback)
 *
 * The grid parent handles drag-drop — this component just renders the
 * grip icon. draggable="true" is set on the outer section so a user
 * can drag from anywhere inside the block, which is less fussy than
 * limiting drag to the grip handle.
 */

const SIZES: Array<{ v: BlockSize; label: string }> = [
  { v: 3, label: "S" },
  { v: 4, label: "M" },
  { v: 6, label: "L" },
  { v: 8, label: "XL" },
  { v: 12, label: "Full" },
];

export function BlockShell({
  id,
  title,
  hint,
  size,
  editing,
  onResize,
  onHide,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  children,
}: {
  id: string;
  title: string;
  hint?: ReactNode;
  size: BlockSize;
  editing: boolean;
  onResize?: (sz: BlockSize) => void;
  onHide?: () => void;
  onDragStart?: (id: string) => void;
  onDragOver?: (id: string, e: React.DragEvent<HTMLElement>) => void;
  onDrop?: (id: string) => void;
  onDragEnd?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      data-block-id={id}
      data-size={size}
      draggable={editing}
      onDragStart={(e) => {
        if (!editing) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        onDragStart?.(id);
      }}
      onDragOver={(e) => {
        if (!editing) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver?.(id, e);
      }}
      onDrop={(e) => {
        if (!editing) return;
        e.preventDefault();
        onDrop?.(id);
      }}
      onDragEnd={() => {
        if (!editing) return;
        onDragEnd?.();
      }}
      className={`col-span-12 lg:col-span-${size} relative rounded-[10px] border bg-card p-4 transition-all ${
        editing
          ? "border-dashed border-primary/60 cursor-move"
          : "border-border"
      }`}
      style={
        {
          // Tailwind's JIT doesn't always pick up dynamic col-span-N values.
          // Use CSS vars to force the grid-column-end to work.
          gridColumn: `span ${size} / span ${size}`,
        } as React.CSSProperties
      }
    >
      {editing && (
        <div className="absolute -top-3 right-3 z-[2] inline-flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-sm">
          <span
            aria-label="Drag"
            className="inline-flex h-6 w-5 cursor-grab items-center justify-center text-muted-foreground/60"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <div className="flex">
            {SIZES.map((s) => (
              <button
                key={s.v}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onResize?.(s.v);
                }}
                className={`h-6 rounded px-2 text-[10px] font-semibold tracking-wider transition-colors ${
                  s.v === size
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Hide"
            onClick={(e) => {
              e.stopPropagation();
              onHide?.();
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-foreground">
          {title}
        </h2>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}
