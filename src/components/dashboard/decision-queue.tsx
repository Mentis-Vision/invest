// src/components/dashboard/decision-queue.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { QueueItem, HorizonTag } from "@/lib/dashboard/types";
import { HorizonChip } from "./horizon-chip";
import { LayeredChipRow } from "./layered-chip-row";

const BORDER: Record<HorizonTag, string> = {
  TODAY: "border-l-[var(--sell)]",
  THIS_WEEK: "border-l-[var(--decisive)]",
  THIS_MONTH: "border-l-[var(--hold)]",
  THIS_YEAR: "border-l-[var(--buy)]",
};

export function DecisionQueue({ items }: { items: QueueItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ itemKey: string; action: string; message: string } | null>(null);

  const counts: Record<HorizonTag, number> = {
    TODAY: 0,
    THIS_WEEK: 0,
    THIS_MONTH: 0,
    THIS_YEAR: 0,
  };
  for (const i of items) counts[i.horizon]++;

  async function act(itemKey: string, action: "snooze" | "dismiss" | "done") {
    setBusy(`${itemKey}:${action}`);
    setError(null);
    try {
      const res = await fetch(`/api/queue/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey }),
      });
      if (!res.ok) throw new Error(`${action} failed: ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError({ itemKey, action, message: String(err) });
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-6 text-center text-sm text-[var(--muted-foreground)]">
        <p className="mb-1">Decision queue is empty.</p>
        <p className="text-xs">
          All clear. Use the dashboard below to review your portfolio,
          or run new research from the top nav.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-4">
      <div className="flex justify-between items-center mb-3">
        <div className="text-[11px] tracking-widest uppercase text-[var(--hold)] font-bold">
          Decision Queue · {items.length} open
        </div>
        <div className="flex gap-1">
          {(Object.keys(counts) as HorizonTag[])
            .filter((h) => counts[h] > 0)
            .map((h) => (
              <span key={h} className="text-[9px]">
                <HorizonChip horizon={h} />
                <span className="ml-1 text-[var(--muted-foreground)]">{counts[h]}</span>
              </span>
            ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.itemKey}
            className={`border border-[var(--border)] border-l-4 ${BORDER[item.horizon]} p-3 rounded`}
          >
            <div className="flex justify-between items-start mb-1">
              <div className="text-sm font-bold">{item.title}</div>
              <HorizonChip horizon={item.horizon} />
            </div>
            <div className="text-xs text-[var(--muted-foreground)] mb-2">{item.body}</div>
            <LayeredChipRow chips={item.chips} />
            <div className="mt-2 flex gap-2 flex-wrap">
              <button
                onClick={() => router.push(item.primaryActionHref)}
                className="text-[10px] border border-[var(--foreground)] bg-[var(--background)] px-2 py-1 rounded"
              >
                {item.primaryActionLabel}
              </button>
              <button
                onClick={() => act(item.itemKey, "snooze")}
                disabled={busy !== null}
                className="text-[10px] border border-[var(--border)] px-2 py-1 rounded disabled:opacity-50"
              >
                Snooze 1d
              </button>
              <button
                onClick={() => act(item.itemKey, "dismiss")}
                disabled={busy !== null}
                className="text-[10px] border border-[var(--border)] text-[var(--muted-foreground)] px-2 py-1 rounded disabled:opacity-50"
              >
                Dismiss
              </button>
              {item.itemType === "outcome_action_mark" && (
                <button
                  onClick={() => act(item.itemKey, "done")}
                  disabled={busy !== null}
                  className="text-[10px] border border-[var(--buy)] text-[var(--buy)] px-2 py-1 rounded disabled:opacity-50"
                >
                  Mark done
                </button>
              )}
              {error?.itemKey === item.itemKey && (
                <span role="alert" className="text-[10px] text-[var(--sell)] self-center">
                  Couldn&apos;t {error.action}. Try again.
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
