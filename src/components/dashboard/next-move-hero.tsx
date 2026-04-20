"use client";

import { useState } from "react";
import Link from "next/link";
import { QuickScanStrip } from "@/components/dashboard/quick-scan-strip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Lightbulb,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  Check,
  AlarmClock,
  X,
  Undo2,
} from "lucide-react";

// ── Shared types ─────────────────────────────────────────────────────────────

export type NextMoveState = "active" | "done" | "snoozed" | "dismissed";

export type Review = {
  holdingsCount: number;
  totalValue: number;
  supervisor: {
    overallHealth: string;
    confidence: string;
    consensus: string;
    summary: string;
    agreedPoints: string[];
    disagreements: Array<{ topic: string; claudeView: string; gptView: string; geminiView: string }>;
    redFlags: string[];
    topActions: Array<{ priority: string; action: string; rationale: string }>;
    dataAsOf: string;
  };
  supervisorModel: string;
  analyses: Array<{
    model: string;
    status: string;
    output?: {
      overallHealth: string;
      confidence: string;
      summary: string;
      concentrationRisks: Array<{ ticker: string; percentOfPortfolio: number; concern: string }>;
      sectorImbalances: Array<{ sector: string; direction: string; observation: string }>;
      rebalancingSuggestions: Array<{ action: string; target: string; rationale: string }>;
    };
    error?: string;
  }>;
  cached?: boolean;
  cachedAt?: string;
  tokensUsed?: number;
  nextMoveState?: NextMoveState | null;
  nextMoveStateAt?: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export const HEALTH_STYLE: Record<string, string> = {
  STRONG: "text-[var(--buy)]",
  BALANCED: "text-foreground",
  FRAGILE: "text-[var(--hold)]",
  AT_RISK: "text-[var(--sell)]",
};

export const ACTION_ICON: Record<string, typeof TrendingUp> = {
  INCREASE: TrendingUp,
  REDUCE: TrendingDown,
  REVIEW: Minus,
};

export function personaLabel(model: string): string {
  // Renamed from Value/Growth/Macro → Quality/Momentum/Context on
  // 2026-04-18 to keep user-facing labels more intuitive. The model
  // IDs themselves (claude/gpt/gemini) still flow through the API
  // unchanged — this is a display transform only.
  switch (model) {
    case "claude":
      return "Quality";
    case "gpt":
      return "Momentum";
    case "gemini":
      return "Context";
    default:
      return model;
  }
}

function extractTicker(action: string): string | null {
  const m = action.match(/\b\$?([A-Z]{1,5})\b/);
  return m ? m[1] : null;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Next Move hero — the single most important action surfaced with
 * maximum prominence. Designed for a 3-second read: priority chip,
 * the action sentence, one-line rationale, and three state chips:
 *
 *   - **I did this** → hero collapses into a "done" confirmation
 *     with an Undo button that flips it back to active
 *   - **Snooze today** → hero collapses into a compact "see you
 *     tomorrow" tile; full hero re-appears on next day's cron row
 *   - **Dismiss** → hero hides entirely for the rest of the day
 *
 * Pulls from `review.supervisor.topActions[0]`. If no actions
 * exist (calm-portfolio outcome), shows a steady-state affirmation
 * with no chips — nothing to act on.
 */
export function NextMoveHero({
  review,
  onStateChange,
}: {
  review: Review;
  onStateChange?: (s: NextMoveState | null) => void;
}) {
  const top = review.supervisor.topActions[0];
  const state = (review.nextMoveState ?? "active") as NextMoveState;
  const [saving, setSaving] = useState<NextMoveState | "undo" | null>(null);

  async function setState(next: NextMoveState | null, key: NextMoveState | "undo") {
    setSaving(key);
    try {
      const res = await fetch("/api/portfolio-review/next-move-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next }),
      });
      if (!res.ok) {
        // Non-blocking — if persistence fails, keep the UI optimistic
        // but don't leave the user with nothing. Surface via console
        // and continue.
        console.warn("next-move-state save failed");
      }
      onStateChange?.(next);
    } catch {
      // Same — swallow to avoid breaking the hero on a transient
      // network error.
    } finally {
      setSaving(null);
    }
  }

  // Empty-state (no actions in the review) — nothing to act on, no chips.
  if (!top) {
    return (
      <Card className="border-[var(--buy)]/30 bg-[var(--buy)]/5">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--buy)]">
            <Zap className="h-3 w-3" />
            Next move · today
          </div>
          <CardTitle className="mt-1 text-[20px] leading-tight tracking-tight">
            Steady as you are — no action needed.
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The three lenses don&rsquo;t see anything that demands action
            today. Your portfolio&rsquo;s health reads as{" "}
            <strong className="text-foreground">
              {review.supervisor.overallHealth.replace("_", " ").toLowerCase()}
            </strong>
            . We&rsquo;ll re-check overnight and ping you if that changes.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Dismissed — render nothing. Full hero returns on tomorrow's
  // review row.
  if (state === "dismissed") return null;

  // Done — compact confirmation with an Undo escape hatch.
  if (state === "done") {
    return (
      <Card className="border-[var(--buy)]/30 bg-[var(--buy)]/8">
        <CardContent className="flex items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-2.5 text-sm">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--buy)] text-white">
              <Check className="h-3.5 w-3.5" />
            </div>
            <span className="font-medium text-foreground">
              Done — you marked today&rsquo;s next move complete.
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setState("active", "undo")}
            disabled={saving !== null}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {saving === "undo" ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Undo2 className="mr-1 h-3 w-3" />
            )}
            Undo
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Snoozed — even more compact. Reappears on tomorrow's hero.
  if (state === "snoozed") {
    return (
      <Card className="border-border bg-secondary/40">
        <CardContent className="flex items-center justify-between gap-3 py-2.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <AlarmClock className="h-3.5 w-3.5" />
            <span>Snoozed. A fresh read lands in the morning.</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setState("active", "undo")}
            disabled={saving !== null}
            className="text-[11px]"
          >
            {saving === "undo" ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            Bring back
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Active — the full hero with chips.
  const targetTicker = extractTicker(top.action);
  const firstToken = top.action.split(/[:\s]/)[0].toUpperCase();
  const Icon = ACTION_ICON[firstToken] ?? Lightbulb;
  const priority = top.priority?.toUpperCase() ?? "CONSIDER";
  const priorityTone =
    priority === "HIGH" || priority === "URGENT"
      ? "text-[var(--sell)] bg-[var(--sell)]/10 border-[var(--sell)]/20"
      : priority === "MEDIUM"
        ? "text-[var(--hold)] bg-[var(--hold)]/10 border-[var(--hold)]/20"
        : "text-[var(--buy)] bg-[var(--buy)]/10 border-[var(--buy)]/20";

  return (
    <Card className="border-[var(--buy)]/40 bg-gradient-to-br from-[var(--buy)]/8 to-transparent shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--buy)]">
            <Zap className="h-3 w-3" />
            Next move · today
          </div>
          <Badge
            variant="outline"
            className={`font-mono text-[10px] uppercase tracking-[0.12em] ${priorityTone}`}
          >
            {priority}
          </Badge>
        </div>
        <CardTitle className="mt-2 flex items-start gap-2.5 text-[22px] leading-[1.2] tracking-tight">
          <Icon className="mt-1 h-5 w-5 flex-shrink-0 text-[var(--buy)]" />
          <span>{top.action}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-[14px] leading-relaxed text-foreground/85">
          {top.rationale}
        </p>

        {targetTicker && (
          <QuickScanStrip
            ticker={targetTicker}
            apiPath="/api/dashboard/quick-scan"
          />
        )}

        {/* Action chips */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => setState("done", "done")}
            disabled={saving !== null}
            className="bg-[var(--buy)] text-white hover:bg-[var(--buy)]/90"
          >
            {saving === "done" ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-3 w-3" />
            )}
            I did this
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setState("snoozed", "snoozed")}
            disabled={saving !== null}
          >
            {saving === "snoozed" ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <AlarmClock className="mr-1.5 h-3 w-3" />
            )}
            Snooze today
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setState("dismissed", "dismissed")}
            disabled={saving !== null}
            className="text-muted-foreground hover:text-foreground"
          >
            {saving === "dismissed" ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <X className="mr-1.5 h-3 w-3" />
            )}
            Dismiss
          </Button>
        </div>

        <div className="flex items-center gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          <span>
            Based on the {personaLabel("claude")} / {personaLabel("gpt")} /{" "}
            {personaLabel("gemini")} lens panel.
          </span>
          {review.supervisor.consensus && (
            <>
              <span aria-hidden>·</span>
              <span>Consensus: {review.supervisor.consensus}</span>
            </>
          )}
          <span aria-hidden className="ml-auto">
            ·
          </span>
          <Link
            href="/app/history"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Record your action →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
