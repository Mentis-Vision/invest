"use client";

import { useEffect, useState } from "react";
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
  Info,
  Copy,
} from "lucide-react";
import type { AnalystOutput, SupervisorOutput } from "@/lib/ai/schemas";
import type { StockSnapshot } from "@/lib/data/yahoo";
import DisclaimerModal from "@/components/disclaimer-modal";

type ModelKey = "claude" | "gpt" | "gemini";
type ToolCallTrace = {
  toolName: string;
  input: unknown;
  outputSummary: string;
};
type ModelResult = {
  model: ModelKey;
  status: "ok" | "failed";
  output?: AnalystOutput;
  error?: string;
  tokensUsed?: number;
  toolCalls?: ToolCallTrace[];
  steps?: number;
};

type ResearchResponse = {
  ticker: string;
  snapshot: StockSnapshot;
  analyses: ModelResult[];
  supervisor: SupervisorOutput;
  supervisorModel?: string;
  recommendationId?: string | null;
  toolCalls?: number;
};

type TickerTrackRecord = {
  total: number;
  byRec: Record<string, number>;
  wins30d: number;
  losses30d: number;
  flats30d: number;
};

const MODEL_META: Record<
  ModelKey,
  { label: string; lens: string; color: string }
> = {
  claude: { label: "Claude Sonnet 4.6", lens: "Value", color: "text-[var(--decisive)]" },
  gpt: { label: "GPT-5.2", lens: "Growth", color: "text-[var(--buy)]" },
  gemini: { label: "Gemini 2.5 Pro", lens: "Macro", color: "text-[var(--hold)]" },
};

function recColor(rec: string) {
  if (rec === "BUY") return "bg-[var(--buy)]/10 text-[var(--buy)] border-[var(--buy)]/25";
  if (rec === "SELL") return "bg-[var(--sell)]/10 text-[var(--sell)] border-[var(--sell)]/25";
  if (rec === "HOLD") return "bg-[var(--hold)]/10 text-[var(--hold)] border-[var(--hold)]/25";
  return "bg-muted text-muted-foreground border-border";
}

function confColor(conf: string) {
  if (conf === "HIGH") return "text-[var(--buy)]";
  if (conf === "MEDIUM") return "text-[var(--hold)]";
  return "text-[var(--sell)]";
}

function consensusColor(c: string) {
  if (c === "UNANIMOUS") return "bg-[var(--buy)]/10 text-[var(--buy)] border-[var(--buy)]/25";
  if (c === "MAJORITY") return "bg-[var(--hold)]/10 text-[var(--hold)] border-[var(--hold)]/25";
  if (c === "SPLIT") return "bg-[var(--sell)]/10 text-[var(--sell)] border-[var(--sell)]/25";
  return "bg-muted text-muted-foreground border-border";
}

