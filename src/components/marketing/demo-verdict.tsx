"use client";

import { useState } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";

/**
 * Interactive demo verdict — landing-page centerpiece.
 *
 * Replaces the static NVDA mock with a 4-ticker selector that swaps
 * the verdict card on click. Sample data is curated and hardcoded
 * (no real backend hit) so the demo is instant and deterministic.
 * The TSLA case deliberately shows lens *disagreement* (Quality SELL
 * vs Momentum BUY vs Context HOLD) so visitors see what the
 * three-lens differentiator actually buys them — that's the moment
 * of "oh, this is different."
 *
 * Numbers chosen to be plausible at the time of writing; if they go
 * stale, swap to fresher figures or wire this up to a cached backend
 * snapshot. The text label "Illustrative example" already disclaims
 * the data is illustrative.
 */

type Lens = "quality" | "momentum" | "context";
type Verdict = "BUY" | "HOLD" | "SELL";
type Confidence = "HIGH" | "MEDIUM" | "LOW";

type Brief = {
  ticker: string;
  name: string;
  price: string;
  delta: string;
  deltaUp: boolean;
  verdict: Verdict;
  confidence: Confidence;
  consensus: "Unanimous" | "Split" | "Majority";
  sourceCount: number;
  thesis: string;
  lenses: Record<Lens, Verdict>;
};

const BRIEFS: Brief[] = [
  {
    ticker: "NVDA",
    name: "NVIDIA Corp",
    price: "$486.92",
    delta: "+1.2%",
    deltaUp: true,
    verdict: "HOLD",
    confidence: "HIGH",
    consensus: "Unanimous",
    sourceCount: 12,
    thesis:
      "Valuation elevated (forward P/E 38.2 vs sector 24.1) offsets strong revenue growth (122% YoY per latest 10-Q). With Fed funds at 5.33% and the 10Y at 4.38%, risk-asset multiples face compression. Wait for entry below $420 or for next earnings print.",
    lenses: { quality: "HOLD", momentum: "HOLD", context: "HOLD" },
  },
  {
    ticker: "TSLA",
    name: "Tesla Inc",
    price: "$248.41",
    delta: "−2.4%",
    deltaUp: false,
    verdict: "HOLD",
    confidence: "MEDIUM",
    consensus: "Split",
    sourceCount: 14,
    thesis:
      "Lenses disagree. Quality flags margin compression — auto gross margin down to 17.6% in latest 10-Q vs 25%+ historical. Momentum sees the bounce off $230 support. Context warns China demand is the swing variable and PMI prints have softened. The disagreement itself is the signal: evidence is genuinely ambiguous, HOLD is the honest call.",
    lenses: { quality: "SELL", momentum: "BUY", context: "HOLD" },
  },
  {
    ticker: "AAPL",
    name: "Apple Inc",
    price: "$192.53",
    delta: "+0.4%",
    deltaUp: true,
    verdict: "BUY",
    confidence: "HIGH",
    consensus: "Unanimous",
    sourceCount: 13,
    thesis:
      "Services revenue at 24% YoY growth (10-Q) lifts forward margins materially. Cash position $166B per latest filing supports continued buybacks (~$110B authorized). Forward P/E of 28.4 is a premium to S&P (22.1) but justified by services mix shift. Below $200 with a 0.5% buyback yield is an entry.",
    lenses: { quality: "BUY", momentum: "BUY", context: "BUY" },
  },
  {
    ticker: "NFLX",
    name: "Netflix Inc",
    price: "$612.20",
    delta: "−0.8%",
    deltaUp: false,
    verdict: "SELL",
    confidence: "MEDIUM",
    consensus: "Majority",
    sourceCount: 11,
    thesis:
      "Subscriber growth slowing to 9.4% YoY (down from 16% prior). Forward P/E 36.5 implies multi-year double-digit operating-margin expansion to justify. Streaming consolidation (Disney+, Max) compresses content advantage. Quality + Context lean SELL; Momentum is technically constructive but doesn't outweigh fundamentals.",
    lenses: { quality: "SELL", momentum: "HOLD", context: "SELL" },
  },
];

