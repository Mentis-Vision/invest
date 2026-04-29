"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { X, TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * Surfaces recent outcome evaluations as a subtle, dismissible banner.
 *
 * Lives on the Research tab (mounted alongside the disclaimer modal). The
 * API returns up to 3 outcomes evaluated in the last 24h. We render the
 * most recent one as a single-line banner; if dismissed we hide it for
 * the rest of the session via sessionStorage.
 *
 * NOT a notification system — there's no unread count, no badge, no
 * email. Design intent: transparency nudge. "Hey, your SELL on TSLA
 * hit its 30-day mark — here's how it played out."
 */

type PingItem = {
  outcomeId: string;
  recommendationId: string;
  ticker: string;
  window: string;
  recommendation: string;
  priceAtRec: number;
  priceAtCheck: number | null;
  percentMove: number | null;
  verdict: string | null;
};

const SESSION_KEY = "clearpath.outcome-ping.dismissed";

function loadDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(set: Set<string>): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable — no-op */
  }
}

export default function OutcomePing() {
  const [items, setItems] = useState<PingItem[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const dismissedTimer = setTimeout(() => {
      setDismissed(loadDismissed());
    }, 0);
    fetch("/api/outcome-ping")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items: PingItem[] } | null) => {
        setItems(data?.items ?? []);
      })
      .catch(() => setItems([]));
    return () => clearTimeout(dismissedTimer);
  }, []);

  if (!items) return null;

  const toShow = items.find((it) => !dismissed.has(it.outcomeId));
  if (!toShow) return null;

  function dismiss(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    saveDismissed(next);
  }

  const move = toShow.percentMove;
  const priceAtCheck = toShow.priceAtCheck;
  const rec = toShow.recommendation;

  // Color + icon purely by direction of move relative to our rec intent.
  // BUY we want up; SELL we want down; HOLD we want flat.
  let Icon = Minus;
  let tone = "text-muted-foreground";
  if (move != null) {
    if (rec === "BUY") {
      if (move > 3) {
        Icon = TrendingUp;
        tone = "text-[var(--buy)]";
      } else if (move < -3) {
        Icon = TrendingDown;
        tone = "text-[var(--sell)]";
      }
    } else if (rec === "SELL") {
      if (move < -3) {
        Icon = TrendingDown;
        tone = "text-[var(--buy)]";
      } else if (move > 3) {
        Icon = TrendingUp;
        tone = "text-[var(--sell)]";
      }
    }
  }

  return (
    <Card className="border-border/60 bg-muted/20">
      <CardContent className="flex items-center gap-3 py-2.5 pl-3 pr-2 text-xs">
        <Icon className={`h-4 w-4 flex-shrink-0 ${tone}`} />
        <div className="flex-1">
          Your <span className="font-semibold">{rec}</span> on{" "}
          <Link
            href={`/app/r/${toShow.recommendationId}`}
            className="font-mono font-medium underline-offset-4 hover:underline"
          >
            {toShow.ticker}
          </Link>{" "}
          hit its{" "}
          <span className="font-medium">{toShow.window}</span> mark
          {priceAtCheck != null && move != null && (
            <>
              {" — "}
              <span className={`font-mono ${tone}`}>
                {move >= 0 ? "+" : ""}
                {move.toFixed(1)}%
              </span>{" "}
              (${toShow.priceAtRec.toFixed(2)} → $
              {priceAtCheck.toFixed(2)})
            </>
          )}
          .
        </div>
        <Link
          href={`/app/r/${toShow.recommendationId}`}
          className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent/50"
        >
          See the follow-up
        </Link>
        <button
          onClick={() => dismiss(toShow.outcomeId)}
          className="ml-1 rounded-md p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </CardContent>
    </Card>
  );
}
