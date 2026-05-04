"use client";

import { useEffect, useRef, useState } from "react";
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
import OutcomePing from "@/components/outcome-ping";
import { getHoldings } from "@/lib/client/holdings-cache";
import ResearchStarter from "@/components/research/research-starter";
import { DossierHero } from "@/components/research/dossier-hero";
import { SectorRail } from "@/components/research/sector-rail";
import { MiniSparkline } from "@/components/research/mini-sparkline";
import { WorthReading } from "@/components/research/worth-reading";
import { LookCloserAtHoldings } from "@/components/research/look-closer-at-holdings";
import { EventsThisWeek } from "@/components/research/events-this-week";
import { PastCallsStrip } from "@/components/research/past-calls-strip";
import { RecentSearchesStrip } from "@/components/research/recent-searches-strip";
import { DecisionEngineCard } from "@/components/research/decision-engine-card";
import type { DecisionEngineOutput } from "@/lib/decision-engine/types";

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

type QuickScanResponse = {
  ticker: string;
  mode: "quick";
  output: {
    recommendation: "BUY" | "HOLD" | "SELL" | "INSUFFICIENT_DATA";
    confidence: "LOW" | "MEDIUM" | "HIGH";
    oneLiner: string;
    signals: string[];
    primaryRisk: string;
  };
  snapshot: StockSnapshot;
  /** 30-day close history for the inline sparkline. Empty when unavailable. */
  priceHistory?: number[];
  tokensUsed: number;
  costCents: number;
  cached?: boolean;
  cachedAt?: string | null;
  cachedAgeSec?: number | null;
  usage?: { tier: string; remainingCents: number };
};

type StandardResponse = {
  ticker: string;
  mode: "deep" | "standard";
  lens: "claude" | "gpt" | "gemini";
  snapshot: StockSnapshot;
  /** 30-day close history for the inline sparkline. Empty when unavailable. */
  priceHistory?: number[];
  analysis: ModelResult;
  /** Bull/Bear adversarial debate run on the single analyst's output. */
  debate?: DebateResult | null;
  tokensUsed: number;
  cached?: boolean;
  cachedAt?: string | null;
  cachedAgeSec?: number | null;
  usage?: { tier: string; remainingCents: number };
};

type DebateSide = {
  side: "bull" | "bear";
  thesis: string;
  reasons: Array<{ point: string; citation: string }>;
  conditionThatWouldChangeMind: string;
};

type DebateResult = {
  bull: DebateSide | null;
  bear: DebateSide | null;
  bullTokens?: number;
  bearTokens?: number;
};

type ResearchResponse = {
  ticker: string;
  snapshot: StockSnapshot;
  analyses: ModelResult[];
  /** Adversarial bull/bear debate that ran between analyst panel and supervisor. */
  debate?: DebateResult | null;
  decisionEngine?: DecisionEngineOutput | null;
  supervisor: SupervisorOutput;
  supervisorModel?: string;
  recommendationId?: string | null;
  toolCalls?: number;
  cached?: boolean;
  cachedAt?: string | null;
  cachedAgeSec?: number | null;
};

type TickerTrackRecord = {
  total: number;
  byRec: Record<string, number>;
  wins30d: number;
  losses30d: number;
  flats30d: number;
};

type InsiderTransaction = {
  accession: string;
  filedOn: string;
  filerName: string | null;
  filerTitle: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  transactionDate: string | null;
  transactionCode: string | null;
  acquiredDisposed: "A" | "D" | null;
  shares: number | null;
  pricePerShare: number | null;
  approxDollarValue: number | null;
  sharesOwnedAfter: number | null;
};

type InsiderAggregates = {
  ticker: string;
  windowDays: number;
  filings: number;
  transactions: number;
  buys: number;
  sells: number;
  officerBuys: number;
  officerSells: number;
  netShares: number;
  netDollarValue: number;
  lastActivityAt: string | null;
  recent?: InsiderTransaction[];
};

type WallStreetConsensus = {
  ticker: string;
  asOf: string;
  recommendationKey: string | null;
  recommendationMean: number | null;
  numberOfAnalystOpinions: number | null;
  targetMean: number | null;
  targetMedian: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  upgradesDowngrades?: Array<{
    firm: string;
    date: string;
    fromGrade: string | null;
    toGrade: string | null;
    action: string | null;
  }>;
};

type NewsResponse = {
  ticker: string;
  configured: boolean;
  source: "finnhub" | "yahoo";
  items: Array<{
    datetime: string | null;
    headline: string;
    source?: string | null;
    publisher?: string | null;
    summary: string | null;
    url?: string | null;
  }>;
  sentiment: { bearishPercent: number; bullishPercent: number } | null;
  buzz: {
    articlesInLastWeek: number;
    weeklyAverage: number;
    buzz: number;
  } | null;
  companyNewsScore?: number | null;
  sectorAverageNewsScore?: number | null;
};

const MODEL_META: Record<
  ModelKey,
  { label: string; lens: string; color: string }
