"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Plus } from "lucide-react";
import { BLOCK_REGISTRY, ADD_CATALOG, BlockPlaceholder } from "./blocks";
import { BlockShell } from "./block-shell";
import type { BlockSize, LayoutBlock } from "@/lib/dashboard-layout";

/**
 * Customizable grid of dashboard blocks.
 *
 * Edit-mode is controlled from OUTSIDE this component (the dashboard
 * page wraps it with a single Customize button in the header).
 * Expose an imperative handle so the parent can toggle editing /
 * trigger an add-panel without the grid owning its own button.
 *
 * Drag-to-reorder uses the pointer X position within the target block:
 *   - Drop on left half  → insert BEFORE target
 *   - Drop on right half → insert AFTER target
 * That makes "drag a block past this one to push it further" actually
 * work, instead of only being able to slide blocks earlier in the list.
 *
 * Block size is passed to each Block component via a simple context
 * ticket — blocks that care about layout width read it and render
 * compact vs full layouts.
 */

export type BlockGridHandle = {
  /** Toggle edit mode from outside. */
  toggleEdit: () => void;
  /** Current edit state (for button styling). */
  isEditing: () => boolean;
  /** Open / close the add-section panel. */
  toggleAdd: () => void;
};

const BlockGrid = forwardRef<BlockGridHandle>(function BlockGrid(_, ref) {
  const [layout, setLayout] = useState<LayoutBlock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const dragIdRef = useRef<string | null>(null);
  const dropPositionRef = useRef<"before" | "after">("before");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    toggleEdit: () =>
      setEditing((v) => {
        if (v) setShowAdd(false);
        return !v;
      }),
    isEditing: () => editing,
    toggleAdd: () => setShowAdd((v) => !v),
  }));

  // Initial load from API
  useEffect(() => {
    let alive = true;
    fetch("/api/dashboard/layout")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const blocks = (d?.blocks ?? []) as LayoutBlock[];
        setLayout(blocks);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Debounced auto-save — 600ms after the last edit action.
  useEffect(() => {
    if (!loaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch("/api/dashboard/layout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: layout }),
      }).catch(() => {});
    }, 600);
  }, [layout, loaded]);

  function updateSize(id: string, size: BlockSize) {
    setLayout((cur) => cur.map((b) => (b.id === id ? { ...b, size } : b)));
  }
  function hideBlock(id: string) {
    setLayout((cur) => cur.filter((b) => b.id !== id));
  }
  function addBlock(id: string) {
    setLayout((cur) => {
      if (cur.some((b) => b.id === id)) return cur;
      const meta = BLOCK_REGISTRY[id];
      const defaultSize = meta?.defaultSize ?? (4 as BlockSize);
      return [...cur, { id, size: defaultSize }];
    });
    setShowAdd(false);
  }

  function handleDragStart(id: string) {
    dragIdRef.current = id;
  }
  function handleDragOver(id: string, e: React.DragEvent<HTMLElement>) {
    // Capture which half of the target the pointer is over — left =
    // insert-before, right = insert-after. Makes drag feel natural.
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    dropPositionRef.current = e.clientX < midpoint ? "before" : "after";
    void id;
  }
  function handleDrop(targetId: string) {
    const srcId = dragIdRef.current;
    if (!srcId || srcId === targetId) return;
    const position = dropPositionRef.current;
    setLayout((cur) => {
      const idxSrc = cur.findIndex((b) => b.id === srcId);
      const idxTgt = cur.findIndex((b) => b.id === targetId);
      if (idxSrc < 0 || idxTgt < 0) return cur;
      const next = [...cur];
      const [moved] = next.splice(idxSrc, 1);
      // After splice, the target's index shifts by 1 if src was before it.
      const adjustedTgt = idxSrc < idxTgt ? idxTgt - 1 : idxTgt;
      const insertAt = position === "after" ? adjustedTgt + 1 : adjustedTgt;
      next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, moved);
      return next;
    });
  }
  function handleDragEnd() {
    dragIdRef.current = null;
  }

  if (!loaded) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="col-span-12 h-40 animate-pulse rounded-[10px] bg-secondary/40 lg:col-span-6"
          />
        ))}
      </div>
    );
  }

  const availableToAdd = ADD_CATALOG.filter(
    (c) => !layout.some((b) => b.id === c.id)
  );

  return (
    <div>
      {/* Editing status bar — only visible in edit mode */}
      {editing && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[12px]">
          <span className="text-foreground/80">
            <span className="font-medium">Editing.</span> Drag, resize, or
            hide blocks — changes save automatically.
          </span>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground/80 hover:border-primary/50 hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            {showAdd ? "Hide add panel" : "Add section"}
          </button>
        </div>
      )}

      {/* Add-section panel */}
      {editing && showAdd && (
        <div className="mb-4 rounded-[10px] border border-dashed border-primary/50 bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
            <Plus className="h-3 w-3" />
            Add a section
          </div>
          {availableToAdd.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              You&rsquo;ve added everything. Remove a block first to add
              something different.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {availableToAdd.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => addBlock(c.id)}
                  title={c.description}
                  className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-[12px] text-foreground/80 transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The grid itself */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {layout.map((b) => {
          const meta = BLOCK_REGISTRY[b.id];
          return (
            <BlockShell
              key={b.id}
              id={b.id}
              title={meta?.title ?? toTitle(b.id)}
              hint={meta?.hint}
              size={b.size}
              editing={editing}
              onResize={(sz) => updateSize(b.id, sz)}
              onHide={() => hideBlock(b.id)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            >
              {meta ? (
                <meta.Component size={b.size} />
              ) : (
                <BlockPlaceholder label={toTitle(b.id)} />
              )}
            </BlockShell>
          );
        })}
      </div>

      {layout.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-border bg-card p-8 text-center">
          <p className="text-[14px] font-medium text-foreground">
            Your dashboard is empty.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Hit Customize in the header and add a section to get started.
          </p>
        </div>
      )}
    </div>
  );
});

export default BlockGrid;

function toTitle(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Used to ensure Tailwind emits the dynamic col-span classes.
// prettier-ignore
const _colSpanEmit = ["lg:col-span-3 lg:col-span-4 lg:col-span-6 lg:col-span-8 lg:col-span-12"];
void _colSpanEmit;
