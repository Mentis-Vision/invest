"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Clock } from "lucide-react";

/**
 * Small inline tag indicating when the warehouse last refreshed.
 *
 * Two visual modes:
 *   - "compact": single line, used in headers/footers
 *       ✓ Refreshed overnight at 6:42 AM today
 *   - "card": padded card with explanation, used near "Run analysis"
 *     buttons to nudge users away from re-running expensive analysis
 *     when last night's data is still fresh
 *
 * Backed by GET /api/warehouse/freshness — cached at the edge for 60s.
 * Renders nothing until the request completes (no jarring layout shift)
 * and renders nothing if the warehouse hasn't been refreshed in 2 days
 * (we don't want to show "stale: 14 days ago" on a forgotten install).
 */

type Freshness = {
  asOf: string | null;
  capturedAt: string | null;
  rowCount: number;
  isFreshToday: boolean;
};

function formatRefreshTime(iso: string): string {
  const d = new Date(iso);
  // Always render in the user's local time. The cron is UTC but a 14:00 UTC
  // refresh is 9:00 EST / 6:00 PST — calling it "overnight" is a fair label
  // for any US user.
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function WarehouseFreshness({
  variant = "compact",
}: {
  variant?: "compact" | "card";
}) {
  const [data, setData] = useState<Freshness | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/warehouse/freshness")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Freshness | null) => {
        if (!alive) return;
        setData(d);
      })
      .catch(() => {
        /* no-op; the tag just doesn't render */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!data || !data.asOf) return null;

  // Don't render at all if the warehouse hasn't refreshed recently — a
  // "Refreshed 14d ago" tag is worse than no tag.
  const ageHr =
    (Date.now() - new Date(data.asOf).getTime()) / (1000 * 60 * 60);
  if (ageHr > 48) return null;

  const refreshedAt = formatRefreshTime(data.asOf);
  const label = data.isFreshToday
    ? `Refreshed overnight at ${refreshedAt} today`
    : `Last refreshed ${refreshedAt} yesterday`;

  if (variant === "compact") {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]"
        title={`Warehouse data covers ${data.rowCount} ticker rows. The nightly cron writes once per day, so re-running analysis won't pick up new prices until tomorrow.`}
      >
        <ShieldCheck className="h-3 w-3 text-[var(--buy)]" />
        {label}
      </span>
    );
  }

  // Card variant — used to nudge users away from spending tokens on a
  // re-analysis when last night's run is still authoritative.
  return (
    <div className="flex items-start gap-3 rounded-md border border-[var(--buy)]/30 bg-[var(--buy)]/5 px-3 py-2.5">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--buy)]" />
      <div className="text-xs leading-relaxed">
        <p className="font-medium text-[var(--foreground)]">{label}</p>
        <p className="mt-0.5 text-[var(--muted-foreground)]">
          {data.isFreshToday
            ? "Most analysis won't change meaningfully before tomorrow's refresh — re-running just costs tokens."
            : "Tomorrow morning's cron will pull fresh prices, fundamentals, and news."}
        </p>
      </div>
    </div>
  );
}

/**
 * Server-shaped variant for places where you already have an as_of
 * timestamp from somewhere else (a warehouse row, a dossier, etc.) and
 * want to render the same compact tag without making a separate API call.
 */
export function FreshnessTag({ asOf }: { asOf: string | null | undefined }) {
  if (!asOf) return null;
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return null;
  const ageHr = (Date.now() - d.getTime()) / (1000 * 60 * 60);
  if (ageHr > 48) return null;
  const today = new Date().toISOString().slice(0, 10);
  const isToday = d.toISOString().slice(0, 10) === today;
  const refreshedAt = formatRefreshTime(asOf);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
      <Clock className="h-3 w-3" />
      {isToday ? `Updated ${refreshedAt}` : `Updated yesterday ${refreshedAt}`}
    </span>
  );
}
