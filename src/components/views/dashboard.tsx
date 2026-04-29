"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, Check, ChevronDown, ChevronUp } from "lucide-react";
import { getHoldings } from "@/lib/client/holdings-cache";
import BlockGrid, { type BlockGridHandle } from "@/components/dashboard/block-grid";
import { DrillProvider } from "@/components/dashboard/drill-context";
import DrillPanel from "@/components/dashboard/drill-panel";
import { Button } from "@/components/ui/button";
import { NextMoveHero, type Review } from "@/components/dashboard/next-move-hero";
import { StrategyFullBrief } from "@/components/views/strategy";
import { CompactCounterfactual } from "@/components/dashboard/compact-counterfactual";
import { RiskRadarCard } from "@/components/dashboard/risk-radar-card";
import {
  ReviewStatusBanner,
  type ReviewStatus,
} from "@/components/dashboard/review-status-banner";
import { WidgetBoundary } from "@/components/dashboard/widget-boundary";

/**
 * Dashboard (hybrid-v2 redesign).
 *
 * Layout:
 *   [Next Move hero (if review loaded)]
 *   [See the full brief toggle]
 *   [greeting] ———————————— [date] [⚙ Customize]
 *   [BlockGrid — customizable]
 *
 * The Customize button lives here (in the page header) rather than
 * inside BlockGrid so the grid has one less vertical element and the
 * toggle is always visible at the top of the page alongside the date.
 */
export default function DashboardView({
  userName,
  onNavigateToPortfolio,
}: {
  userName?: string;
  onNavigateToPortfolio?: () => void;
}) {
  return (
    <DrillProvider>
      <DashboardBody
        userName={userName ?? "there"}
        onNavigateToPortfolio={onNavigateToPortfolio}
      />
      <DrillPanel />
    </DrillProvider>
  );
}

