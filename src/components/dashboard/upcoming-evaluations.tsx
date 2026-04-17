"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";

type Item = {
  outcomeId: string;
  recommendationId: string;
  ticker: string;
  window: string;
  recommendation: string;
  confidence: string;
  checkAt: string;
  recCreatedAt: string;
};

const REC_COLOR: Record<string, string> = {
  BUY: "text-[var(--buy)] bg-[var(--buy)]/10 border-[var(--buy)]/20",
  HOLD: "text-[var(--hold)] bg-[var(--hold)]/10 border-[var(--hold)]/20",
  SELL: "text-[var(--sell)] bg-[var(--sell)]/10 border-[var(--sell)]/20",
};

function daysUntil(checkAt: string): {
  label: string;
  tone: "soon" | "week" | "far";
} {
  const ms = new Date(checkAt).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(ms / 86400000));
  if (days <= 1) return { label: days === 0 ? "today" : "tomorrow", tone: "soon" };
  if (days <= 7) return { label: `in ${days} days`, tone: "soon" };
  if (days <= 30) return { label: `in ${days} days`, tone: "week" };
  return { label: `in ${days} days`, tone: "far" };
}

export default function UpcomingEvaluations() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    fetch("/api/upcoming-evaluations")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items: Item[] } | null) => {
        setItems(data?.items ?? []);
      })
      .catch(() => setItems([]));
  }, []);

  // Empty state: mirror AlertFeed's pattern and render nothing rather than
  // a permanent empty card. Prevents visual real-estate being taken up by
  // a meaningless "No evaluations scheduled." message.
  if (items !== null && items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          Upcoming evaluations
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          When past calls get their next outcome check.
        </p>
      </CardHeader>
      <CardContent>
        {items === null ? (
          <div className="h-20 animate-pulse rounded-md bg-muted/40" />
        ) : (
          <ul className="space-y-2">
            {items.map((it) => {
              const { label, tone } = daysUntil(it.checkAt);
              const toneClass =
                tone === "soon"
                  ? "text-foreground"
                  : tone === "week"
                  ? "text-muted-foreground"
                  : "text-muted-foreground/60";
              return (
                <li
                  key={it.outcomeId}
                  className="flex items-center gap-3 text-sm"
                >
                  <Link
                    href={`/app/r/${it.recommendationId}`}
                    className="font-mono font-semibold underline-offset-4 hover:underline w-14 truncate"
                  >
                    {it.ticker}
                  </Link>
                  <span
                    className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${
                      REC_COLOR[it.recommendation] ??
                      "text-muted-foreground bg-muted"
                    }`}
                  >
                    {it.recommendation}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {it.window} check
                  </span>
                  <span className={`ml-auto text-xs ${toneClass}`}>
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
