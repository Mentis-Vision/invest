"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, DollarSign, FileText } from "lucide-react";

/**
 * "Events this week" — earnings, dividends, and filings on the
 * user's holdings for the next 7 days.
 *
 * Reads `/api/upcoming-evaluations` for the events surface the
 * dashboard Calendar block also uses. Filters to events within
 * `UPCOMING_WINDOW_DAYS` and groups by day so the user can see what
 * their book is exposed to this week at a glance.
 *
 * Hides when no events are scheduled — again, the research page
 * ethos is "show what's interesting or nothing at all."
 */

type UpcomingEvent = {
  ticker: string;
  eventType: string;
  eventDate: string;
  label?: string;
};

const UPCOMING_WINDOW_DAYS = 7;

const ICONS: Record<string, typeof CalendarDays> = {
  earnings: CalendarDays,
  dividend: DollarSign,
  filing: FileText,
};

export function EventsThisWeek() {
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/upcoming-evaluations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const raw = (d?.events ?? d?.upcoming ?? []) as UpcomingEvent[];
        const cutoff = Date.now() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const filtered = raw
          .filter((e) => {
            const t = new Date(e.eventDate).getTime();
            return !Number.isNaN(t) && t >= Date.now() && t <= cutoff;
          })
          .sort(
            (a, b) =>
              new Date(a.eventDate).getTime() -
              new Date(b.eventDate).getTime()
          );
        setEvents(filtered);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return null;
  if (events.length === 0) return null;

  // Group by day for readability
  const byDay = new Map<string, UpcomingEvent[]>();
  for (const e of events.slice(0, 12)) {
    const day = formatDay(e.eventDate);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(e);
  }

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          <CalendarDays className="h-3 w-3 text-primary" />
          Events this week · your holdings
        </div>
        <span className="text-[11px] text-muted-foreground">
          Next {UPCOMING_WINDOW_DAYS} days
        </span>
      </div>

      <div className="space-y-3">
        {[...byDay.entries()].map(([day, list]) => (
          <div key={day}>
            <div className="mb-1 text-[11px] font-semibold text-foreground/80">
              {day}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {list.map((e, i) => {
                const type = (e.eventType ?? "").toLowerCase();
                const Icon = ICONS[type] ?? CalendarDays;
                return (
                  <Link
                    key={`${e.ticker}-${type}-${i}`}
                    href={`/app?view=research&ticker=${encodeURIComponent(e.ticker)}`}
                    className="inline-flex items-center gap-1.5 rounded border border-border bg-secondary/40 px-2 py-0.5 text-[11px] transition-colors hover:border-primary/40 hover:bg-primary/5"
                    title={e.label ?? type}
                  >
                    <Icon className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono font-semibold">{e.ticker}</span>
                    <span className="text-muted-foreground">· {type}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
