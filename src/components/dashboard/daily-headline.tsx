// src/components/dashboard/daily-headline.tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import type { QueueItem } from "@/lib/dashboard/types";
import { LayeredChipRow } from "./layered-chip-row";
import { useRouter } from "next/navigation";
import { log } from "@/lib/log";

type HeadlineAction = "snooze" | "dismiss";

export function DailyHeadline({ item }: { item: QueueItem | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<HeadlineAction | null>(null);
  const [errorAction, setErrorAction] = useState<HeadlineAction | null>(null);

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    [],
  );

  if (!item) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] border-l-4 border-l-[var(--decisive)] rounded-md p-4">
        <div className="text-[10px] tracking-widest uppercase text-[var(--decisive)] mb-1.5">
          Daily Headline · {todayLabel}
        </div>
        <div className="text-lg font-bold leading-tight">
          Nothing&apos;s urgent. Browse research candidates →
        </div>
        <div className="mt-3">
          <button
            onClick={() => router.push("/app/research")}
            className="bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded"
          >
            Open research
          </button>
        </div>
      </div>
    );
  }

  async function act(action: HeadlineAction) {
    setBusy(action);
    setErrorAction(null);
    try {
      const res = await fetch(`/api/queue/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey: item!.itemKey }),
      });
      if (!res.ok) throw new Error(`${action} failed: ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      log.error("dashboard.headline", "headline.action-failed", {
        action,
        err: String(err),
      });
      setErrorAction(action);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] border-l-4 border-l-[var(--decisive)] rounded-md p-4">
      <div className="text-[10px] tracking-widest uppercase text-[var(--decisive)] mb-1.5">
        Daily Headline · {todayLabel}
      </div>
      <div className="text-lg font-bold leading-tight mb-1">{item.title}</div>
      <div className="text-sm text-[var(--muted-foreground)] mb-2">{item.body}</div>
      <LayeredChipRow chips={item.chips} />
      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          onClick={() => router.push(item.primaryActionHref)}
          className="bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded"
        >
          {item.primaryActionLabel}
        </button>
        <button
          onClick={() => act("snooze")}
          disabled={busy !== null || pending}
          className="border border-[var(--border)] text-xs px-3 py-1.5 rounded disabled:opacity-50"
        >
          {busy === "snooze" ? "Snoozing…" : "Snooze 1d"}
        </button>
        <button
          onClick={() => act("dismiss")}
          disabled={busy !== null || pending}
          className="border border-[var(--border)] text-[var(--muted-foreground)] text-xs px-3 py-1.5 rounded disabled:opacity-50"
        >
          {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
        {errorAction && (
          <span role="alert" className="text-[11px] text-[var(--sell)] self-center">
            Couldn&apos;t {errorAction}. Try again.
          </span>
        )}
      </div>
    </div>
  );
}