function DirectionIcon({ d }: { d: "BULLISH" | "BEARISH" | "NEUTRAL" }) {
  if (d === "BULLISH") return <TrendingUp className="h-3 w-3 text-[var(--buy)]" />;
  if (d === "BEARISH") return <TrendingDown className="h-3 w-3 text-[var(--sell)]" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

function ModelCard({ result }: { result: ModelResult }) {
  const meta = MODEL_META[result.model];
  if (result.status === "failed") {
    return (
      <Card className="border-red-500/20 bg-red-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <span className={`font-mono text-xs ${meta.color}`}>
              {meta.label} · {meta.lens}
            </span>
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
  const tools = result.toolCalls ?? [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <span className={`font-mono text-xs ${meta.color}`}>
            {meta.label} · {meta.lens}
          </span>
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
        {tools.length > 0 && (
          <div className="rounded-md border border-border/60 bg-muted/40 p-2">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Tools called ({tools.length})
            </div>
            <ul className="space-y-0.5 font-mono text-[10px] text-muted-foreground/90">
              {tools.map((t, i) => (
                <li key={i} className="truncate" title={t.outputSummary}>
                  <span className="text-foreground">{t.toolName}</span>
                  <span className="ml-1 text-muted-foreground/70">
                    {typeof t.input === "object" && t.input !== null
                      ? JSON.stringify(t.input)
                      : String(t.input)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
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
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [trackRecord, setTrackRecord] = useState<TickerTrackRecord | null>(null);

  async function copyShareLink() {
    if (!result?.recommendationId) return;
    const url = `${window.location.origin}/app/r/${result.recommendationId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  // First-run acknowledgment state
  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/disclaimer")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setDisclaimerChecked(true);
        if (!data.accepted) setDisclaimerOpen(true);
      })
      .catch(() => setDisclaimerChecked(true));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const ticker = query.trim().toUpperCase();
    if (!ticker) return;

    if (disclaimerChecked && disclaimerOpen) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setTrackRecord(null);

    // Fire the track-record fetch in parallel with the research request.
    // It's cheap and returns before the AI pipeline does — we render the
    // strip as soon as it lands.
    fetch(`/api/track-record/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TickerTrackRecord | null) => {
        if (data && data.total > 0) setTrackRecord(data);
      })
      .catch(() => {});

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
      <DisclaimerModal
        open={disclaimerOpen}
        onAccept={() => setDisclaimerOpen(false)}
      />
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Research</h2>
        <p className="text-sm text-muted-foreground">
          Three independent AI models analyze the same verified data. Supervisor cross-checks.
          Every claim traceable to a source.
        </p>
      </div>

      <Card className="border-[var(--hold)]/30 bg-[var(--hold)]/5">
        <CardContent className="flex items-start gap-3 py-3 text-xs">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--hold)]" />
          <div>
            <span className="font-medium">For informational purposes only.</span>{" "}
            Not investment advice. Not a recommendation to buy or sell any
            security. Consult a licensed financial advisor before making any
            decision with your money.
          </div>
        </CardContent>
      </Card>

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

      {trackRecord && trackRecord.total > 0 && (
        <Card className="border-border/60 bg-muted/30">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-xs">
            <div className="font-mono uppercase tracking-[0.15em] text-muted-foreground">
              Our track record on {query.trim().toUpperCase()}
            </div>
            <div className="flex items-center gap-3">
              <span>
                <span className="font-medium">{trackRecord.total}</span> past{" "}
                {trackRecord.total === 1 ? "analysis" : "analyses"}
              </span>
              {Object.entries(trackRecord.byRec).map(([rec, count]) => (
                <Badge
                  key={rec}
                  variant="outline"
                  className={`${recColor(rec)} border text-[10px]`}
                >
                  {count} {rec}
                </Badge>
              ))}
            </div>
            {trackRecord.wins30d + trackRecord.losses30d + trackRecord.flats30d > 0 && (
              <div className="flex items-center gap-3 border-l border-border/60 pl-6">
                <span className="text-muted-foreground">At 30 days:</span>
                {trackRecord.wins30d > 0 && (
                  <span className="text-[var(--buy)]">
                    {trackRecord.wins30d} win{trackRecord.wins30d === 1 ? "" : "s"}
                  </span>
                )}
                {trackRecord.losses30d > 0 && (
                  <span className="text-[var(--sell)]">
                    {trackRecord.losses30d} loss
                    {trackRecord.losses30d === 1 ? "" : "es"}
                  </span>
                )}
                {trackRecord.flats30d > 0 && (
                  <span className="text-muted-foreground">
                    {trackRecord.flats30d} flat
                  </span>
                )}
              </div>
            )}
            <a
              href="/app/history"
              className="ml-auto text-[10px] text-muted-foreground underline-offset-4 hover:underline"
            >
              See all →
            </a>
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
              {result.recommendationId && (
                <div className="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={copyShareLink}
                    className="text-xs"
                  >
                    {copied ? (
                      <Check className="mr-1.5 h-3 w-3" />
                    ) : (
                      <Copy className="mr-1.5 h-3 w-3" />
                    )}
                    {copied ? "Link copied" : "Copy shareable link"}
                  </Button>
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    Archives this verdict at /app/r/{result.recommendationId.slice(0, 8)}…
                  </span>
                </div>
              )}
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
            <h3 className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              <span>Individual Analyses · Value / Growth / Macro lenses</span>
              {result.toolCalls !== undefined && result.toolCalls > 0 && (
                <span className="rounded-sm border border-border/60 px-1.5 py-0.5 normal-case tracking-normal text-muted-foreground/80">
                  {result.toolCalls} live tool {result.toolCalls === 1 ? "call" : "calls"}
                </span>
              )}
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