function DashboardBody({
  userName,
  onNavigateToPortfolio,
}: {
  userName: string;
  onNavigateToPortfolio?: () => void;
}) {
  const gridRef = useRef<BlockGridHandle>(null);
  const [editing, setEditing] = useState(false);
  const [dayChangePct, setDayChangePct] = useState<number | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  // ── Review state (for Next Move hero) ────────────────────────────
  const [review, setReview] = useState<Review | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>({
    kind: "loading",
  });
  const [showFullBrief, setShowFullBrief] = useState(false);

  // ── Latest strategy action (for compact counterfactual strip) ────
  const [latestStrategyRecId, setLatestStrategyRecId] = useState<string | null>(null);

  // ── Hydration-safe time-dependent strings ────────────────────────
  // Server renders in UTC; the user is in their own timezone. If we
  // compute greeting/date at render time, SSR and client hydration
  // produce different text and React throws #418 (hydration mismatch),
  // which cascades into a Base UI menu error when the dropdown tries
  // to render into the broken tree. So we start empty (matches SSR
  // output byte-for-byte) and fill in after mount.
  const [greeting, setGreeting] = useState("");
  const [dayString, setDayString] = useState("");

  // Fetch the cached portfolio review (same endpoint Strategy used).
  // GET hits the nightly cache — $0 AI spend on page load.
  //
  // The endpoint returns one of several honest states when holdings
  // are empty: "syncing" (brokerage just linked, wait), "needs_reauth"
  // (expired connection, click to renew), "empty_brokerage" (synced
  // but no positions returned), or "none" (user never connected).
  // For "syncing" we auto-poll at the endpoint-provided cadence until
  // either success or a 3-minute cap — past that we show a softer
  // "taking longer than expected" card with a support link.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const MAX_SYNC_ATTEMPTS = 12; // × 15s default = 3 min
    let attempts = 0;

    async function load() {
      if (!alive) return;
      try {
        const res = await fetch("/api/portfolio-review");
        if (!alive) return;
        const body = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (res.ok && !body.error) {
          setReview(body as unknown as Review);
          setReviewStatus({ kind: "ok" });
          return;
        }
        const code = String(body.error ?? "");
        const instName = (body.institutionName as string | null) ?? null;

        if (code === "syncing") {
          const nextAttempts = attempts + 1;
          attempts = nextAttempts;
          setReviewStatus({
            kind: "syncing",
            institutionName: instName,
            retryAfterSec: Number(body.retryAfterSec ?? 15),
            attemptsUsed: nextAttempts,
            maxAttempts: MAX_SYNC_ATTEMPTS,
          });
          if (nextAttempts < MAX_SYNC_ATTEMPTS) {
            const wait = Math.max(
              5,
              Math.min(60, Number(body.retryAfterSec ?? 15))
            );
            timer = setTimeout(load, wait * 1000);
          } else {
            setReviewStatus({
              kind: "empty_brokerage",
              institutionName: instName,
              message:
                "Sync is taking longer than usual. If this persists for more than 10 minutes, email support@clearpathinvest.app and we'll look into it.",
            });
          }
          return;
        }
        if (code === "needs_reauth") {
          setReviewStatus({
            kind: "needs_reauth",
            institutionName: instName,
            itemId: String(body.itemId ?? ""),
          });
          return;
        }
        if (code === "empty_brokerage") {
          setReviewStatus({
            kind: "empty_brokerage",
            institutionName: instName,
            message:
              (body.message as string) ??
              "We connected but haven't received holdings yet.",
          });
          return;
        }
        if (code === "none") {
          setReviewStatus({
            kind: "none",
            message:
              (body.message as string) ??
              "Link a brokerage to see your portfolio.",
          });
          return;
        }
        if (code === "monthly_limit") {
          setReviewStatus({
            kind: "error",
            message:
              (body.message as string) ?? "Monthly budget reached.",
          });
          return;
        }
        setReviewStatus({
          kind: "error",
          message:
            (body.message as string) ??
            "Couldn't load today's review.",
        });
      } catch {
        if (alive) {
          setReviewStatus({
            kind: "error",
            message: "Network error — check your connection.",
          });
        }
      }
    }

    load();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Fetch most recent Strategy-sourced rec (last 48 h) for the
  // compact counterfactual strip below the hero.
  useEffect(() => {
    let alive = true;
    fetch("/api/journal/latest-strategy-action")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && alive && setLatestStrategyRecId(d.id))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const timeTimer = setTimeout(() => {
      if (!alive) return;
      setGreeting(timeGreeting());
      setDayString(
        new Date().toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        })
      );
    }, 0);

    // Day change comes from the holdings endpoint now — it computes
    // per-position price moves so the number stays correct on days
    // when an account is added or removed. The old snapshot-diff
    // approach misread a freshly linked $764k Schwab account as a
    // +29,117% gain.
    getHoldings()
      .then((d) => {
        if (!alive) return;
        setConnected(!!d.connected);
        setDayChangePct(d.dayChangePct ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
      clearTimeout(timeTimer);
    };
  }, []);

  const firstName = userName.split(" ")[0];

  function handleCustomizeClick() {
    gridRef.current?.toggleEdit();
    setEditing((v) => !v);
  }

  return (
    <div className="space-y-4">
      {/* ── Review status banner — syncing / reauth / empty / none.
          Renders null when the review loaded successfully. Replaces
          the old behavior of silently hiding the hero on any error. */}
      <ReviewStatusBanner
        status={reviewStatus}
        onConnect={onNavigateToPortfolio}
        onReauth={() => onNavigateToPortfolio?.()}
      />

      {/* ── Next Move hero — above the greeting, below nothing ── */}
      {review && (
        <WidgetBoundary name="Next Move">
          <NextMoveHero
            review={review}
            onStateChange={(s) =>
              setReview((cur) => (cur ? { ...cur, nextMoveState: s } : cur))
            }
          />
        </WidgetBoundary>
      )}

      {/* Full brief — inline expand under the hero */}
      {review && showFullBrief && (
        <WidgetBoundary name="Full brief">
          <StrategyFullBrief review={review} />
        </WidgetBoundary>
      )}

      {/* Toggle — only shown when a review is available */}
      {review && (
        <div className="flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFullBrief((v) => !v)}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {showFullBrief ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> Hide full brief
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" /> See the full brief
              </>
            )}
          </Button>
        </div>
      )}

      {/* Compact counterfactual strip — shown when user acted on a
          recent Strategy rec in the last 48 h. Null-renders silently
          when no qualifying action exists. */}
      {latestStrategyRecId && (
        <WidgetBoundary name="Counterfactual">
          <CompactCounterfactual recId={latestStrategyRecId} />
        </WidgetBoundary>
      )}

      <WidgetBoundary name="Risk Radar">
        <RiskRadarCard />
      </WidgetBoundary>

      {/* Header row: greeting (left) · date + Customize (right) */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-2">
        <h1
          // Time-dependent text is populated in useEffect; suppress
          // hydration warnings on this node so React doesn't error if
          // the server-rendered empty string differs from the client
          // value between re-render and paint.
          suppressHydrationWarning
          className="text-[20px] font-semibold tracking-[-0.02em] text-foreground md:text-[22px]"
        >
          {greeting ? (
            <>
              {greeting}, {firstName}.{" "}
            </>
          ) : (
            <>Welcome, {firstName}.{" "}</>
          )}
          {connected === false ? (
            <span className="font-normal text-muted-foreground">
              Link a brokerage to see your portfolio.
            </span>
          ) : dayChangePct != null ? (
            <>
              Portfolio is{" "}
              <span
                className={`font-medium ${
                  dayChangePct > 0
                    ? "text-[var(--buy)]"
                    : dayChangePct < 0
                      ? "text-[var(--sell)]"
                      : "text-muted-foreground"
                }`}
              >
                {dayChangePct > 0 ? "+" : ""}
                {dayChangePct.toFixed(2)}% today
              </span>
              .
            </>
          ) : (
            <span className="font-normal text-muted-foreground">
              Loading your latest…
            </span>
          )}
        </h1>
        <div className="flex items-center gap-3">
          <span
            suppressHydrationWarning
            className="text-[12px] text-muted-foreground"
          >
            {dayString}
          </span>
          <button
            type="button"
            onClick={handleCustomizeClick}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
              editing
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-foreground/80 hover:border-primary/50 hover:text-foreground"
            }`}
          >
            {editing ? (
              <>
                <Check className="h-3.5 w-3.5" /> Done
              </>
            ) : (
              <>
                <Settings className="h-3.5 w-3.5" /> Customize
              </>
            )}
          </button>
        </div>
      </div>

      <BlockGrid ref={gridRef} />
    </div>
  );
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Up late";
}
