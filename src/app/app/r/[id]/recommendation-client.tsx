"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Check,
  Copy,
  AlertTriangle,
  X,
  Info,
  ShieldCheck,
} from "lucide-react";
import type { FullRecommendation } from "@/lib/history";

const REC_STYLE: Record<string, string> = {
  BUY: "bg-[var(--buy)]/10 text-[var(--buy)] border-[var(--buy)]/25",
  SELL: "bg-[var(--sell)]/10 text-[var(--sell)] border-[var(--sell)]/25",
  HOLD: "bg-[var(--hold)]/10 text-[var(--hold)] border-[var(--hold)]/25",
  INSUFFICIENT_DATA: "bg-muted text-muted-foreground",
};

type AnalystFromStore = {
  model: "claude" | "gpt" | "gemini";
  status: "ok" | "failed";
  output?: {
    recommendation: string;
    confidence: string;
    thesis: string;
    keySignals: Array<{ signal: string; datum: string; direction: string }>;
    riskFactors: string[];
    missingData: string[];
  };
  error?: string;
  toolCalls?: Array<{ toolName: string; input: unknown; outputSummary: string }>;
};

type AnalysisJson = {
  snapshot?: {
    name?: string;
    price?: number;
    change?: number;
    changePct?: number;
  };
  analyses?: AnalystFromStore[];
  supervisor?: {
    agreedPoints?: string[];
    disagreements?: Array<{
      topic: string;
      claudeView: string;
      gptView: string;
      geminiView: string;
    }>;
    redFlags?: string[];
  };
  supervisorModel?: string;
};

const LENS: Record<string, string> = {
  claude: "Value",
  gpt: "Growth",
  gemini: "Macro",
};

