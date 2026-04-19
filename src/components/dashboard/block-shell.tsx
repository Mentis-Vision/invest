"use client";

import { useEffect, useState, type ReactNode } from "react";
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

/**
 * Returns the `gridColumn` value to apply. On viewports <1024px (lg
 * breakpoint in Tailwind), returns `span 1 / span 1` so the block
 * takes the full width of the 1-column mobile grid. On ≥1024px,
 * returns `span N / span N` based on the block's configured size.
 *
 * Uses matchMedia + a useEffect listener so resize between mobile
 * and desktop layouts takes effect immediately. Initial server
 * render uses the mobile fallback; client hydrates into whichever
 * matches the current viewport.
 */
function useDesktopGridSpan(size: BlockSize): string {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop ? `span ${size} / span ${size}` : "span 1 / span 1";
}

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
  // Hook at top-level — React's rules-of-hooks requires a stable
  // call position. Moved out of the inline style prop where it was
  // previously, which some React builds treat strictly enough to
  // surface as an error boundary trip ("This page couldn't load")
  // when the dropdown portal re-renders a sibling tree.
  const gridColumn = useDesktopGridSpan(size);

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
      className={`relative rounded-[10px] border bg-card p-4 transition-all ${
        editing
          ? "border-dashed border-primary/60 cursor-move"
          : "border-border"
      }`}
      style={{
        // Only apply size-based grid spans on ≥lg screens. On mobile
        // the parent grid is `grid-cols-1`, so without this the
        // inline style would force blocks into awkward multi-span
        // widths of a single-column grid. Value produced at the top
        // of the component via useDesktopGridSpan().
        gridColumn,
      }}
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
