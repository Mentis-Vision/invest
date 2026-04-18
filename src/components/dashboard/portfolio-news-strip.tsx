"use client";

import { useEffect, useState } from "react";
import { Newspaper, ExternalLink } from "lucide-react";

/**
 * Compact "what's being written about your holdings" strip.
 *
 * Design target per user feedback: quick glance, not overload.
 *   - Max 4 items rendered inline
 *   - Each item: ticker · publisher · headline (truncated to ~90ch)
 *   - Click → opens full article in a new tab
 *   - Empty state hides the card entirely (no noise when there's
 *     nothing to say)
 *
 * Backed by /api/market-news?scope=portfolio — reads the
 * market_news_daily table the nightly cron populates. No AI, $0.
 */

type NewsItem = {
  id: string;
  publishedAt: string;
  providerId: string;
  providerName: string;
  category: "news" | "analysis" | "thinker" | "regulatory";
  title: string;
  url: string;
  summary: string | null;
  tickersMentioned: string[];
};

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (!d) return "";
  const diffMin = Math.floor((Date.now() - d) / 60_000);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function PortfolioNewsStrip() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/market-news?scope=portfolio&limit=4")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data?.items) return;
        setItems(data.items);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="h-3 w-32 animate-pulse rounded bg-[var(--secondary)]" />
        <div className="mt-3 space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-[var(--secondary)]/60" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-[var(--secondary)]/60" />
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          <Newspaper className="h-3 w-3" />
          In the news
        </div>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          On your holdings
        </span>
      </div>
      <ul className="divide-y divide-[var(--border)]/60">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-4 py-2.5 transition-colors hover:bg-[var(--secondary)]/40"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[var(--foreground)]">
                    {it.title}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                    {it.tickersMentioned.slice(0, 3).map((t) => (
                      <span key={t} className="font-mono font-medium text-[var(--foreground)]/70">
                        {t}
                      </span>
                    ))}
                    <span>·</span>
                    <span>{it.providerName}</span>
                    <span>·</span>
                    <span>{relativeTime(it.publishedAt)}</span>
                  </div>
                </div>
                <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-[var(--muted-foreground)] opacity-60" />
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