> = {
  // User-facing labels map to investment-lens framing, NOT the underlying
  // model brand. We keep the keys (claude/gpt/gemini) because the API uses
  // them internally, but the UI surfaces the lens name.
  claude: { label: "Value", lens: "Graham-Dodd discipline", color: "text-[var(--decisive)]" },
  gpt: { label: "Growth", lens: "TAM + compounding", color: "text-[var(--buy)]" },
  gemini: { label: "Macro", lens: "Regime + contrarian", color: "text-[var(--hold)]" },
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

function cachedAgeLabel(sec: number): string {
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

/**
 * Inline freshness chip for the corner of a research card. No mention
 * of models, tokens, or AI — just when the read was last refreshed and
 * a soft note that newer data arrives tomorrow.
 *
 * Two states:
 *   - cached: shown alongside the title to communicate "this was already
 *     done earlier today, you're seeing the same result"
 *   - live:   shown alongside the title to communicate "just-now read"
 */
function FreshnessChip({
  cached,
  cachedAgeSec,
}: {
  cached?: boolean;
  cachedAgeSec?: number | null;
}) {
  const label = cached
    ? cachedAgeSec != null
      ? `Updated ${cachedAgeLabel(cachedAgeSec)}`
      : "Updated earlier today"
    : "Just now";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
      {label}
    </span>
  );
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

export default function ResearchView({
  initialTicker,
  onNavigateToPortfolio,
}: {
  initialTicker?: string | null;
  onNavigateToPortfolio?: () => void;
}) {
  const [query, setQuery] = useState(initialTicker ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResearchResponse | null>(null);
  // Default depth is "quick" — cheap, fast, never leaves the user waiting.
  // Smart-routing in handleSearch may upgrade to "full" based on context
  // (e.g. user already holds the ticker and has prior research on it).
  // Users can manually override via the "Adjust depth" toggle below.
  const [mode, setMode] = useState<"quick" | "standard" | "full">("quick");
  const [quickResult, setQuickResult] = useState<QuickScanResponse | null>(null);
  const [standardResult, setStandardResult] = useState<StandardResponse | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [trackRecord, setTrackRecord] = useState<TickerTrackRecord | null>(null);
  const [insider, setInsider] = useState<InsiderAggregates | null>(null);
  const [news, setNews] = useState<NewsResponse | null>(null);
  const [wallStreet, setWallStreet] = useState<WallStreetConsensus | null>(null);

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

  // Auto-run when arriving via ?ticker=... (alert-feed deep links, drill
  // panel "Run full research" buttons). Waits until the disclaimer check
  // has resolved so we don't race the modal.
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoRanRef.current) return;
    if (!initialTicker) return;
    if (!disclaimerChecked) return;
    if (disclaimerOpen) return; // let them accept first; they'll re-submit manually
    autoRanRef.current = true;
    void runAnalysis(initialTicker, false);
    // runAnalysis is referentially stable in this module scope
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTicker, disclaimerChecked, disclaimerOpen]);

  // Pre-warm public-data fetches for the user's top 10 holdings on mount.
  // When they subsequently research one of those tickers, the data block
  // assembly is ~instant instead of ~3–6s of upstream HTTP.
  // Safe by construction: server-side endpoint is auth-gated, rate-limited,
  // and never calls any AI models.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const snap = await getHoldings().catch(() => null);
        if (cancelled) return;
        const topTickers = (snap?.holdings ?? [])
          .slice()
          .sort((a, b) => b.value - a.value)
          .slice(0, 10)
          .map((h) => h.ticker);
        if (topTickers.length === 0) return;
        fetch("/api/research/prewarm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: topTickers }),
        }).catch(() => {});
      } catch {
        /* silent — pre-warm is a best-effort perf optimization */
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const t = query.trim().toUpperCase();
    if (!t) return;
    // Always start with a Quick scan. The result includes a "Go deeper"
    // button that triggers Deep read (single best model + bull/bear debate)
    // when the user wants more rigor.
    setMode("quick");
    await runQuickScan(t);
  }

  async function runAnalysis(ticker: string, force: boolean) {
    if (!ticker) return;
    if (disclaimerChecked && disclaimerOpen) return;

    // Unified-B tier dispatch:
    //   quick    → /api/research/quick-scan   — Haiku, ~$0.004
    //   standard → /api/research/standard     — single top-tier model, ~$0.06
    //   full     → /api/research              — 3-model panel, ~$0.21
    if (mode === "quick") {
      return runQuickScan(ticker);
    }
    if (mode === "standard") {
      return runStandard(ticker);
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setQuickResult(null);
    setStandardResult(null);
    setTrackRecord(null);
    setInsider(null);
    setNews(null);
    setWallStreet(null);

    // Fire track-record + insider + news + Wall Street consensus fetches
    // in parallel with the research request. Cheap, return before the AI
    // pipeline does — we render strips as soon as each lands.
    fetch(`/api/track-record/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TickerTrackRecord | null) => {
        if (data && data.total > 0) setTrackRecord(data);
      })
      .catch(() => {});

    fetch(`/api/insider/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: InsiderAggregates | null) => {
        if (data && data.transactions > 0) setInsider(data);
      })
      .catch(() => {});

    fetch(`/api/news/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: NewsResponse | null) => {
        if (data && data.items && data.items.length > 0) setNews(data);
      })
      .catch(() => {});

    fetch(`/api/analyst-consensus/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WallStreetConsensus | null) => {
        if (data && data.numberOfAnalystOpinions) setWallStreet(data);
      })
      .catch(() => {});

    // Progressive streaming via NDJSON. Each event updates UI immediately,
    // so the snapshot lands in ~3–5s while the AI pipeline continues.
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({ ticker, force }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      // Partial accumulator for the verdict — stream may deliver snapshot,
      // analysts (3), and verdict events in order. We merge as they land.
      const partial: Partial<ResearchResponse> & {
        analyses?: ModelResult[];
      } = { analyses: [] };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // NDJSON: one JSON object per line. Keep the trailing partial
        // line in the buffer for the next chunk.
        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          if (!line) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }

          switch (evt.type) {
            case "snapshot": {
              partial.ticker = evt.ticker as string;
              partial.snapshot = evt.snapshot as StockSnapshot;
              // Show a skeleton result with just the snapshot so the
              // ticker / price / day-change header appears immediately.
              setResult({
                ...(partial as ResearchResponse),
                analyses: [],
                supervisor: {
                  finalRecommendation: "INSUFFICIENT_DATA",
                  confidence: "LOW",
                  consensus: "INSUFFICIENT",
                  summary: "",
                  agreedPoints: [],
                  disagreements: [],
                  redFlags: [],
                  dataAsOf: (evt.snapshot as StockSnapshot)?.asOf ?? "",
                },
              });
              break;
            }
            case "analyst": {
              const a = evt.analyst as ModelResult;
              partial.analyses = [...(partial.analyses ?? []), a];
              setResult((prev) => {
                if (!prev) return prev;
                return { ...prev, analyses: [...(partial.analyses ?? [])] };
              });
              break;
            }
            case "debate": {
              // Adversarial bull/bear debate completed — render the cards
              // immediately, before supervisor synthesis lands. Gives the
              // user something tangible to read while the verdict cooks.
              const d = evt.debate as DebateResult;
              partial.debate = d;
              setResult((prev) => {
                if (!prev) return prev;
                return { ...prev, debate: d };
              });
              break;
            }
            case "decision_engine": {
              const decisionEngine = evt.decisionEngine as DecisionEngineOutput;
              partial.decisionEngine = decisionEngine;
              setResult((prev) => {
                if (!prev) return prev;
                return { ...prev, decisionEngine };
              });
              break;
            }
            case "verdict": {
              setResult(evt as unknown as ResearchResponse);
              break;
            }
            case "error": {
              setError((evt.message as string) ?? "Research failed.");
              return;
            }
            case "done":
            case "sources":
            default:
              break;
          }
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to analyze. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function runQuickScan(ticker: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    setQuickResult(null);
    setStandardResult(null);
    setTrackRecord(null);
    try {
      const res = await fetch("/api/research/quick-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Quick scan failed.");
        return;
      }
      setQuickResult(data as QuickScanResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quick scan failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runStandard(ticker: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    setQuickResult(null);
    setStandardResult(null);
    setTrackRecord(null);
    try {
      const res = await fetch("/api/research/standard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, lens: "claude" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Standard research failed.");
        return;
      }
      setStandardResult(data as StandardResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Standard research failed.");
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

      {/* Outcome-ping: surfaces any recently-evaluated past recommendation
          (7/30/90/365d windows). Transparency nudge — not a notification. */}
      <OutcomePing />

      <div>
        <div className="flex items-baseline gap-2">
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
            Research
          </h2>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
            · Informational only
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Three independent investment lenses — Quality, Momentum, Context —
          apply their discipline to the same verified data. Disagreement
          between them is surfaced, not hidden. Every claim traceable to its
          source.
        </p>
      </div>

      {/* Slim search bar — sits up top so it's always one keystroke away
          without dominating the page. The full Card-style search lower
          down was the old pattern; this replaces it. */}
      <form
        onSubmit={handleSearch}
        className="flex items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-2"
      >
        <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <Input
          placeholder="Research a ticker — AAPL, NVDA, TSLA…"
          className="h-8 flex-1 border-0 bg-transparent px-0 font-mono text-sm uppercase shadow-none focus-visible:ring-0"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
        <Button
          type="submit"
          size="sm"
          disabled={loading || !query.trim()}
          className="h-8"
        >
          {loading ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Analyzing
            </>
          ) : (
            "Analyze"
          )}
        </Button>
      </form>

      {/* Dossier-of-the-day hero: zero-AI editorial brief on the
          user's most-notable holding (or a trending fallback). Acts
          as the page's focal point above the horizontal strips so
          the landing feels like a considered publication, not a grid.
          Hides once the user is actively looking at a result. */}
      {!result && !quickResult && !standardResult && !loading && (
        <DossierHero
          onOpenResearch={(ticker) => {
            const t = ticker.trim().toUpperCase();
            setQuery(t);
            runAnalysis(t, false);
          }}
        />
      )}

      {/* Look closer at your holdings — Phase 8 replacement for the
          older YourBookToday top-gainer/top-loser strip. Surfaces up
          to 8 holdings tagged with a primary "why" (earnings T-X,
          stale research, concentration, top-mover fallback). Each
          card links into the research view for that ticker.

          Note: MarketPulse was removed from this surface in Phase 8 — the
          dashboard's MarketConditionsSidebar already covers the same
          ground (regime label / VIX / FOMC) and surfacing it twice was
          duplicative. The component file remains on disk for possible
          reuse but is no longer rendered from the research view. */}
      <LookCloserAtHoldings />

      {/* Two-col strip: events this week + worth-reading. Together they
          give the user something to click on (events = what's coming,
          worth reading = what to think about) instead of just a search
          box. On narrow screens they stack. */}
      <div className="grid gap-4 md:grid-cols-2">
        <EventsThisWeek />
        <WorthReading />
      </div>

      {/* Sector explore rail — browse without needing a ticker. ETFs
          are real research targets so clicking a sector tile loads
          a real analysis. Landing-only; hides when a result is active. */}
      {!result && !quickResult && !standardResult && !loading && (
        <SectorRail
          onOpenResearch={(ticker) => {
            const t = ticker.trim().toUpperCase();
            setQuery(t);
            runAnalysis(t, false);
          }}
        />
      )}

      {/* Recent searches — only on landing (no active result / loading). */}
      {!result && !quickResult && !standardResult && !loading && (
        <RecentSearchesStrip />
      )}

      {/* Loading-state hint — the slim search bar at the top can't fit
          per-mode loading copy, so surface it inline here while a run
          is in flight. */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {result?.cached
            ? "Loading cached analysis…"
            : mode === "quick"
              ? "Reading the signals…"
              : "Going deeper — full thesis with adversarial debate…"}
        </div>
      )}

      {error && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div className="text-sm text-red-300/90">{error}</div>
          </CardContent>
        </Card>
      )}

      {/* Quick Read — denser layout:
          • Header: TICKER + "Quick read · Updated NN:NNa" inline +
            top-right verdict badge
          • Sub-header strip: 30-day sparkline + price + day change.
            Visual context the previous text-only version lacked.
          • Body: thesis paragraph spans full width, then two-column
            "Key signals" / "Primary risk" so vertical scroll stays tight.
          • Footer: just the "Go deeper" CTA — no tech disclosures. */}
      {quickResult && !loading && (
        <>
          <PastCallsStrip ticker={quickResult.ticker} />
          <Card>
          <CardHeader className="pb-3 border-b border-[var(--border)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <CardTitle className="text-2xl font-semibold tracking-tight">
                    {quickResult.ticker}
                  </CardTitle>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted-foreground)]">
                    Quick read
                  </span>
                  <FreshnessChip
                    cached={quickResult.cached}
                    cachedAgeSec={quickResult.cachedAgeSec ?? null}
                  />
                </div>
                {quickResult.snapshot.name &&
                  quickResult.snapshot.name !== quickResult.ticker && (
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {quickResult.snapshot.name}
                    </p>
                  )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {quickResult.priceHistory &&
                  quickResult.priceHistory.length >= 2 && (
                    <MiniSparkline
                      data={quickResult.priceHistory}
                      width={120}
                      height={32}
                    />
                  )}
                <div className="text-right">
                  <div className="font-mono tabular-nums text-base font-medium text-[var(--foreground)]">
                    ${quickResult.snapshot.price?.toFixed(2) ?? "—"}
                  </div>
                  {typeof quickResult.snapshot.changePct === "number" && (
                    <div
                      className={`font-mono tabular-nums text-[11px] ${
                        quickResult.snapshot.changePct > 0
                          ? "text-[var(--buy)]"
                          : quickResult.snapshot.changePct < 0
                            ? "text-[var(--sell)]"
                            : "text-[var(--muted-foreground)]"
                      }`}
                    >
                      {quickResult.snapshot.changePct > 0 ? "+" : ""}
                      {quickResult.snapshot.changePct.toFixed(2)}%
                    </div>
                  )}
                </div>
                <Badge
                  className={`${
                    quickResult.output.recommendation === "BUY"
                      ? "bg-[var(--buy)]/15 text-[var(--buy)] border-[var(--buy)]/30"
                      : quickResult.output.recommendation === "SELL"
                        ? "bg-[var(--sell)]/15 text-[var(--sell)] border-[var(--sell)]/30"
                        : "bg-[var(--hold)]/15 text-[var(--hold)] border-[var(--hold)]/30"
                  } font-mono tracking-wider shrink-0`}
                >
                  {quickResult.output.recommendation} ·{" "}
                  {quickResult.output.confidence}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <p className="text-base leading-snug text-[var(--foreground)]">
              {quickResult.output.oneLiner}
            </p>

            <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
              {quickResult.output.signals.length > 0 && (
                <div>
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                    Key signals
                  </div>
                  <ul className="space-y-1.5">
                    {quickResult.output.signals.map((s, i) => (
                      <li
                        key={i}
                        className="flex gap-2 text-sm leading-relaxed"
                      >
                        <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--foreground)]/40" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {quickResult.output.primaryRisk && (
                <div>
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sell)]/80">
                    Primary risk
                  </div>
                  <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                    {quickResult.output.primaryRisk}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-[var(--border)] pt-3">
              <Button
                size="sm"
                onClick={() => {
                  setMode("standard");
                  void runStandard(quickResult.ticker);
                }}
                disabled={loading}
              >
                Go deeper — full thesis with debate
              </Button>
            </div>
          </CardContent>
        </Card>
        </>
      )}

      {/* Standard result — single-lens full thesis. Reuses the analyst-card
          shape from the panel view; one card instead of three. */}
      {standardResult && !loading && (
        <>
          <PastCallsStrip ticker={standardResult.ticker} />
          <Card>
          {/* Same header treatment as Quick Read: title row with inline
              freshness chip, sparkline + price + verdict badge floating
              right. */}
          <CardHeader className="pb-3 border-b border-[var(--border)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <CardTitle className="font-sans text-2xl font-semibold tracking-tight">
                    {standardResult.ticker}
                  </CardTitle>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted-foreground)]">
                    Deep read
                  </span>
                  <FreshnessChip
                    cached={standardResult.cached}
                    cachedAgeSec={standardResult.cachedAgeSec ?? null}
                  />
                </div>
                {standardResult.snapshot.name &&
                  standardResult.snapshot.name !== standardResult.ticker && (
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {standardResult.snapshot.name}
                    </p>
                  )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {standardResult.priceHistory &&
                  standardResult.priceHistory.length >= 2 && (
                    <MiniSparkline
                      data={standardResult.priceHistory}
                      width={120}
                      height={32}
                    />
                  )}
                <div className="text-right">
                  <div className="font-mono tabular-nums text-base font-medium text-[var(--foreground)]">
                    ${standardResult.snapshot.price?.toFixed(2) ?? "—"}
                  </div>
                  {typeof standardResult.snapshot.changePct === "number" && (
                    <div
                      className={`font-mono tabular-nums text-[11px] ${
                        standardResult.snapshot.changePct > 0
                          ? "text-[var(--buy)]"
                          : standardResult.snapshot.changePct < 0
                            ? "text-[var(--sell)]"
                            : "text-[var(--muted-foreground)]"
                      }`}
                    >
                      {standardResult.snapshot.changePct > 0 ? "+" : ""}
                      {standardResult.snapshot.changePct.toFixed(2)}%
                    </div>
                  )}
                </div>
                {standardResult.analysis.status === "ok" &&
                  standardResult.analysis.output && (
                    <Badge
                      className={`${
                        standardResult.analysis.output.recommendation === "BUY"
                          ? "bg-[var(--buy)]/15 text-[var(--buy)] border-[var(--buy)]/30"
                          : standardResult.analysis.output.recommendation ===
                              "SELL"
                            ? "bg-[var(--sell)]/15 text-[var(--sell)] border-[var(--sell)]/30"
                            : "bg-[var(--hold)]/15 text-[var(--hold)] border-[var(--hold)]/30"
                      } font-mono tracking-wider shrink-0`}
                    >
                      {standardResult.analysis.output.recommendation} ·{" "}
                      {standardResult.analysis.output.confidence}
                    </Badge>
                  )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {standardResult.analysis.status !== "ok" ||
            !standardResult.analysis.output ? (
              <p className="text-sm text-muted-foreground">
                {standardResult.analysis.error ??
                  "Standard analysis returned no output."}
              </p>
            ) : (
              <>
                <p className="text-base leading-snug">
                  {standardResult.analysis.output.thesis}
                </p>

                {standardResult.analysis.output.keySignals.length > 0 && (
                  <div>
                    <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                      Key signals
                    </div>
                    <ul className="space-y-2">
                      {standardResult.analysis.output.keySignals.map((s, i) => (
                        <li key={i} className="text-sm">
                          <div>{s.signal}</div>
                          <div className="font-mono text-[10px] text-[var(--muted-foreground)]">
                            {s.datum}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {standardResult.analysis.output.riskFactors.length > 0 && (
                  <div>
                    <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--sell)]/80">
                      Risk factors
                    </div>
                    <ul className="space-y-1">
                      {standardResult.analysis.output.riskFactors.map(
                        (r, i) => (
                          <li
                            key={i}
                            className="flex gap-2 text-sm leading-relaxed"
                          >
                            <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--sell)]/60" />
                            <span>{r}</span>
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                )}

                {/* Verdict reconciliation: when Quick said one thing and
                    Deep says another, explain WHY in plain language.
                    The deep read's bull/bear pass tests the thesis from
                    both sides — that's the more reliable signal. */}
                {quickResult &&
                  quickResult.ticker === standardResult.ticker &&
                  standardResult.analysis.output.recommendation !==
                    quickResult.output.recommendation && (
                    <div className="rounded-md border border-[var(--decisive)]/30 bg-[var(--decisive)]/5 px-3 py-2.5 text-xs leading-relaxed">
                      <div className="mb-1 font-mono uppercase tracking-wider text-[var(--decisive)]">
                        Reads disagree
                      </div>
                      <p className="text-[var(--foreground)]/85">
                        The quick read suggested{" "}
                        <span className="font-mono">
                          {quickResult.output.recommendation}
                        </span>
                        ; the deeper read says{" "}
                        <span className="font-mono">
                          {standardResult.analysis.output.recommendation}
                        </span>
                        . The deeper read is the one to trust — it
                        challenges its own thesis with a bull and bear
                        argument before settling. The quick read is a
                        first-glance triage.
                      </p>
                    </div>
                  )}
              </>
            )}
          </CardContent>
        </Card>
        </>
      )}

      {/* Adversarial debate cards on the Deep read result. The bull/bear
          pass + the "what would change my mind" line is the differentiator
          no other consumer research tool surfaces. */}
      {standardResult?.debate &&
        (standardResult.debate.bull || standardResult.debate.bear) && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              <span>Adversarial debate · the case for and against</span>
            </h3>
            <div className="grid gap-4 lg:grid-cols-2">
              {standardResult.debate.bull && (
                <Card className="border-[var(--buy)]/30 bg-[var(--buy)]/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-baseline justify-between text-sm">
                      <span className="text-[var(--buy)] font-mono uppercase tracking-widest">
                        Bull case
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        arguing for action
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className="leading-relaxed">
                      {standardResult.debate.bull.thesis}
                    </p>
                    <ul className="space-y-2">
                      {standardResult.debate.bull.reasons.map((r, i) => (
                        <li key={i}>
                          <div>{r.point}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
                            cite: {r.citation}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="rounded-md border border-[var(--buy)]/20 bg-[var(--background)] p-2.5 text-xs">
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        What would change the bull&rsquo;s mind
                      </div>
                      <div className="leading-relaxed">
                        {standardResult.debate.bull.conditionThatWouldChangeMind}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              {standardResult.debate.bear && (
                <Card className="border-[var(--sell)]/30 bg-[var(--sell)]/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-baseline justify-between text-sm">
                      <span className="text-[var(--sell)] font-mono uppercase tracking-widest">
                        Bear case
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        arguing against action
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className="leading-relaxed">
                      {standardResult.debate.bear.thesis}
                    </p>
                    <ul className="space-y-2">
                      {standardResult.debate.bear.reasons.map((r, i) => (
                        <li key={i}>
                          <div>{r.point}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
                            cite: {r.citation}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="rounded-md border border-[var(--sell)]/20 bg-[var(--background)] p-2.5 text-xs">
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        What would change the bear&rsquo;s mind
                      </div>
                      <div className="leading-relaxed">
                        {standardResult.debate.bear.conditionThatWouldChangeMind}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

      {/* Editorial empty-state: rich context so the page is never blank.
          Holdings chips · earnings this week · recent filings · recent queries
          · trending. Chip click kicks runAnalysis directly. */}
      {!loading && !result && !quickResult && !standardResult && (
        <ResearchStarter
          onPick={(ticker) => {
            const t = ticker.trim().toUpperCase();
            setQuery(t);
            runAnalysis(t, false);
          }}
        />
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

      {insider && insider.transactions > 0 && (
        <Card className="border-border/60 bg-muted/30">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-xs">
            <div className="font-mono uppercase tracking-[0.15em] text-muted-foreground">
              Insider activity (last {insider.windowDays}d)
            </div>
            <div className="flex items-center gap-3">
              {insider.buys > 0 && (
                <span className="text-[var(--buy)]">
                  {insider.buys} open-market buy{insider.buys === 1 ? "" : "s"}
                  {insider.officerBuys > 0 && (
                    <span className="ml-1 text-muted-foreground">
                      ({insider.officerBuys} officer-level)
                    </span>
                  )}
                </span>
              )}
              {insider.sells > 0 && (
                <span className="text-[var(--sell)]">
                  {insider.sells} sell{insider.sells === 1 ? "" : "s"}
                  {insider.officerSells > 0 && (
                    <span className="ml-1 text-muted-foreground">
                      ({insider.officerSells} officer-level)
                    </span>
                  )}
                </span>
              )}
              {insider.buys === 0 && insider.sells === 0 && (
                <span className="text-muted-foreground">
                  {insider.transactions} non-market transaction
                  {insider.transactions === 1 ? "" : "s"} only (awards, option
                  exercises, etc.)
                </span>
              )}
            </div>
            {insider.netDollarValue !== 0 && (
              <div className="border-l border-border/60 pl-6 text-muted-foreground">
                Net:{" "}
                <span
                  className={
                    insider.netDollarValue > 0
                      ? "font-mono text-[var(--buy)]"
                      : "font-mono text-[var(--sell)]"
                  }
                >
                  {insider.netDollarValue > 0 ? "+" : "-"}$
                  {Math.abs(insider.netDollarValue).toLocaleString("en-US")}
                </span>
              </div>
            )}
            {insider.lastActivityAt && (
              <div className="ml-auto font-mono text-[10px] text-muted-foreground/70">
                Latest filing {insider.lastActivityAt}
              </div>
            )}
          </CardContent>
          {insider.recent && insider.recent.length > 0 && (
            <CardContent className="border-t border-border/60 pt-3 pb-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                Recent Form 4 transactions
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="py-1.5 pr-3 font-medium">Date</th>
                      <th className="py-1.5 pr-3 font-medium">Filer</th>
                      <th className="py-1.5 pr-3 font-medium">Code</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Shares</th>
                      <th className="py-1.5 pr-3 text-right font-medium">@ Price</th>
                      <th className="py-1.5 text-right font-medium">~Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insider.recent.slice(0, 6).map((t, i) => {
                      const code = t.transactionCode ?? "—";
                      const isBuy = code === "P";
                      const isSell = code === "S";
                      const codeColor = isBuy
                        ? "text-[var(--buy)]"
                        : isSell
                          ? "text-[var(--sell)]"
                          : "text-muted-foreground";
                      const role = t.isOfficer
                        ? "Officer"
                        : t.isDirector
                          ? "Director"
                          : t.isTenPercentOwner
                            ? "10% Owner"
                            : null;
                      return (
                        <tr
                          key={`${t.accession}-${i}`}
                          className="border-b border-border/40 last:border-0"
                        >
                          <td className="py-1.5 pr-3 font-mono tabular-nums text-muted-foreground">
                            {t.transactionDate ?? t.filedOn.slice(0, 10)}
                          </td>
                          <td className="py-1.5 pr-3">
                            <span className="font-medium">
                              {t.filerName ?? "Unknown"}
                            </span>
                            {(t.filerTitle || role) && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                ({t.filerTitle ?? role})
                              </span>
                            )}
                          </td>
                          <td
                            className={`py-1.5 pr-3 font-mono font-medium ${codeColor}`}
                          >
                            {code}
                            {isBuy && " buy"}
                            {isSell && " sell"}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {t.shares != null
                              ? t.shares.toLocaleString("en-US")
                              : "—"}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                            {t.pricePerShare != null
                              ? `$${t.pricePerShare.toFixed(2)}`
                              : "—"}
                          </td>
                          <td className="py-1.5 text-right font-mono tabular-nums">
                            {t.approxDollarValue != null
                              ? `$${Math.round(
                                  t.approxDollarValue
                                ).toLocaleString("en-US")}`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
          <CardContent className="border-t border-border/60 pt-2 pb-3 text-[10px] text-muted-foreground">
            Source: SEC Form 4 filings. P = open-market purchase, S = open-market
            sale, M = option exercise/conversion, A = grant, F = payment-of-tax
            in-kind. Open-market buys (P) are typically higher-signal than sells
            (which may reflect diversification or tax planning).
          </CardContent>
        </Card>
      )}

      {wallStreet && wallStreet.numberOfAnalystOpinions ? (
        (() => {
          const price = result?.snapshot?.price ?? null;
          const target = wallStreet.targetMean ?? wallStreet.targetMedian;
          const upside =
            price && target && price > 0 ? ((target - price) / price) * 100 : null;
          const recKey = wallStreet.recommendationKey ?? "";
          const recColorClass =
            recKey.includes("buy") || recKey === "strong_buy"
              ? "text-[var(--buy)]"
              : recKey === "sell" || recKey === "underperform"
              ? "text-[var(--sell)]"
              : recKey === "hold"
              ? "text-[var(--hold)]"
              : "text-foreground";
          return (
            <Card className="border-border/60 bg-muted/30">
              <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-xs">
                <div className="font-mono uppercase tracking-[0.15em] text-muted-foreground">
                  Wall Street consensus
                </div>
                <div className="flex items-center gap-3">
                  <span>
                    <span className="font-medium">
                      {wallStreet.numberOfAnalystOpinions}
                    </span>{" "}
                    analysts covering
                  </span>
                  {recKey && (
                    <span className={`font-medium uppercase ${recColorClass}`}>
                      {recKey.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
                {target != null && (
                  <div className="flex items-center gap-3 border-l border-border/60 pl-6">
                    <span className="text-muted-foreground">Target:</span>
                    <span className="font-mono font-medium">
                      ${target.toFixed(2)}
                    </span>
                    {upside != null && (
                      <span
                        className={
                          upside > 0
                            ? "text-[var(--buy)]"
                            : upside < 0
                            ? "text-[var(--sell)]"
                            : "text-muted-foreground"
                        }
                      >
                        ({upside >= 0 ? "+" : ""}
                        {upside.toFixed(1)}% vs current)
                      </span>
                    )}
                  </div>
                )}
                {wallStreet.targetLow != null &&
                  wallStreet.targetHigh != null && (
                    <div className="text-muted-foreground">
                      Range: $
                      {wallStreet.targetLow.toFixed(2)} – $
                      {wallStreet.targetHigh.toFixed(2)}
                    </div>
                  )}
              </CardContent>
              <CardContent className="border-t border-border/60 pt-2 pb-3 text-[10px] text-muted-foreground">
                Third-party analyst consensus (Yahoo Finance). Shown for
                cross-reference against ClearPath&rsquo;s verdict —{" "}
                <span className="text-foreground">not</span> the same as the
                ClearPath recommendation above. Disagreement between Wall
                Street and ClearPath is diagnostic, not dispositive.
              </CardContent>
            </Card>
          );
        })()
      ) : null}

      {news && news.items.length > 0 && (
        <Card className="border-border/60 bg-muted/30">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <CardTitle className="text-sm">Recent headlines</CardTitle>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>Source: {news.source === "finnhub" ? "Finnhub" : "Yahoo Finance"}</span>
                {news.sentiment && (
                  <>
                    <span className="text-[var(--buy)]">
                      {(news.sentiment.bullishPercent * 100).toFixed(0)}% bullish
                    </span>
                    <span className="text-[var(--sell)]">
                      {(news.sentiment.bearishPercent * 100).toFixed(0)}% bearish
                    </span>
                  </>
                )}
                {news.buzz && news.buzz.weeklyAverage > 0 && (
                  <span>
                    buzz ×{news.buzz.buzz.toFixed(2)} vs avg
                  </span>
                )}
                {news.companyNewsScore != null && (
                  <span
                    className={
                      news.companyNewsScore > 0.55
                        ? "text-[var(--buy)]"
                        : news.companyNewsScore < 0.45
                        ? "text-[var(--sell)]"
                        : ""
                    }
                    title="Finnhub company news score (0–1)"
                  >
                    score {news.companyNewsScore.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y divide-border/60 text-sm">
              {news.items.slice(0, 6).map((n, i) => {
                const ts = n.datetime ? new Date(n.datetime) : null;
                const when = ts ? ts.toLocaleDateString() : "";
                const pub = n.source ?? n.publisher ?? "";
                return (
                  <li key={i} className="py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      {n.url ? (
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 truncate hover:underline"
                          title={n.headline}
                        >
                          {n.headline}
                        </a>
                      ) : (
                        <span className="flex-1 truncate" title={n.headline}>
                          {n.headline}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {pub}{pub && when ? " · " : ""}{when}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[10px] text-muted-foreground">
              News is qualitative context only. Sentiment scores are not
              financial advice and are not used as primary signals by the
              analyst panel.
            </p>
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
              {result.cached && result.cachedAgeSec != null && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--hold)]/30 bg-[var(--hold)]/5 px-3 py-2 text-xs">
                  <Info className="h-3 w-3 flex-shrink-0 text-[var(--hold)]" />
                  <span>
                    Showing result from{" "}
                    <span className="font-medium">
                      {cachedAgeLabel(result.cachedAgeSec)}
                    </span>
                    . Prices and macro data may have moved.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto text-xs"
                    disabled={loading}
                    onClick={() => runAnalysis(result.ticker, true)}
                  >
                    {loading ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : null}
                    Re-run fresh
                  </Button>
                </div>
              )}
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
                            <span className="font-mono text-[var(--decisive)]">Value:</span>{" "}
                            {d.claudeView}
                          </div>
                          <div>
                            <span className="font-mono text-[var(--buy)]">Growth:</span>{" "}
                            {d.gptView}
                          </div>
                          <div>
                            <span className="font-mono text-[var(--hold)]">Macro:</span>{" "}
                            {d.geminiView}
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

          {result.decisionEngine && (
            <DecisionEngineCard
              decisionEngine={result.decisionEngine}
              aiRecommendation={result.supervisor.finalRecommendation}
            />
          )}

          {/* Adversarial debate — bull/bear cards. Renders only when the
              debate ran (Full Panel mode). The "what would change my mind"
              line is the differentiating trust signal — gives the user a
              forward-looking trigger to watch instead of a static verdict. */}
          {result.debate && (result.debate.bull || result.debate.bear) && (
            <div>
              <h3 className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                <span>Adversarial debate · the case for and against</span>
              </h3>
              <div className="grid gap-4 lg:grid-cols-2">
                {result.debate.bull && (
                  <Card className="border-[var(--buy)]/30 bg-[var(--buy)]/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-baseline justify-between text-sm">
                        <span className="text-[var(--buy)] font-mono uppercase tracking-widest">
                          Bull case
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          arguing for action
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <p className="leading-relaxed">
                        {result.debate.bull.thesis}
                      </p>
                      <ul className="space-y-2">
                        {result.debate.bull.reasons.map((r, i) => (
                          <li key={i}>
                            <div>{r.point}</div>
                            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
                              cite: {r.citation}
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="rounded-md border border-[var(--buy)]/20 bg-[var(--background)] p-2.5 text-xs">
                        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          What would change the bull&rsquo;s mind
                        </div>
                        <div className="leading-relaxed">
                          {result.debate.bull.conditionThatWouldChangeMind}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {result.debate.bear && (
                  <Card className="border-[var(--sell)]/30 bg-[var(--sell)]/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-baseline justify-between text-sm">
                        <span className="text-[var(--sell)] font-mono uppercase tracking-widest">
                          Bear case
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          arguing against action
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <p className="leading-relaxed">
                        {result.debate.bear.thesis}
                      </p>
                      <ul className="space-y-2">
                        {result.debate.bear.reasons.map((r, i) => (
                          <li key={i}>
                            <div>{r.point}</div>
                            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
                              cite: {r.citation}
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="rounded-md border border-[var(--sell)]/20 bg-[var(--background)] p-2.5 text-xs">
                        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          What would change the bear&rsquo;s mind
                        </div>
                        <div className="leading-relaxed">
                          {result.debate.bear.conditionThatWouldChangeMind}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* Per-model panel */}
          <div>
            <h3 className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              <span>Individual Analyses · Quality / Momentum / Context lenses</span>
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
