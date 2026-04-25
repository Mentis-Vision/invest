"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Activity,
  Sparkles,
} from "lucide-react";
import type {
  TickerDossier,
  DossierTone,
  SignalTone,
} from "@/lib/warehouse/dossier";

/**
 * Dossier-of-the-day hero.
 *
 * Renders at the top of the Research view so the landing has a clear
 * focal point before the user searches anything. The content is a
 * zero-AI dossier — `buildDossier()` reading warehouse rows — so this
 * card is free to load on every page visit.
 *
 * Fetches from `/api/research/dossier-of-day`. The endpoint picks the
 * most notable ticker in the user's holdings (or a trending fallback
 * for users with no brokerage linked yet). Clicking "Open full
 * research" hands the ticker off to the parent, which routes to the
 * main research flow.
 *
 * Null-renders when the endpoint returns no dossier (e.g. warehouse
 * still priming for a brand-new user) — the page degrades to the
 * existing strips rather than showing a sad empty card.
 */
export function DossierHero({
  onOpenResearch,
}: {
  onOpenResearch: (ticker: string) => void;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | {
        kind: "ready";
        dossier: TickerDossier;
        source: "holding" | "trending";
      }
    | { kind: "none" }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetch("/api/research/dossier-of-day")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        if (!d?.dossier) {
          setState({ kind: "none" });
          return;
        }
        setState({
          kind: "ready",
          dossier: d.dossier,
          source: d.source ?? "holding",
        });
      })
      .catch(() => {
        if (alive) setState({ kind: "none" });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="h-44 animate-pulse rounded-lg border border-border bg-card" />
    );
  }
  if (state.kind === "none") return null;

  const { dossier, source } = state;
  const toneRing = toneToRing(dossier.tone);
  const toneAccent = toneToAccent(dossier.tone);
  const topSignals = dossier.signals.slice(0, 3);

  return (
    <div
      className={`relative overflow-hidden rounded-lg border bg-card p-5 ${toneRing}`}
    >
      {/* Eyebrow row */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Spotlight
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">
            {source === "holding"
              ? "Your most-notable holding today — read this first."
              : "A trending ticker worth a look today."}
          </div>
        </div>
        <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${toneAccent}`}>
          {toneLabel(dossier.tone)}
        </span>
      </div>

      {/* Headline + ticker */}
      <div className="mt-3 flex items-baseline gap-3">
        <span className="font-mono text-[22px] font-semibold tracking-tight">
          {dossier.ticker}
        </span>
        <h2 className="min-w-0 flex-1 text-[16px] font-semibold leading-tight text-foreground/90">
          {dossier.headline}
        </h2>
      </div>

      {/* Signal list */}
      {topSignals.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {topSignals.map((signal, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-[13px] leading-relaxed"
            >
              <SignalIcon tone={signal.tone} />
              <span className="text-foreground/80">{signal.text}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Narrative (short) */}
      {dossier.narrative && (
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          {dossier.narrative}
        </p>
      )}

      {/* CTA row */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-[11px] text-muted-foreground">
          {source === "holding"
            ? "From your linked holdings · informational only."
            : "Trending today · informational only, not investment advice."}
        </div>
        <button
          type="button"
          onClick={() => onOpenResearch(dossier.ticker)}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background transition-colors hover:bg-foreground/85"
        >
          Open full research
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Tone mapping ─────────────────────────────────────────────────────

function toneToRing(tone: DossierTone): string {
  switch (tone) {
    case "concern":
      return "border-[var(--sell)]/40";
    case "inspect":
      return "border-[var(--hold)]/40";
    case "watch":
      return "border-primary/40";
    case "steady":
    default:
      return "border-border";
  }
}

function toneToAccent(tone: DossierTone): string {
  switch (tone) {
    case "concern":
      return "bg-[var(--sell)]/10 text-[var(--sell)]";
    case "inspect":
      return "bg-[var(--hold)]/10 text-[var(--hold)]";
    case "watch":
      return "bg-primary/10 text-primary";
    case "steady":
    default:
      return "bg-secondary text-muted-foreground";
  }
}

function toneLabel(tone: DossierTone): string {
  switch (tone) {
    case "concern":
      return "Concern";
    case "inspect":
      return "Inspect";
    case "watch":
      return "Watch";
    case "steady":
    default:
      return "Steady";
  }
}

function SignalIcon({ tone }: { tone: SignalTone }) {
  const className = "mt-0.5 h-3.5 w-3.5 flex-shrink-0";
  switch (tone) {
    case "up":
      return <TrendingUp className={`${className} text-[var(--buy)]`} />;
    case "down":
      return <TrendingDown className={`${className} text-[var(--sell)]`} />;
    case "watch":
      return (
        <AlertCircle className={`${className} text-[var(--hold)]`} />
      );
    case "neutral":
    default:
      return (
        <Activity className={`${className} text-muted-foreground`} />
      );
  }
}