export default function RecommendationClient({
  rec,
}: {
  rec: FullRecommendation;
}) {
  const [copied, setCopied] = useState(false);
  const analysis = (rec.analysisJson ?? {}) as AnalysisJson;
  const snapshot = analysis.snapshot;
  const analyses = analysis.analyses ?? [];
  const supervisor = analysis.supervisor ?? {};

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback — user can copy from the URL bar
      setCopied(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/app/history"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to track record
        </Link>
        <Button size="sm" variant="outline" onClick={copyLink}>
          {copied ? (
            <Check className="mr-2 h-4 w-4" />
          ) : (
            <Copy className="mr-2 h-4 w-4" />
          )}
          {copied ? "Link copied" : "Copy link"}
        </Button>
      </div>

      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          {rec.ticker}
          {snapshot?.name ? (
            <span className="ml-2 text-base font-normal text-muted-foreground">
              · {snapshot.name}
            </span>
          ) : null}
        </h2>
        <p className="text-sm text-muted-foreground">
          Archived analysis from {new Date(rec.createdAt).toLocaleString()}.
          Data as of {new Date(rec.dataAsOf).toLocaleString()}.
        </p>
      </div>

      <Card className="border-[var(--hold)]/30 bg-[var(--hold)]/5">
        <CardContent className="flex items-start gap-3 py-3 text-xs">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--hold)]" />
          <div>
            <span className="font-medium">Archived, not live.</span>{" "}
            Prices, filings, and macro conditions have almost certainly
            changed since this was generated. For informational purposes
            only — not investment advice.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Verdict</CardTitle>
              {analysis.supervisorModel && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Supervisor: {analysis.supervisorModel}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge
                className={`${
                  REC_STYLE[rec.recommendation] ?? "bg-muted"
                } border px-3 py-1 text-sm font-semibold`}
              >
                {rec.recommendation.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {rec.confidence}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {rec.consensus}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed">{rec.summary}</p>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>
              Price at rec:{" "}
              <span className="font-mono text-foreground">
                ${rec.priceAtRec.toFixed(2)}
              </span>
            </span>
            {snapshot?.change !== undefined && (
              <span>
                Day change at rec:{" "}
                <span
                  className={`font-mono ${
                    snapshot.change >= 0
                      ? "text-[var(--buy)]"
                      : "text-[var(--sell)]"
                  }`}
                >
                  {snapshot.change >= 0 ? "+" : ""}
                  {Number(snapshot.change).toFixed(2)}
                  {snapshot.changePct !== undefined
                    ? ` (${snapshot.changePct.toFixed(2)}%)`
                    : ""}
                </span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {rec.outcomes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Outcome tracking</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {rec.outcomes.map((o, i) => (
                <div
                  key={i}
                  className="rounded-md border bg-muted/30 p-3 text-xs"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono font-semibold">{o.window}</span>
                    <span className="text-muted-foreground">{o.status}</span>
                  </div>
                  {o.status === "pending" ? (
                    <p className="mt-2 text-muted-foreground">
                      Evaluation pending.
                    </p>
                  ) : (
                    <>
                      <p className="mt-2 font-mono">
                        {o.priceAtCheck !== null
                          ? `$${Number(o.priceAtCheck).toFixed(2)}`
                          : "—"}
                        {o.percentMove !== null && (
                          <span
                            className={`ml-1 ${
                              Number(o.percentMove) > 0
                                ? "text-[var(--buy)]"
                                : Number(o.percentMove) < 0
                                ? "text-[var(--sell)]"
                                : "text-muted-foreground"
                            }`}
                          >
                            ({Number(o.percentMove) >= 0 ? "+" : ""}
                            {Number(o.percentMove).toFixed(1)}%)
                          </span>
                        )}
                      </p>
                      {o.verdict && (
                        <p className="mt-1 text-muted-foreground">
                          {o.verdict.replace(/_/g, " ")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-muted-foreground">
              Past recommendation outcomes are informational only. Not a
              guarantee of future performance. Not investment advice.
            </p>
          </CardContent>
        </Card>
      )}

      {(supervisor.agreedPoints ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Check className="h-4 w-4" />
              Where our lenses agreed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {(supervisor.agreedPoints ?? []).map((p, i) => (
                <li key={i} className="text-muted-foreground">
                  • {p}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(supervisor.disagreements ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-[var(--hold)]" />
              Disagreements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(supervisor.disagreements ?? []).map((d, i) => (
              <div
                key={i}
                className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs"
              >
                <div className="mb-1.5 font-medium">{d.topic}</div>
                <div className="grid gap-1 text-muted-foreground">
                  <div>
                    <span className="font-mono text-[var(--decisive)]">Claude (Value):</span>{" "}
                    {d.claudeView}
                  </div>
                  <div>
                    <span className="font-mono text-[var(--buy)]">GPT (Growth):</span>{" "}
                    {d.gptView}
                  </div>
                  <div>
                    <span className="font-mono text-[var(--hold)]">Gemini (Macro):</span>{" "}
                    {d.geminiView}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(supervisor.redFlags ?? []).length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <X className="h-4 w-4" />
              Red flags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {(supervisor.redFlags ?? []).map((f, i) => (
                <li key={i}>• {f}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {analyses.length > 0 && (
        <div>
          <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Individual Analyses · Value / Growth / Macro lenses
          </h3>
          <div className="grid gap-4 lg:grid-cols-3">
            {analyses.map((a, i) => (
              <Card key={i}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs">
                      {a.model.toUpperCase()} · {LENS[a.model] ?? ""}
                    </span>
                    {a.status === "ok" && a.output ? (
                      <Badge
                        className={`${
                          REC_STYLE[a.output.recommendation] ?? "bg-muted"
                        } border text-[10px]`}
                      >
                        {a.output.recommendation}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        FAILED
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0 text-xs">
                  {a.status === "ok" && a.output ? (
                    <>
                      <p className="text-muted-foreground leading-relaxed">
                        {a.output.thesis}
                      </p>
                      {a.toolCalls && a.toolCalls.length > 0 && (
                        <div className="rounded-md border border-border/60 bg-muted/40 p-2">
                          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                            Tools called ({a.toolCalls.length})
                          </div>
                          <ul className="space-y-0.5 font-mono text-[10px] text-muted-foreground/90">
                            {a.toolCalls.map((t, j) => (
                              <li key={j} className="truncate">
                                <span className="text-foreground">
                                  {t.toolName}
                                </span>{" "}
                                {typeof t.input === "object" && t.input !== null
                                  ? JSON.stringify(t.input)
                                  : String(t.input)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <Separator />
                      <div className="space-y-1">
                        {a.output.keySignals.map((s, j) => (
                          <div key={j}>
                            <div>{s.signal}</div>
                            <div className="font-mono text-[10px] text-muted-foreground/70">
                              {s.datum}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Risk factors: the single most-cited trust signal
                          in investment AI research — "what would change
                          this view." Already generated by every analyst
                          run; we were discarding it in the UI. */}
                      {a.output.riskFactors && a.output.riskFactors.length > 0 && (
                        <>
                          <Separator />
                          <div>
                            <div className="mb-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--sell)]/80">
                              Risk factors
                            </div>
                            <ul className="space-y-1">
                              {a.output.riskFactors.map((r, j) => (
                                <li
                                  key={j}
                                  className="flex gap-2 leading-relaxed"
                                >
                                  <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--sell)]/60" />
                                  <span>{r}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </>
                      )}

                      {/* Missing data: what the analyst flagged as gaps
                          that would increase their confidence. Good for
                          the user to see what the panel can't see. */}
                      {a.output.missingData && a.output.missingData.length > 0 && (
                        <>
                          <Separator />
                          <div>
                            <div className="mb-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--decisive)]/80">
                              What would raise confidence
                            </div>
                            <ul className="space-y-1">
                              {a.output.missingData.map((m, j) => (
                                <li
                                  key={j}
                                  className="flex gap-2 leading-relaxed text-muted-foreground"
                                >
                                  <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--decisive)]/60" />
                                  <span>{m}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      {a.error ?? "No output"}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 font-mono text-[10px] text-muted-foreground/60">
        <ShieldCheck className="h-3 w-3" />
        Archived · ID {rec.id}
      </div>
    </div>
  );
}
