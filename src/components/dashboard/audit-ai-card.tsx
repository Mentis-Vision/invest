// src/components/dashboard/audit-ai-card.tsx
//
// Server component. Public-facing "Audit Your AI" track-record
// surface — the headline credibility statement we put in front of
// every user. Three pieces, in order:
//
//   1. The headline number — "Last N BUY verdicts: X% beat SPY at
//      30d, p-value Y" — same statistical framing the spec uses.
//   2. Per-lens attribution row — Claude / GPT / Gemini hit-rates
//      so the user can see whose calls the global figure leaned on.
//      Sparse: any lens with zero attributable BUYs renders "—".
//   3. Disclaimer — every track-record surface in this codebase
//      ALWAYS includes the past-performance / not-advice notice.
//
// Empty-state: when there isn't a single completed-outcome BUY,
// we render an honest "not enough data yet" tile. This is the
// highest-credibility surface in the app — we'd rather show "—"
// than a hand-wavy hit rate.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  TrackRecordResult,
  PerLensHitRate,
} from "@/lib/dashboard/metrics/audit-ai";

interface AuditAiCardProps {
  result: TrackRecordResult | null;
  /**
   * Whether the figures cover a single user (in-app self-audit) or
   * the entire userbase (public marketing). Drives the wording in
   * the headline and disclaimer.
   */
  scope?: "user" | "global";
}

function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtPValue(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.001) return "p<0.001";
  return `p=${p.toFixed(3)}`;
}

function pValueColor(p: number): string {
  if (p < 0.05) return "var(--buy)";
  if (p < 0.2) return "var(--decisive)";
  return "var(--muted-foreground)";
}

function LensCell({ lens, stats }: { lens: string; stats: PerLensHitRate }) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {lens}
      </div>
      <div className="text-lg font-bold tabular-nums">
        {stats.hitRate === null ? "—" : fmtPct(stats.hitRate, 0)}
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {stats.evaluated > 0
          ? `${stats.hits}/${stats.evaluated} BUYs`
          : "no attributable BUYs yet"}
      </div>
    </div>
  );
}

export function AuditAiCard({ result, scope = "global" }: AuditAiCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Audit your AI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {result && result.totalBuys > 0 ? (
          <ResultBody result={result} scope={scope} />
        ) : (
          <EmptyState />
        )}
        <p className="text-[10px] text-muted-foreground">
          Past recommendation outcomes are informational only. Not a
          guarantee of future performance. Not investment advice.
        </p>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="text-xs text-muted-foreground">
      Not enough completed outcomes yet. The track record fills in
      as 30-day evaluation windows close on past BUY verdicts.
    </div>
  );
}

function ResultBody({
  result,
  scope,
}: {
  result: TrackRecordResult;
  scope: "user" | "global";
}) {
  const hitColor =
    result.beatBenchmarkPct >= 0.55
      ? "var(--buy)"
      : result.beatBenchmarkPct >= 0.5
        ? "var(--foreground)"
        : "var(--sell)";

  const headline =
    scope === "user"
      ? `Your last ${result.totalBuys} BUY verdicts`
      : `Last ${result.totalBuys} BUY verdicts`;

  return (
    <>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {headline}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <div className="text-3xl font-bold tabular-nums" style={{ color: hitColor }}>
            {fmtPct(result.beatBenchmarkPct, 0)}
          </div>
          <div className="text-xs text-muted-foreground">
            beat SPY at {result.windowDays}d
          </div>
          <div
            className="text-xs font-semibold"
            style={{ color: pValueColor(result.pValue) }}
          >
            {fmtPValue(result.pValue)}
          </div>
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
          Per-model attribution
        </div>
        <div className="grid grid-cols-3 gap-2">
          <LensCell lens="Claude" stats={result.perModelAttribution.claude} />
          <LensCell lens="GPT" stats={result.perModelAttribution.gpt} />
          <LensCell lens="Gemini" stats={result.perModelAttribution.gemini} />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Hit-rate vs random = 50%; lower p-value means stronger
        evidence the lens beats coin-flips on a {result.windowDays}-day
        horizon. Sample-size matters — early figures are noisier.
      </p>
    </>
  );
}
