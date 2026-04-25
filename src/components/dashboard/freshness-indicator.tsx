"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

/**
 * "Updated X ago" badge for holdings data.
 *
 * Why this exists (financial-app context):
 *   Users make decisions based on portfolio numbers. A value from 30
 *   seconds ago and a value from 30 hours ago look identical — but
 *   acting on them is very different. An always-visible staleness
 *   indicator is a core trust signal.
 *
 * Tint rules:
 *   - <= 15 min → muted (normal, expected for live session)
 *   - 15 min – 6 hrs → muted, slightly warmer
 *   - 6 hrs – 24 hrs → amber (heads-up: stale but usable)
 *   - > 24 hrs → red (do not trust these numbers for decisions)
 *   - null (never synced) → muted placeholder
 *
 * Re-renders every 60s so "2 min ago" becomes "3 min ago" without a
 * page refresh.
 */
export function FreshnessIndicator({
  lastSyncedAt,
  className = "",
}: {
  lastSyncedAt: string | null | undefined;
  className?: string;
}) {
  // Re-render every minute so the relative-time text stays accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!lastSyncedAt) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] text-muted-foreground ${className}`}
        title="Holdings have not been synced yet"
      >
        <Clock className="h-3 w-3" />
        Not yet synced
      </span>
    );
  }

  const ageMs = Date.now() - new Date(lastSyncedAt).getTime();
  // Clamp negative (client clock drift) to 0 so we don't show "in 5s".
  const age = Math.max(0, ageMs);
  const label = formatRelative(age);

  const tint =
    age > 24 * 3600_000
      ? "text-[var(--sell,theme(colors.red.600))]"
      : age > 6 * 3600_000
        ? "text-[var(--hold,theme(colors.amber.600))]"
        : "text-muted-foreground";

  const iso = new Date(lastSyncedAt).toLocaleString();

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] ${tint} ${className}`}
      title={`Holdings last synced at ${iso}`}
    >
      <Clock className="h-3 w-3" />
      Updated {label}
    </span>
  );
}

function formatRelative(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
