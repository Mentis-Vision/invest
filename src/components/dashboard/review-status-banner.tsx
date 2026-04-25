"use client";

import { AlertCircle, Loader2, Plug, RefreshCw } from "lucide-react";

/**
 * Status banner for the portfolio-review slot when there's no review
 * to show. Honest about WHY — syncing / needs reauth / empty / not
 * connected — instead of silently hiding the Next Move hero.
 *
 * Backed by the `error` discriminators the `/api/portfolio-review`
 * endpoint returns when holdings are empty.
 */
export type ReviewStatus =
  | { kind: "loading" }
  | { kind: "ok" }
  | {
      kind: "syncing";
      institutionName: string | null;
      retryAfterSec: number;
      attemptsUsed: number;
      maxAttempts: number;
    }
  | {
      kind: "needs_reauth";
      institutionName: string | null;
      itemId: string;
      onReauth?: () => void;
    }
  | {
      kind: "empty_brokerage";
      institutionName: string | null;
      message: string;
    }
  | { kind: "none"; message: string; onConnect?: () => void }
  | { kind: "error"; message: string };

export function ReviewStatusBanner({
  status,
  onConnect,
  onReauth,
}: {
  status: ReviewStatus;
  onConnect?: () => void;
  onReauth?: (itemId: string) => void;
}) {
  if (status.kind === "ok" || status.kind === "loading") return null;

  // ─── Syncing — blue, with spinner ──────────────────────────────────
  if (status.kind === "syncing") {
    const { institutionName, attemptsUsed, maxAttempts } = status;
    const progressPct = Math.min(
      100,
      Math.round((attemptsUsed / maxAttempts) * 100)
    );
    const subjectName = institutionName ?? "your brokerage";
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <Loader2 className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">
              Syncing your {institutionName ? institutionName : "holdings"}…
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Pulling positions from {subjectName}. This usually takes 30
              seconds, sometimes up to 2 minutes for accounts with many
              holdings.
            </p>
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Needs reauth — amber warning, prominent CTA ───────────────────
  if (status.kind === "needs_reauth") {
    const { institutionName, itemId } = status;
    const subjectName = institutionName ?? "your brokerage";
    return (
      <div className="rounded-lg border border-[var(--hold,theme(colors.amber.500))]/40 bg-[var(--hold,theme(colors.amber.500))]/5 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--hold,theme(colors.amber.600))]" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">
              Reconnect {subjectName}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Your connection expired or needs re-approval. Reconnect to
              resume syncing your holdings — no data is lost.
            </p>
            <button
              type="button"
              onClick={() => onReauth?.(itemId)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background hover:bg-foreground/85"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reconnect now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Empty brokerage — info-tone, with support link ────────────────
  if (status.kind === "empty_brokerage") {
    return (
      <div className="rounded-lg border border-border bg-secondary/30 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">
              No holdings yet
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {status.message}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── None — empty-state CTA to connect ─────────────────────────────
  if (status.kind === "none") {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-center">
        <Plug className="mx-auto h-7 w-7 text-muted-foreground" />
        <div className="mt-2 text-[15px] font-semibold">
          Connect a brokerage to get your first review
        </div>
        <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-muted-foreground">
          {status.message}
        </p>
        {onConnect && (
          <button
            type="button"
            onClick={onConnect}
            className="mt-3 inline-flex items-center rounded-md bg-foreground px-4 py-2 text-[13px] font-semibold text-background hover:bg-foreground/85"
          >
            Connect brokerage
          </button>
        )}
      </div>
    );
  }

  // ─── Generic error — muted, so it doesn't scream "broken" ──────────
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">
            Couldn&rsquo;t load today&rsquo;s review
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {status.message} Reloading in a minute usually fixes it.
          </p>
        </div>
      </div>
    </div>
  );
}
