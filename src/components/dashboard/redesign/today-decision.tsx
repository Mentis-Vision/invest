"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { QueueItem } from "@/lib/dashboard/types";
import { LayeredChipRow } from "@/components/dashboard/layered-chip-row";

type Action = "snooze" | "dismiss";

export function TodayDecision({
  primary,
  others,
}: {
  primary: QueueItem | null;
  others: QueueItem[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function act(action: Action) {
    if (!primary) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/queue/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey: primary.itemKey }),
      });
      if (!res.ok) throw new Error(`${action} failed: ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(action);
      console.error("today-decision.action-failed", err);
    } finally {
      setBusy(null);
    }
  }

  if (!primary) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] border-l-4 border-l-[var(--decisive)] rounded-md p-5">
        <div className="text-[10px] tracking-widest uppercase text-[var(--decisive)] font-bold">
          Today&apos;s decision
        </div>
        <div className="text-base font-semibold mt-1.5">
          No urgent decisions right now.
        </div>
        <div className="text-xs text-[var(--muted-foreground)] mt-1">
          Browse research candidates or check the latest activity.
        </div>
        <div className="mt-3">
          <button
            onClick={() => router.push("/app?view=research")}
            className="bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded"
          >
            Open research
          </button>
        </div>
      </div>
    );
  }

  const total = 1 + others.length;

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] border-l-4 border-l-[var(--decisive)] rounded-md p-5">
      <div className="flex justify-between items-baseline">
        <div className="text-[10px] tracking-widest uppercase text-[var(--decisive)] font-bold">
          Today&apos;s decision · 1 of {total}
        </div>
        {others.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-[var(--decisive)] font-bold"
          >
            {expanded ? "− hide more" : `+ ${others.length} more ▾`}
          </button>
        )}
      </div>

      <div className="flex justify-between items-start gap-4 mt-2">
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold leading-tight">{primary.title}</div>
          <div className="text-xs text-[var(--muted-foreground)] mt-1">{primary.body}</div>
          <div className="mt-2">
            <LayeredChipRow chips={primary.chips} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 min-w-[120px]">
          <button
            onClick={() => router.push(primary.primaryActionHref)}
            className="bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded"
          >
            {primary.primaryActionLabel}
          </button>
          <button
            onClick={() => act("snooze")}
            disabled={busy !== null}
            className="border border-[var(--border)] text-xs px-3 py-1.5 rounded disabled:opacity-50"
          >
            {busy === "snooze" ? "Snoozing…" : "Snooze 1d"}
          </button>
          <button
            onClick={() => act("dismiss")}
            disabled={busy !== null}
            className="border border-[var(--border)] text-[var(--muted-foreground)] text-xs px-3 py-1.5 rounded disabled:opacity-50"
          >
            {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
          </button>
          {error && (
            <span role="alert" className="text-[10px] text-[var(--sell)]">
              Couldn&apos;t {error}. Try again.
            </span>
          )}
        </div>
      </div>

      {expanded && others.length > 0 && (
        <div className="mt-4 pt-3 border-t border-dashed border-[var(--border)]">
          <div className="text-[8px] tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">
            Other decisions queued
          </div>
          <div className="flex flex-col gap-1">
            {others.map((item, i) => (
              <button
                key={item.itemKey}
                onClick={() => router.push(item.primaryActionHref)}
                className="flex justify-between items-baseline gap-2 px-2 py-1.5 bg-[var(--background)] rounded text-left hover:bg-[var(--border)] transition-colors"
              >
                <div className="text-xs">
                  <b>{i + 2}.</b> {item.ticker ? `${item.ticker} · ` : ""}
                  {item.title}
                </div>
                <span className="text-[9px] text-[var(--muted-foreground)] flex-shrink-0">
                  {item.chips
                    .slice(0, 2)
                    .map((c) => `${c.label} ${c.value}`)
                    .join(" · ")}
                </span>
              </button>
            ))}
          </div>
          <div className="text-[9px] text-[var(--muted-foreground)] italic mt-1.5">
            Click any to open the full thesis.
          </div>
        </div>
      )}
    </div>
  );
}
