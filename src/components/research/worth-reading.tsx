"use client";

import { useEffect, useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";

/**
 * "Worth reading" — small card surfacing long-form investor thinking
 * that isn't breaking news.
 *
 * Source: /api/market-news?scope=thinker → items from Aswath
 * Damodaran's blog (valuation commentary) + Howard Marks / Oaktree
 * memos when available. **14-day window** — earlier we kept this at
 * 60 days on the "evergreen" theory, but a dashboard is about what
 * changed recently; stale picks eroded the card's signal value. If
 * the window is empty, the card hides itself.
 *
 * Quiet by design:
 *   - Up to 3 items; empty state hides the card entirely
 *   - No summaries in the body — just title + author + relative date
 *   - Click opens the original source in a new tab
 *
 * Appears on the Research starter view below the market pulse.
 */

type ThinkerItem = {
  id: string;
  publishedAt: string;
  providerName: string;
  title: string;
  url: string;
};

function relativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffDay = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDay < 1) return "today";
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function WorthReading() {
  const [items, setItems] = useState<ThinkerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/market-news?scope=thinker&limit=3")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: ThinkerItem[] } | null) => {
        if (!alive || !d?.items) return;
        setItems(d.items);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Silent until we know. Prevents a flash of empty-card during
  // initial fetch.
  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <BookOpen className="h-3 w-3" />
          Worth reading
        </div>
        <span className="text-[10px] text-muted-foreground">
          Long-form · not breaking news
        </span>
      </div>
      <ul className="divide-y divide-border/60">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block px-4 py-3 transition-colors hover:bg-secondary/40"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-foreground group-hover:text-primary">
                    {it.title}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium">{it.providerName}</span>
                    <span>·</span>
                    <span>{relativeDate(it.publishedAt)}</span>
                  </div>
                </div>
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70" />
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
