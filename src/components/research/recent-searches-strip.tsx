"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = { id: string; ticker: string; verdict: string; date: string };

export function RecentSearchesStrip() {
  const [items, setItems] = useState<Row[]>([]);
  useEffect(() => {
    fetch("/api/research/recent-searches")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.items && setItems(d.items))
      .catch(() => {});
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
        Recent searches
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.slice(0, 8).map((it) => (
          <Link
            key={it.id}
            href={`/app/r/${it.id}`}
            className="inline-flex items-center gap-1.5 rounded border border-border bg-secondary/60 px-2 py-1 text-[11px] hover:border-primary/40"
          >
            <span className="font-mono font-semibold">{it.ticker}</span>
            <span className="text-muted-foreground">· {it.verdict}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
