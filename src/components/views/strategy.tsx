"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, Loader2, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";

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

export default function StrategyView() {
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <h2 className="font-serif text-3xl tracking-tight text-[var(--foreground)]">
          AI Strategy
        </h2>
        <p className="text-sm text-muted-foreground">
          A portfolio-level review across value, growth, and macro lenses —
          synthesized into one verdict.
        </p>
      </div>

      {!review && !error && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Portfolio Review</CardTitle>
              <Badge variant="secondary">AI-Powered</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lightbulb className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-medium">Ready for your review</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Three independent models will look at your holdings against
                today&rsquo;s macro backdrop. Requires a linked brokerage.
              </p>
              <Button className="mt-4" onClick={handleGetReview} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Run review
              </Button>
            </div>
          </CardContent>
        </Card>
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
