"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Lightbulb,
  Loader2,
  TrendingUp,
  AlertTriangle,
  CalendarClock,
  PieChart,
  History as HistoryIcon,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { getHoldings, type Holding } from "@/lib/client/holdings-cache";
import { WarehouseFreshness } from "@/components/warehouse-freshness";
import {
  NextMoveHero,
  ACTION_ICON,
  HEALTH_STYLE,
  personaLabel,
  type Review,
  type NextMoveState,
} from "@/components/dashboard/next-move-hero";

// Re-export so consumers that imported from here still work.
export type { Review, NextMoveState };

type Macro = Array<{
  indicator: string;
  value: string;
  date: string;
  deltaLabel?: string;
}>;

type RecentRec = {
  id: string;
  ticker: string;
  recommendation: string;
  confidence: string;
  createdAt: string;
};

type UpcomingEvent = {
  ticker: string;
  eventType: string;
  eventDate: string;
};

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 10000 ? 0 : 2,
  }).format(n);
}

// ── Exported "full brief" body ────────────────────────────────────────────────
// The per-lens grid, agreed-points card, red-flags card, and secondary-actions
// card. Dashboard embeds this inline under the hero; Strategy page renders it
// below its own toggle.
export function StrategyFullBrief({ review }: { review: Review }) {
  return (
    <div className="space-y-4 border-t border-border/60 pt-5">
      {review.supervisor.topActions.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Other actions to consider</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Beyond today&rsquo;s top move, here&rsquo;s what else the lenses flagged.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {review.supervisor.topActions.slice(1).map((a, i) => {
                const first = a.action.split(/[:\s]/)[0].toUpperCase();
                const Icon = ACTION_ICON[first] ?? (() => null);
                return (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div>
                      <span className="font-medium">{a.action}</span>{" "}
                      <span className="text-muted-foreground">— {a.rationale}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {review.supervisor.agreedPoints.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Where our lenses agreed</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {review.supervisor.agreedPoints.map((p, i) => (
                <li key={i} className="text-sm leading-relaxed">• {p}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {review.supervisor.redFlags.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" /> Red flags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {review.supervisor.redFlags.map((f, i) => (
                <li key={i} className="text-sm">• {f}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {review.analyses.map((a) => (
          <Card key={a.model}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {personaLabel(a.model)} lens
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {a.status !== "ok" || !a.output ? (
                <p className="text-muted-foreground">FAILED: {a.error}</p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {a.output.overallHealth.replace("_", " ")}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {a.output.confidence}
                    </Badge>
                  </div>
                  <p className="leading-relaxed">{a.output.summary}</p>
                  {a.output.concentrationRisks.length > 0 && (
                    <div>
                      <div className="mt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Concentration
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {a.output.concentrationRisks.map((c, i) => (
                          <li key={i}>
                            {c.ticker} ({c.percentOfPortfolio.toFixed(0)}%) — {c.concern}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Strategy view — thin placeholder ─────────────────────────────────────────
// Phase 4.3: the full body moved to Dashboard. This stub satisfies the
// ?view=strategy alias (Phase 2) for anyone who bookmarked the old URL.
export default function StrategyView() {
  return (
    <div className="rounded-md border border-border bg-card p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Your daily strategy now lives on the{" "}
        <Link href="/app" className="underline underline-offset-4">
          Dashboard
        </Link>
        .
      </p>
    </div>
  );
}
