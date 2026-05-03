"use client";

// src/components/dashboard/chip-prefs-section.tsx
// Phase 3 Batch H — settings UI for the per-user chip preferences row.
//
// Lists every chip key from CHIP_DEFINITIONS with three states:
//
//   - SHOW   (default; rendered in normal layered chip row order)
//   - PIN    (rendered first, in pin order, before non-pinned chips)
//   - HIDE   (skipped at render)
//
// State persists to user_profile.chip_prefs via /api/chip-prefs.
// On save we round-trip through the API rather than optimistically
// mutating, so the next render reflects the actual stored value.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Pin, EyeOff, Eye } from "lucide-react";
import { CHIP_DEFINITIONS } from "@/lib/dashboard/chip-definitions";
import type { ChipPrefs } from "@/lib/dashboard/chip-prefs";

type State = "show" | "pin" | "hide";

function classifyState(
  key: string,
  prefs: ChipPrefs,
): State {
  if (prefs.hidden.includes(key)) return "hide";
  if (prefs.pinned.includes(key)) return "pin";
  return "show";
}

export default function ChipPrefsSection({
  initialPrefs,
}: {
  initialPrefs: ChipPrefs;
}) {
  // Internal state: a single map per chip key, deterministic across
  // renders. We rebuild pinned + hidden arrays only at save time so
  // the toggle clicks stay snappy and don't fight array re-orders.
  const [stateMap, setStateMap] = useState<Record<string, State>>(() => {
    const out: Record<string, State> = {};
    for (const key of Object.keys(CHIP_DEFINITIONS)) {
      out[key] = classifyState(key, initialPrefs);
    }
    return out;
  });

  // Pin order is preserved for keys that came in pinned originally,
  // and appended for keys newly pinned during this session.
  const [pinOrder, setPinOrder] = useState<string[]>(() =>
    initialPrefs.pinned.filter((k) => k in CHIP_DEFINITIONS),
  );

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setState(key: string, next: State) {
    setStateMap((prev) => ({ ...prev, [key]: next }));
    setSaved(false);
    setError(null);
    setPinOrder((prev) => {
      // Drop any newly-non-pinned key, append any newly-pinned key.
      const filtered = prev.filter((k) => k !== key);
      if (next === "pin") return [...filtered, key];
      return filtered;
    });
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const pinned = pinOrder.filter((k) => stateMap[k] === "pin");
    const hidden = Object.keys(stateMap).filter(
      (k) => stateMap[k] === "hide",
    );
    try {
      const res = await fetch("/api/chip-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned, hidden }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(json.error ?? `save failed: ${res.status}`);
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  const sortedKeys = Object.keys(CHIP_DEFINITIONS).sort();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chip preferences</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Pin the chips you most want to see, hide the ones you
          don&apos;t. Pinned chips render first on every layered chip
          row across the dashboard. Hidden chips are skipped entirely.
        </p>

        <div className="space-y-1">
          {sortedKeys.map((key) => {
            const def = CHIP_DEFINITIONS[key];
            const state = stateMap[key] ?? "show";
            return (
              <div
                key={key}
                className="flex items-start gap-3 rounded-md border border-border p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium font-mono">{key}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {def}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0" role="group" aria-label={`${key} visibility`}>
                  <button
                    type="button"
                    onClick={() => setState(key, "show")}
                    aria-pressed={state === "show"}
                    title="Show by default"
                    className={`px-2 py-1 rounded border text-xs transition-colors ${
                      state === "show"
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <Eye className="h-3 w-3 inline" /> Show
                  </button>
                  <button
                    type="button"
                    onClick={() => setState(key, "pin")}
                    aria-pressed={state === "pin"}
                    title="Pin to front of every chip row"
                    className={`px-2 py-1 rounded border text-xs transition-colors ${
                      state === "pin"
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <Pin className="h-3 w-3 inline" /> Pin
                  </button>
                  <button
                    type="button"
                    onClick={() => setState(key, "hide")}
                    aria-pressed={state === "hide"}
                    title="Hide from every chip row"
                    className={`px-2 py-1 rounded border text-xs transition-colors ${
                      state === "hide"
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <EyeOff className="h-3 w-3 inline" /> Hide
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving
              </>
            ) : (
              "Save preferences"
            )}
          </Button>
          {saved && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
