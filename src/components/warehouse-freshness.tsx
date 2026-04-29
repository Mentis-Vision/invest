"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useClientNowMs } from "@/lib/client/use-client-now";

/**
 * Inline freshness indicator.
 *
 * Three visual modes:
 *   - "compact": one-line tag for use in headers/footers
 *       Last updated 6:42 AM today
 *   - "card":    a small soft-tint card with one supporting line — used
 *                only when the page genuinely benefits from highlighting
 *                that data is current
 *   - "pill":    very small rounded pill, intended to sit inline next
 *                to a card title (e.g. "Quick Read · Updated 11:49 AM")
 *
 * Backed by GET /api/warehouse/freshness — cached at the edge for 60s.
 * Renders nothing until the request completes (no jarring layout shift)
 * and renders nothing if the data hasn't been refreshed in 2 days
 * (we don't want to advertise "stale: 14 days ago").
 *
 * Voice rule: NO mentions of cron / models / tokens / AI cost. Investors
 * shouldn't see infrastructure terms.
 */

type Freshness = {
  asOf: string | null;
  capturedAt: string | null;
  rowCount: number;
  isFreshToday: boolean;
};

function formatRefreshTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildLabel(data: Freshness): string {
  if (!data.asOf) return "";
  const t = formatRefreshTime(data.asOf);
  return data.isFreshToday ? `Updated ${t} today` : `Updated ${t} yesterday`;
}

export function WarehouseFreshness({
  variant = "compact",
}: {
  variant?: "compact" | "card" | "pill";
}) {
  const [data, setData] = useState<Freshness | null>(null);
  const nowMs = useClientNowMs();

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

  if (!data || !data.asOf || nowMs == null) return null;

  const ageHr =
    (nowMs - new Date(data.asOf).getTime()) / (1000 * 60 * 60);
  if (ageHr > 48) return null;

  const label = buildLabel(data);

  if (variant === "pill") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        <Clock className="h-2.5 w-2.5" />
        {label}
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
        <Clock className="h-3 w-3" />
        {label}
      </span>
    );
  }

  // Card variant — gentle nudge that fresh data is already loaded so
  // the user doesn't feel they need to keep poking the page.
  return (
    <div className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      <div className="text-xs leading-relaxed">
        <p className="font-medium text-[var(--foreground)]">{label}</p>
        <p className="mt-0.5 text-[var(--muted-foreground)]">
          {data.isFreshToday
            ? "Prices, fundamentals and headlines are already today's."
            : "Fresh prices and headlines arrive each morning."}
        </p>
      </div>
    </div>
  );
}

/**
 * Lightweight shape for callers that already have an asOf string from
 * somewhere else (a warehouse row, a dossier, etc.) — no API call.
 */
export function FreshnessTag({ asOf }: { asOf: string | null | undefined }) {
  const nowMs = useClientNowMs();

  if (!asOf) return null;
  if (nowMs == null) return null;
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return null;
  const ageHr = (nowMs - d.getTime()) / (1000 * 60 * 60);
  if (ageHr > 48) return null;
  const today = new Date().toISOString().slice(0, 10);
  const isToday = d.toISOString().slice(0, 10) === today;
  const refreshedAt = formatRefreshTime(asOf);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
      <Clock className="h-3 w-3" />
      {isToday
        ? `Updated ${refreshedAt}`
        : `Updated ${refreshedAt} yesterday`}
    </span>
  );
}
