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
  TrendingDown,
  Minus,
  AlertTriangle,
  CalendarClock,
  PieChart,
  History as HistoryIcon,
  Clock,
  ChevronDown,
  ChevronUp,
  Zap,
} from "lucide-react";
import { getHoldings, type Holding } from "@/lib/client/holdings-cache";
import { WarehouseFreshness } from "@/components/warehouse-freshness";

type Review = {
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
};

const HEALTH_STYLE: Record<string, string> = {
  STRONG: "text-[var(--buy)]",
  BALANCED: "text-foreground",
  FRAGILE: "text-[var(--hold)]",
  AT_RISK: "text-[var(--sell)]",
};

const ACTION_ICON: Record<string, typeof TrendingUp> = {
  INCREASE: TrendingUp,
  REDUCE: TrendingDown,
  REVIEW: Minus,
};

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

export default function StrategyView() {
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  // Default to collapsed: lead with the Next Move hero; "dissertation"
  // content (where the three lenses disagreed, full red-flag lists, per-
  // lens panels) lives behind a toggle. Daily flow is: glance, decide,
  // move on. Power-user deep-read is still one click away.
  const [showFullBrief, setShowFullBrief] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while the initial GET is fetching the cached overnight review
  // — distinct from `loading` (which gates the explicit POST re-run).
  const [reviewBootstrapping, setReviewBootstrapping] = useState(true);

  // First-load: try to fetch today's pre-computed overnight review via
  // GET (cache hit, $0). The cron pre-runs every connected user's
  // review so first login lands instantly with no AI spend.
  useEffect(() => {
    let alive = true;
    fetch("/api/portfolio-review")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data || data.error) return;
        setReview(data as Review);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReviewBootstrapping(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Pre-loaded context — all $0, no AI. Renders the moment the page mounts
  // so the user has something useful to look at before deciding whether to
  // spend AI on a full review.
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [connected, setConnected] = useState(false);
  const [macro, setMacro] = useState<Macro>([]);
  const [recentRecs, setRecentRecs] = useState<RecentRec[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [contextLoading, setContextLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getHoldings().catch(() => null),
      fetch("/api/macro")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/track-record")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/upcoming-evaluations")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([h, m, t, e]) => {
      if (!alive) return;
      const hs = (h?.holdings ?? []) as Holding[];
      setHoldings(hs);
      setTotalValue(h?.totalValue ?? 0);
      setConnected(!!h?.connected);
      setMacro(((m as { snapshot?: Macro } | null)?.snapshot ?? []) as Macro);
      setRecentRecs(
        ((t as { recent?: RecentRec[] } | null)?.recent ?? []).slice(0, 6)
      );
      // Reuse the upcoming-evaluations payload — it surfaces the
      // research outcome cadence; events from the warehouse would be
      // a separate fetch we can add later.
      setUpcomingEvents([]);
      // Stop the spinner once any of the four resolved.
      setContextLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Sector composition + concentration warnings (heuristic, $0)
  const composition = useMemo(() => {
    if (totalValue <= 0 || holdings.length === 0) return null;
    const sectorBuckets = new Map<string, number>();
    for (const h of holdings) {
      const k = h.sector ?? h.assetClass ?? "Unclassified";
      sectorBuckets.set(k, (sectorBuckets.get(k) ?? 0) + (h.value ?? 0));
    }
    const sorted = [...sectorBuckets.entries()]
      .map(([sector, value]) => ({
        sector,
        value,
        pct: (value / totalValue) * 100,
      }))
      .sort((a, b) => b.value - a.value);
    const topPosition = holdings.reduce(
      (max, h) => (h.value > max.value ? h : max),
      holdings[0]
    );
    const topPositionPct = totalValue > 0
      ? (topPosition.value / totalValue) * 100
      : 0;
    return { sectors: sorted, topPosition, topPositionPct };
  }, [holdings, totalValue]);

  const concentrationFlags = useMemo(() => {
    const flags: Array<{ severity: "warn" | "info"; message: string }> = [];
    if (composition) {
      if (composition.topPositionPct >= 40) {
        flags.push({
          severity: "warn",
          message: `${composition.topPosition.ticker} is ${composition.topPositionPct.toFixed(0)}% of your portfolio — material single-position risk.`,
        });
      } else if (composition.topPositionPct >= 25) {
        flags.push({
          severity: "info",
          message: `${composition.topPosition.ticker} is ${composition.topPositionPct.toFixed(0)}% of your portfolio — concentrated position.`,
        });
      }
      const topSector = composition.sectors[0];
      if (topSector && topSector.pct >= 50) {
        flags.push({
          severity: "warn",
          message: `${topSector.sector} sector is ${topSector.pct.toFixed(0)}% of your portfolio — heavy single-sector exposure.`,
        });
      } else if (topSector && topSector.pct >= 35) {
        flags.push({
          severity: "info",
          message: `${topSector.sector} sector is ${topSector.pct.toFixed(0)}% of your portfolio.`,
        });
      }
    }
    return flags;
  }, [composition]);

  async function handleGetReview() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio-review", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not generate a review.");
        setReview(null);
        return;
      }
      setReview(data as Review);
    } catch {
      setError("Review failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Strategy
        </h2>
        <p className="text-sm text-muted-foreground">
          Your daily glance: the single next move worth considering,
          followed by the evidence behind it. Quality / Momentum / Context
          lenses cross-examine your whole portfolio and synthesize into
          one verdict.
        </p>
      </div>

      {/* Status card explaining where the AI review comes from. Shape
          depends on whether we're still bootstrapping the GET, whether
          a cached review exists, or whether the user needs to kick a
          first run themselves. */}
      {reviewBootstrapping ? (
        <Card className="border-[var(--border)] bg-[var(--secondary)]/30">
          <CardContent className="flex items-center gap-3 py-4 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading this morning&rsquo;s portfolio review…
          </CardContent>
        </Card>
      ) : review ? null /* a review is loaded — the rendered review block already explains its provenance */ : !error ? (
        <>
          {/* No cached review yet — usually a brand-new connection where
              the cron hasn't seen this user. Offer to run live.          */}
          <Card className="border-[var(--buy)]/30 bg-[var(--buy)]/5">
            <CardContent className="flex flex-col items-start justify-between gap-3 py-4 sm:flex-row sm:items-center">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--buy)]/10">
                  <Lightbulb className="h-4 w-4 text-[var(--buy)]" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--foreground)]">
                    Your first portfolio review
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    Your portfolio review is refreshed automatically each
                    morning. Since this is your first time (or a brand-new
                    connection), kick one off now — from tomorrow onward
                    a fresh read will be waiting when you sign in.
                  </p>
                </div>
              </div>
              <Button
                onClick={handleGetReview}
                disabled={loading || !connected}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Run portfolio review
              </Button>
            </CardContent>
          </Card>

          <WarehouseFreshness variant="card" />
        </>
      ) : null}

      {!review && !error && !reviewBootstrapping && (
        <>

          {!connected && !contextLoading && (
            <Card className="border-[var(--hold)]/30 bg-[var(--hold)]/5">
              <CardContent className="py-4 text-sm text-[var(--muted-foreground)]">
                <span className="font-medium text-[var(--foreground)]">
                  No brokerage linked yet.
                </span>{" "}
                A portfolio review needs your holdings to look at.{" "}
                <Link
                  href="/app?view=portfolio"
                  className="text-[var(--foreground)] underline underline-offset-4 hover:text-[var(--buy)]"
                >
                  Link an account →
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Composition + concentration */}
          {composition && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <PieChart className="h-4 w-4 text-[var(--muted-foreground)]" />
                  Composition
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      Total
                    </div>
                    <div className="font-mono tabular-nums text-base">
                      {money(totalValue)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      Positions
                    </div>
                    <div className="font-mono tabular-nums text-base">
                      {holdings.length}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                      Largest position
                    </div>
                    <div className="font-mono tabular-nums text-base">
                      {composition.topPosition.ticker} ·{" "}
                      {composition.topPositionPct.toFixed(0)}%
                    </div>
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    Sector mix
                  </div>
                  <ul className="space-y-1.5">
                    {composition.sectors.slice(0, 6).map((s) => (
                      <li
                        key={s.sector}
                        className="flex items-baseline justify-between gap-3 text-xs"
                      >
                        <span className="text-[var(--foreground)]">
                          {s.sector}
                        </span>
                        <span className="font-mono tabular-nums text-[var(--muted-foreground)]">
                          {money(s.value)} · {s.pct.toFixed(1)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          {concentrationFlags.length > 0 && (
            <Card className="border-[var(--decisive)]/30 bg-[var(--decisive)]/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-[var(--decisive)]" />
                  Concentration flags
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {concentrationFlags.map((f, i) => (
                    <li
                      key={i}
                      className={`flex gap-2 ${
                        f.severity === "warn"
                          ? "text-[var(--foreground)]"
                          : "text-[var(--muted-foreground)]"
                      }`}
                    >
                      <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--decisive)]/60" />
                      <span>{f.message}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Macro context */}
          {macro.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TrendingUp className="h-4 w-4 text-[var(--muted-foreground)]" />
                  Macro backdrop
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {macro.slice(0, 4).map((m) => {
                    const direction = m.deltaLabel?.startsWith("+")
                      ? "up"
                      : m.deltaLabel?.startsWith("-") ||
                          m.deltaLabel?.startsWith("−")
                        ? "down"
                        : "flat";
                    return (
                      <div key={m.indicator}>
                        <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] truncate">
                          {m.indicator}
                        </div>
                        <div className="mt-0.5 font-mono tabular-nums text-sm">
                          {m.value}
                        </div>
                        {m.deltaLabel && (
                          <div
                            className={`text-[10px] font-mono tabular-nums ${
                              direction === "up"
                                ? "text-[var(--buy)]"
                                : direction === "down"
                                  ? "text-[var(--sell)]"
                                  : "text-[var(--muted-foreground)]"
                            }`}
                          >
                            {m.deltaLabel}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent recommendations */}
          {recentRecs.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-baseline justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <HistoryIcon className="h-4 w-4 text-[var(--muted-foreground)]" />
                    Your recent calls
                  </CardTitle>
                  <Link
                    href="/app/history"
                    className="text-[11px] text-[var(--muted-foreground)] underline underline-offset-4 hover:text-[var(--foreground)]"
                  >
                    Full history →
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-[var(--border)]">
                  {recentRecs.map((r) => (
                    <li
                      key={r.id}
                      className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-3 py-2 text-sm"
                    >
                      <span className="font-mono font-medium">{r.ticker}</span>
                      <span className="text-[11px] text-[var(--muted-foreground)] font-mono tabular-nums">
                        {r.createdAt.slice(0, 10)}
                      </span>
                      <Badge
                        variant="outline"
                        className={`${
                          r.recommendation === "BUY"
                            ? "border-[var(--buy)]/30 text-[var(--buy)]"
                            : r.recommendation === "SELL"
                              ? "border-[var(--sell)]/30 text-[var(--sell)]"
                              : "border-[var(--hold)]/30 text-[var(--hold)]"
                        } text-[10px]`}
                      >
                        {r.recommendation}
                      </Badge>
                      <Link
                        href={`/app/r/${r.id}`}
                        className="text-[11px] text-[var(--muted-foreground)] underline-offset-4 hover:text-[var(--foreground)] hover:underline"
                      >
                        view →
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {contextLoading && (
            <div className="flex items-center justify-center py-6 text-xs text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Loading portfolio context…
            </div>
          )}
        </>
      )}

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 text-sm">
            <p className="text-destructive">{error}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={handleGetReview}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {review && (
        <>
          {/* Provenance + freshness header. Plain English only — no
              mention of tokens, models, or the nightly job. Users care
              that it's current, not how it was generated. */}
          <Card className="border-[var(--border)] bg-[var(--secondary)]/30">
            <CardContent className="flex flex-col items-start justify-between gap-2 py-3 sm:flex-row sm:items-center">
              <div className="flex items-start gap-2.5 text-xs">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                <div>
                  {review.cached && review.cachedAt ? (
                    <>
                      <span className="font-medium text-[var(--foreground)]">
                        Refreshed at{" "}
                        {new Date(review.cachedAt).toLocaleTimeString(
                          "en-US",
                          { hour: "numeric", minute: "2-digit" }
                        )}{" "}
                        today
                      </span>{" "}
                      <span className="text-[var(--muted-foreground)]">
                        — fresh prices and headlines arrive each morning,
                        so the read won&rsquo;t change much before tomorrow.
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-[var(--foreground)]">
                        Just generated
                      </span>{" "}
                      <span className="text-[var(--muted-foreground)]">
                        — your next refreshed read lands tomorrow morning.
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleGetReview}
                disabled={loading}
                className="text-xs"
              >
                {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Refresh now
              </Button>
            </CardContent>
          </Card>

          {/* ─── NEXT MOVE hero — the single take-away of the day ─── */}
          <NextMoveHero review={review} />

          {/* ─── Quick glance card — health + one-line summary ─── */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Portfolio health</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Across {review.holdingsCount} positions
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline gap-3">
                <div
                  className={`text-3xl font-semibold tracking-tight ${HEALTH_STYLE[review.supervisor.overallHealth] ?? ""}`}
                >
                  {review.supervisor.overallHealth.replace("_", " ")}
                </div>
                <Badge variant="outline">
                  {review.supervisor.confidence} confidence
                </Badge>
                <Badge variant="outline">{review.supervisor.consensus}</Badge>
              </div>
              <p className="text-sm leading-relaxed">{review.supervisor.summary}</p>
            </CardContent>
          </Card>

          {/* ─── Full brief toggle ─── */}
          <div className="flex items-center justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFullBrief((v) => !v)}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {showFullBrief ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  Hide full brief
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  See the full brief
                  {review.supervisor.topActions.length > 1 && (
                    <span className="ml-1 text-muted-foreground/70">
                      · {review.supervisor.topActions.length - 1} more{" "}
                      {review.supervisor.topActions.length - 1 === 1 ? "action" : "actions"}
                    </span>
                  )}
                </>
              )}
            </Button>
          </div>

          {showFullBrief && (
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
                        const Icon = ACTION_ICON[first] ?? Minus;
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
          )}

          <p className="text-xs text-muted-foreground">
            For informational purposes only. Not investment advice. Not a
            recommendation to buy or sell any security. Consult a licensed
            financial advisor before making decisions.
          </p>
        </>
      )}
    </div>
  );
}

function personaLabel(model: string): string {
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

/**
 * Next Move hero — the single most important action surfaced with
 * maximum prominence. Designed for a 3-second read: priority chip,
 * the action sentence, one-line rationale.
 *
 * Pulls from `review.supervisor.topActions[0]`. If there are no
 * actions (calm-portfolio outcome), shows a steady-state affirmation
 * instead of a missing card — the user's daily glance should always
 * land somewhere meaningful.
 */
function NextMoveHero({ review }: { review: Review }) {
  const top = review.supervisor.topActions[0];

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

  // Extract verb (INCREASE / REDUCE / REVIEW / etc.) for the icon + tone
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