const verdictColor: Record<Verdict, string> = {
  BUY: "var(--buy)",
  HOLD: "var(--hold)",
  SELL: "var(--sell)",
};

export default function DemoVerdict() {
  const [selectedTicker, setSelectedTicker] = useState<string>("NVDA");
  const brief = BRIEFS.find((b) => b.ticker === selectedTicker) ?? BRIEFS[0];

  return (
    <div className="relative mx-auto max-w-3xl px-6 pb-16">
      {/* Ticker selector — buttons styled like the old terminal-tag
          aesthetic of the rest of the site. The selected pill gets
          the buy-color border so it reads as the "live" choice. */}
      <div className="mb-4 flex items-center justify-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Try it:
        </span>
        {BRIEFS.map((b) => {
          const active = b.ticker === selectedTicker;
          return (
            <button
              key={b.ticker}
              type="button"
              onClick={() => setSelectedTicker(b.ticker)}
              aria-pressed={active}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider transition-colors ${
                active
                  ? "border-[var(--buy)]/40 bg-[var(--buy)]/5 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-foreground/25 hover:text-foreground"
              }`}
            >
              {b.ticker}
            </button>
          );
        })}
      </div>

      {/* Verdict card — keyed on ticker so React remounts and the
          fade-in transition (CSS keyframe) plays each switch. */}
      <div
        key={brief.ticker}
        className="animate-verdict-fade rounded-xl border border-border bg-card shadow-[0_1px_0_0_rgba(0,0,0,0.03),0_24px_48px_-24px_rgba(26,26,30,0.15)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-y-1 border-b border-border/70 px-6 py-3">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>{brief.ticker}</span>
            <span className="text-foreground/20">·</span>
            <span>Sample brief</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--buy)]">
            <ShieldCheck className="h-3 w-3" />
            Cited · {brief.sourceCount} sources
          </div>
        </div>
        <div className="px-6 py-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {brief.name}
              </div>
              <div className="mt-0.5 font-mono text-sm text-foreground">
                {brief.price}{" "}
                <span
                  className={
                    brief.deltaUp ? "text-[var(--buy)]" : "text-[var(--sell)]"
                  }
                >
                  {brief.delta}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span
                className="rounded-md border px-3 py-1 text-sm font-semibold"
                style={{
                  borderColor: `color-mix(in oklch, ${verdictColor[brief.verdict]} 25%, transparent)`,
                  backgroundColor: `color-mix(in oklch, ${verdictColor[brief.verdict]} 10%, transparent)`,
                  color: verdictColor[brief.verdict],
                }}
              >
                {brief.verdict}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {brief.confidence} confidence · {brief.consensus}
              </span>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-foreground/85">
            {brief.thesis}
          </p>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-[11px] font-mono">
            {(Object.keys(brief.lenses) as Lens[]).map((lens) => {
              const v = brief.lenses[lens];
              return (
                <div key={lens} className="flex items-center gap-1.5">
                  <div
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: verdictColor[v] }}
                  />
                  <span className="text-muted-foreground">
                    {lens.charAt(0).toUpperCase() + lens.slice(1)}: {v}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Disagreement callout — only shown when the consensus
              is anything but Unanimous. This is the wedge moment:
              other tools hide this; ClearPath surfaces it. */}
          {brief.consensus !== "Unanimous" && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-[var(--hold)]/30 bg-[var(--hold)]/5 px-3 py-2 text-[12px] text-foreground/80">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--hold)]" />
              <span>
                <strong className="font-medium">Lenses disagree.</strong>{" "}
                We surface that on purpose — disagreement is information.
                Most tools smooth it into a confident consensus that
                isn&rsquo;t actually there.
              </span>
            </div>
          )}
          {/* Required disclaimer — travels with any screenshot of
              this card. */}
          <div className="mt-4 border-t border-border pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Illustrative example · Informational only · Not investment advice
          </div>
        </div>
      </div>

      {/* Inline keyframe — kept local to this component so it
          doesn't bleed into the global stylesheet. */}
      <style jsx>{`
        @keyframes verdictFade {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        :global(.animate-verdict-fade) {
          animation: verdictFade 320ms ease-out;
        }
      `}</style>
    </div>
  );
}
