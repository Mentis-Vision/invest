"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, Check, Plus } from "lucide-react";
import {
  BLOCK_REGISTRY,
  ADD_CATALOG,
  BlockPlaceholder,
} from "./blocks";
import { BlockShell } from "./block-shell";
import type { BlockSize, LayoutBlock } from "@/lib/dashboard-layout";

/**
 * Customizable grid of dashboard blocks.
 *
 * Loads layout from /api/dashboard/layout (or the default fallback).
 * When the user enters edit mode (⚙ Customize), per-block resize and
 * hide controls appear, the blocks become HTML5-draggable, and an
 * "+ Add a section" panel slides in below the grid.
 *
 * Changes auto-save to the API via a debounced PATCH — the user never
 * has to hit a save button. Layout flicks back to server truth on
 * successful save.
 */

function labelSize(size: BlockSize): string {
  switch (size) {
    case 3: return "S";
    case 4: return "M";
    case 6: return "L";
    case 8: return "XL";
    case 12: return "Full";
  }
}

export default function BlockGrid() {
  const [layout, setLayout] = useState<LayoutBlock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const dragIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Debounced auto-save on any layout change after initial load.
  // 600ms is long enough that rapid clicks (resize → hide → resize)
  // coalesce into one save, short enough that a quick close-tab
  // still lands before the navigation.
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
    setLayout((cur) =>
      cur.map((b) => (b.id === id ? { ...b, size } : b))
    );
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
  function handleDragOver(_: string) {
    // no-op — reorder happens on drop
  }
  function handleDrop(targetId: string) {
    const srcId = dragIdRef.current;
    if (!srcId || srcId === targetId) return;
    setLayout((cur) => {
      const idxSrc = cur.findIndex((b) => b.id === srcId);
      const idxTgt = cur.findIndex((b) => b.id === targetId);
      if (idxSrc < 0 || idxTgt < 0) return cur;
      const next = [...cur];
      const [moved] = next.splice(idxSrc, 1);
      next.splice(idxTgt, 0, moved);
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
      {/* Customize toolbar — sits above the grid, right-aligned */}
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[12px] text-muted-foreground">
          {editing ? (
            <span>
              Editing — drag, resize, or hide blocks. Changes save
              automatically.
            </span>
          ) : (
            <span>&nbsp;</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing && (
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground/80 hover:border-primary/50 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Add section
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditing((v) => {
                if (v) setShowAdd(false);
                return !v;
              });
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
              editing
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-foreground/80 hover:border-primary/50 hover:text-foreground"
            }`}
          >
            {editing ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Done
              </>
            ) : (
              <>
                <Settings className="h-3.5 w-3.5" />
                Customize
              </>
            )}
          </button>
        </div>
      </div>

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
                <meta.Component />
              ) : (
                <BlockPlaceholder label={toTitle(b.id)} />
              )}
            </BlockShell>
          );
        })}
      </div>

      {/* Empty state — all blocks hidden */}
      {layout.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-border bg-card p-8 text-center">
          <p className="text-[14px] font-medium text-foreground">
            Your dashboard is empty.
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Hit Customize and add a section to get started.
          </p>
        </div>
      )}

      {/* Tiny footnote when editing */}
      {editing && (
        <div className="mt-6 text-center text-[11px] text-muted-foreground">
          Resize buttons (S/M/L/XL/Full) appear on each block. Drag any
          block to reorder. Changes save automatically.
        </div>
      )}
    </div>
  );
}

function toTitle(id: string): string {
  // Convert "tax-loss" → "Tax loss" for placeholder blocks.
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Used to ensure Tailwind emits the dynamic col-span classes.
// (JIT safety: these utility classes need to exist somewhere to
// survive PurgeCSS / Tailwind content scanning.)
// prettier-ignore
const _colSpanEmit = ["lg:col-span-3 lg:col-span-4 lg:col-span-6 lg:col-span-8 lg:col-span-12"];
void _colSpanEmit;

// Silence the unused-label warning by using labelSize in a no-op — it's
// exported-by-name for future use in tooltips.
void labelSize;
