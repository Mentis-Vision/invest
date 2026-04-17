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
} from "lucide-react";
import { getHoldings, type Holding } from "@/lib/client/holdings-cache";

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
  const [error, setError] = useState<string | null>(null);

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
          AI Strategy
        </h2>
        <p className="text-sm text-muted-foreground">
          A portfolio-level review across value, growth, and macro lenses —
          synthesized into one verdict.
        </p>
      </div>

      {!review && !error && (
        <>
          {/* Run-AI-review CTA — top of page so it's always reachable */}
          <Card className="border-[var(--buy)]/30 bg-[var(--buy)]/5">
            <CardContent className="flex flex-col items-start justify-between gap-3 py-4 sm:flex-row sm:items-center">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--buy)]/10">
                  <Lightbulb className="h-4 w-4 text-[var(--buy)]" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--foreground)]">
                    Ready when you want a portfolio-level read
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    Below is everything we already know about your portfolio
                    at $0 cost. Click below to run the AI review when you
                    want a synthesized verdict.
                  </p>
                </div>
              </div>
              <Button
                onClick={handleGetReview}
                disabled={loading || !connected}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Run AI portfolio review
              </Button>
            </CardContent>
          </Card>

          {!connected && !contextLoading && (
            <Card className="border-[var(--hold)]/30 bg-[var(--hold)]/5">
              <CardContent className="py-4 text-sm text-[var(--muted-foreground)]">
                <span className="font-medium text-[var(--foreground)]">
                  No brokerage linked yet.
                </span>{" "}
                The AI portfolio review needs your holdings.{" "}
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
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Verdict</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {review.holdingsCount} positions · Supervisor: {review.supervisorModel}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={handleGetReview} disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Re-run
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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
              {review.supervisor.topActions.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Top actions
                  </div>
                  <ul className="space-y-2">
                    {review.supervisor.topActions.map((a, i) => {
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
                </div>
              )}
            </CardContent>
          </Card>

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
                    {a.model.toUpperCase()} — {personaLabel(a.model)}
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
  switch (model) {
    case "claude":
      return "Value";
    case "gpt":
      return "Growth";
    case "gemini":
      return "Macro";
    default:
      return model;
  }
}
