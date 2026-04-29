"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { useClientNowMs } from "@/lib/client/use-client-now";

type PastCall = {
  id: string;
  verdict: string;
  confidence: string;
  date: string;
  userAction: string | null;
};

export function PastCallsStrip({ ticker }: { ticker: string }) {
  const [items, setItems] = useState<PastCall[]>([]);
  const nowMs = useClientNowMs();
  useEffect(() => {
    let alive = true;
    fetch(`/api/research/past-calls/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d?.items && setItems(d.items as PastCall[]))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ticker]);

  if (items.length === 0 || nowMs == null) return null;

  return (
    <div className="mb-4 rounded-md border border-[var(--hold)]/30 bg-[var(--hold)]/5 px-4 py-3">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--hold)]">
        <Clock className="h-3 w-3" /> Your past calls on {ticker}
      </div>
      <ul className="space-y-1 text-[12px]">
        {items.map((it) => {
          const daysAgo = Math.floor(
            (nowMs - new Date(it.date).getTime()) / 864e5
          );
          const stale = daysAgo >= 7;
          return (
            <li key={it.id} className="flex items-center gap-2">
              <span className="font-semibold">{it.verdict}</span>
              <span className="text-muted-foreground">· {it.confidence}</span>
              <span className="text-muted-foreground">
                · {daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`}
              </span>
              {it.userAction && (
                <span className="rounded-sm border border-border px-1 text-[10px]">
                  you acted
                </span>
              )}
              {stale && (
                <span className="ml-auto text-[11px] text-[var(--sell)]">
                  stale → run fresh below
                </span>
              )}
              <Link href={`/app/r/${it.id}`} className="text-primary underline-offset-4 hover:underline">
                open →
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
