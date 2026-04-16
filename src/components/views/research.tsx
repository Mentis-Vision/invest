"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  Loader2,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Check,
  X,
} from "lucide-react";
import type { AnalystOutput, SupervisorOutput } from "@/lib/ai/schemas";
import type { StockSnapshot } from "@/lib/data/yahoo";

type ModelKey = "claude" | "gpt" | "gemini";
type ModelResult = {
  model: ModelKey;
  status: "ok" | "failed";
  output?: AnalystOutput;
  error?: string;
};

type ResearchResponse = {
  ticker: string;
  snapshot: StockSnapshot;
  analyses: ModelResult[];
  supervisor: SupervisorOutput;
};

const MODEL_META: Record<ModelKey, { label: string; color: string }> = {
  claude: { label: "Claude Sonnet 4.6", color: "text-orange-400" },
  gpt: { label: "GPT-5.2", color: "text-emerald-400" },
  gemini: { label: "Gemini 3 Pro", color: "text-blue-400" },
};

function recColor(rec: string) {
  if (rec === "BUY") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (rec === "SELL") return "bg-red-500/15 text-red-300 border-red-500/30";
  if (rec === "HOLD") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-slate-500/15 text-slate-300 border-slate-500/30";
}

function confColor(conf: string) {
  if (conf === "HIGH") return "text-emerald-400";
  if (conf === "MEDIUM") return "text-amber-400";
  return "text-red-400";
}

function consensusColor(c: string) {
  if (c === "UNANIMOUS") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (c === "MAJORITY") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (c === "SPLIT") return "bg-red-500/15 text-red-300 border-red-500/30";
  return "bg-slate-500/15 text-slate-300 border-slate-500/30";
}

function DirectionIcon({ d }: { d: "BULLISH" | "BEARISH" | "NEUTRAL" }) {
  if (d === "BULLISH") return <TrendingUp className="h-3 w-3 text-emerald-400" />;
  if (d === "BEARISH") return <TrendingDown className="h-3 w-3 text-red-400" />;
  return <Minus className="h-3 w-3 text-slate-400" />;
}

function ModelCard({ result }: { result: ModelResult }) {
  const meta = MODEL_META[result.model];
  if (result.status === "failed") {
    return (
      <Card className="border-red-500/20 bg-red-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <span className={`font-mono text-xs ${meta.color}`}>{meta.label}</span>
            <Badge variant="outline" className="border-red-500/30 text-[10px] text-red-300">
              FAILED
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-red-300/70">{result.error}</p>
        </CardContent>
      </Card>
    );
  }

  const o = result.output!;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <span className={`font-mono text-xs ${meta.color}`}>{meta.label}</span>
          <div className="flex items-center gap-1.5">
            <Badge className={`${recColor(o.recommendation)} border text-[10px]`}>
              {o.recommendation}
            </Badge>
            <span className={`font-mono text-[10px] uppercase ${confColor(o.confidence)}`}>
              {o.confidence}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-xs">
        <p className="text-muted-foreground leading-relaxed">{o.thesis}</p>
        <Separator />
        <div className="space-y-1.5">
          {o.keySignals.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <DirectionIcon d={s.direction} />
              <div className="flex-1">
                <div className="leading-tight">{s.signal}</div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                  {s.datum}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ResearchView() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const ticker = query.trim().toUpperCase();
    if (!ticker) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      const data: ResearchResponse = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Research</h2>
        <p className="text-sm text-muted-foreground">
          Three independent AI models analyze the same verified data. Supervisor cross-checks.
          Every claim traceable to a source.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Enter ticker (AAPL, NVDA, TSLA, MSFT...)"
                className="pl-9 font-mono uppercase"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" disabled={loading || !query.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing
                </>
              ) : (
                "Analyze"
              )}
            </Button>
          </form>
          {loading && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Fetching data · Running 3 models · Supervisor review... (takes ~30s)
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div className="text-sm text-red-300/90">{error}</div>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-6">
          {/* Verdict card */}
          <Card className="overflow-hidden border-white/10">
            <div className="border-b border-white/[0.06] bg-gradient-to-br from-white/[0.02] to-transparent p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {result.ticker} · {result.snapshot.name}
                  </div>
                  <div className="mt-0.5 font-mono text-sm text-muted-foreground">
                    ${result.snapshot.price.toFixed(2)}{" "}
                    <span
                      className={
                        result.snapshot.change >= 0 ? "text-emerald-400" : "text-red-400"
                      }
                    >
                      {result.snapshot.change >= 0 ? "+" : ""}
                      {result.snapshot.change.toFixed(2)} (
                      {result.snapshot.changePct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge
                    className={`${recColor(result.supervisor.finalRecommendation)} border px-3 py-1 text-sm font-semibold`}
                  >
                    {result.supervisor.finalRecommendation.replace("_", " ")}
                  </Badge>
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase">
                    <span className={confColor(result.supervisor.confidence)}>
                      {result.supervisor.confidence} confidence
                    </span>
                    <span className="text-muted-foreground/50">·</span>
                    <Badge
                      variant="outline"
                      className={`${consensusColor(result.supervisor.consensus)} border text-[10px]`}
                    >
                      {result.supervisor.consensus}
                    </Badge>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed">{result.supervisor.summary}</p>
            </div>

            <CardContent className="space-y-4 p-6">
              {result.supervisor.agreedPoints.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-emerald-400">
                    <Check className="h-3 w-3" />
                    Agreed Points
                  </h4>
                  <ul className="space-y-1 text-sm">
                    {result.supervisor.agreedPoints.map((p, i) => (
                      <li key={i} className="flex gap-2 text-muted-foreground">
                        <span className="text-emerald-400/60">·</span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.supervisor.disagreements.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    Disagreements
                  </h4>
                  <div className="space-y-3">
                    {result.supervisor.disagreements.map((d, i) => (
                      <div key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
                        <div className="mb-1.5 font-medium">{d.topic}</div>
                        <div className="grid gap-1.5 text-muted-foreground">
                          <div>
                            <span className="font-mono text-orange-400">Claude:</span> {d.claudeView}
                          </div>
                          <div>
                            <span className="font-mono text-emerald-400">GPT:</span> {d.gptView}
                          </div>
                          <div>
                            <span className="font-mono text-blue-400">Gemini:</span> {d.geminiView}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.supervisor.redFlags.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-red-400">
                    <X className="h-3 w-3" />
                    Red Flags (Unverified Claims)
                  </h4>
                  <ul className="space-y-1 text-sm">
                    {result.supervisor.redFlags.map((f, i) => (
                      <li key={i} className="flex gap-2 text-red-300/80">
                        <span>·</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 font-mono text-[10px] text-muted-foreground/60">
                <ShieldCheck className="h-3 w-3" />
                Yahoo Finance · {new Date(result.supervisor.dataAsOf).toLocaleString()}
              </div>
            </CardContent>
          </Card>

          {/* Per-model panel */}
          <div>
            <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Individual Analyses · Each model saw the same data independently
            </h3>
            <div className="grid gap-4 lg:grid-cols-3">
              {result.analyses.map((a) => (
                <ModelCard key={a.model} result={a} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
