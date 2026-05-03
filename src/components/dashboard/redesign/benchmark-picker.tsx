"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BENCHMARK_PRESETS } from "@/lib/dashboard/benchmark-resolver";

const MAX = 4;

const SECTIONS: { title: string; keys: string[] }[] = [
  { title: "Major indices", keys: ["sp500", "nasdaq", "dow", "russell2000", "msci_world"] },
  { title: "Diversified portfolios", keys: ["vti", "60-40"] },
  {
    title: "Sector ETFs",
    keys: ["xlk", "xlf", "xlv", "xle", "xly", "xlp", "xli", "xlb", "xlu", "xlre", "xlc"],
  },
];

export function BenchmarkPickerLauncher({
  initialKeys,
}: {
  initialKeys: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] border border-dashed border-[var(--decisive)] text-[var(--decisive)] px-2 py-0.5 rounded-lg"
      >
        + benchmark
      </button>
      {open && (
        <BenchmarkPicker
          initialKeys={initialKeys}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function BenchmarkPicker({
  initialKeys,
  onClose,
}: {
  initialKeys: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>(initialKeys);
  const [customTicker, setCustomTicker] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggle(key: string) {
    setError(null);
    setSelected((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX) {
        setError(`Max ${MAX} active. Deselect one to add another.`);
        return prev;
      }
      return [...prev, key];
    });
  }

  async function addCustom() {
    setError(null);
    const t = customTicker.trim().toUpperCase();
    if (!t) return;
    if (selected.includes(t)) {
      setError("Already in your list.");
      return;
    }
    if (selected.length >= MAX) {
      setError(`Max ${MAX} active. Deselect one to add another.`);
      return;
    }
    const res = await fetch(`/api/benchmarks/validate?ticker=${encodeURIComponent(t)}`);
    const data = (await res.json().catch(() => ({}))) as {
      valid?: boolean;
      historyDays?: number;
    };
    if (!data.valid) {
      setError(
        `Need ≥30 days of price history. Have ${data.historyDays ?? 0} day(s).`,
      );
      return;
    }
    setSelected((prev) => [...prev, t]);
    setCustomTicker("");
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/user/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ benchmarks: selected }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `save failed: ${res.status}`);
      }
      startTransition(() => router.refresh());
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-md p-5 w-full max-w-md max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-bold mb-3">Compare your portfolio to…</div>
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-3">
            <div className="text-[10px] tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">
              {section.title}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {section.keys.map((key) => {
                const isSelected = selected.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggle(key)}
                    className={`text-[10px] px-2 py-1 rounded-lg ${
                      isSelected
                        ? "bg-[var(--foreground)] text-[var(--background)] font-bold"
                        : "bg-[var(--card)] border border-[var(--border)]"
                    }`}
                  >
                    {BENCHMARK_PRESETS[key]?.label ?? key.toUpperCase()}
                    {isSelected && " ✓"}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="border-t border-[var(--border)] pt-3 mt-3">
          <div className="text-[10px] tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">
            Custom ticker
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="ARKK or BTC-USD"
              value={customTicker}
              onChange={(e) => setCustomTicker(e.target.value.toUpperCase())}
              className="text-xs border border-[var(--border)] px-2 py-1 rounded flex-1"
            />
            <button
              onClick={addCustom}
              className="text-[10px] text-[var(--decisive)] border border-[var(--decisive)] px-2 py-1 rounded"
            >
              + add
            </button>
          </div>
          {selected.filter((k) => !BENCHMARK_PRESETS[k]).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {selected
                .filter((k) => !BENCHMARK_PRESETS[k])
                .map((k) => (
                  <button
                    key={k}
                    onClick={() => toggle(k)}
                    className="text-[10px] bg-[var(--foreground)] text-[var(--background)] px-2 py-1 rounded-lg font-bold"
                  >
                    {k} ✓
                  </button>
                ))}
            </div>
          )}
        </div>
        {error && (
          <div role="alert" className="text-[11px] text-[var(--sell)] mt-3">
            {error}
          </div>
        )}
        <div className="flex justify-between items-center mt-4">
          <div className="text-[10px] text-[var(--muted-foreground)] italic">
            Up to {MAX} active. Saved to your profile.
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={onClose}
              className="text-xs border border-[var(--border)] px-3 py-1.5 rounded"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || selected.length === 0}
              className="bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
