"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  X,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Bell,
  Search,
  UserCheck,
} from "lucide-react";

/**
 * Overnight-changes alert feed.
 *
 * Reads /api/alerts — alerts are populated by the nightly cron from
 * free data sources (Yahoo price moves, SEC Form 4 insider activity,
 * concentration thresholds). Zero AI cost on generation.
 *
 * Users can dismiss alerts. Dismissed alerts never re-surface.
 */

type Alert = {
  id: string;
  kind: "price_move" | "insider_transaction" | "concentration" | string;
  ticker: string | null;
  severity: "info" | "warn" | "action" | string;
  title: string;
  body: string | null;
  seen: boolean;
  createdAt: string;
  metadata: Record<string, unknown>;
};

function iconFor(kind: string, metadata: Record<string, unknown>) {
  if (kind === "price_move") {
    const pct = Number(metadata.percentMove);
    return pct > 0 ? TrendingUp : TrendingDown;
  }
  if (kind === "insider_transaction") return UserCheck;
  if (kind === "concentration") return AlertTriangle;
  return Bell;
}

function toneFor(
  severity: string,
  kind: string,
  metadata: Record<string, unknown>
): string {
  if (severity === "warn") return "text-[var(--sell)]";
  if (severity === "action") return "text-[var(--buy)]";
  if (kind === "price_move") {
    const pct = Number(metadata.percentMove);
    return pct > 0 ? "text-[var(--buy)]" : "text-[var(--sell)]";
  }
  return "text-muted-foreground";
}

export default function AlertFeed() {
  const [items, setItems] = useState<Alert[] | null>(null);

  useEffect(() => {
    fetch("/api/alerts")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items: Alert[] } | null) => {
        setItems(data?.items ?? []);
      })
      .catch(() => setItems([]));
  }, []);

  async function dismiss(id: string) {
    // Optimistic — remove immediately, server call is best-effort.
    setItems((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
    fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "dismiss" }),
    }).catch(() => {});
  }

  if (items === null) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Overnight activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-16 animate-pulse rounded-md bg-muted/40" />
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" />
          Overnight activity
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Things we noticed in your holdings. Free market data; no AI cost to
          surface these.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-border/60">
          {items.map((a) => {
            const Icon = iconFor(a.kind, a.metadata);
            const tone = toneFor(a.severity, a.kind, a.metadata);
            return (
              <li
                key={a.id}
                className="flex items-start gap-3 py-3 text-sm"
              >
                <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${tone}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{a.title}</span>
                    {a.ticker && a.kind !== "concentration" && (
                      <Link
                        href={`/app?view=research&ticker=${encodeURIComponent(a.ticker)}`}
                        className="shrink-0 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        Research →
                      </Link>
                    )}
                  </div>
                  {a.body && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.body}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {a.kind === "price_move" && a.ticker && (
                    <Link
                      href={`/app?view=research&ticker=${encodeURIComponent(a.ticker)}`}
                      className="hidden rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent/50 sm:inline-flex sm:items-center"
                      title="Ask ClearPath why"
                    >
                      <Search className="mr-1 h-3 w-3" />
                      Why?
                    </Link>
                  )}
                  <button
                    onClick={() => dismiss(a.id)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
