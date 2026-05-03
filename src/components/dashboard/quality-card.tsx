// src/components/dashboard/quality-card.tsx
//
// Server component: renders the four fundamental quality scores for a
// single ticker (Piotroski F-Score, Altman Z, Beneish M, Sloan Accruals)
// in the Editorial Warm theme. When the warehouse can't compute a score
// (insufficient inputs), the cell renders "—" — same convention used by
// RiskTile when sample size is too small.

import { getQualityScores } from "@/lib/dashboard/metrics/quality-loader";

interface ZoneStyle {
  label: string;
  color: string;
  blurb: string;
}

function piotroskiZone(score: number): ZoneStyle {
  if (score >= 7) {
    return {
      label: "strong",
      color: "var(--buy)",
      blurb: "Cash flow, leverage, and efficiency all trending healthy.",
    };
  }
  if (score >= 4) {
    return {
      label: "mixed",
      color: "var(--hold)",
      blurb: "Some checks improving, others deteriorating — read the period detail.",
    };
  }
  return {
    label: "weak",
    color: "var(--sell)",
    blurb: "Multiple accounting-quality checks failing simultaneously.",
  };
}

function altmanZone(z: number): ZoneStyle {
  if (z >= 2.99) {
    return {
      label: "safe",
      color: "var(--buy)",
      blurb: "Bankruptcy probability is low on the textbook 5-factor model.",
    };
  }
  if (z >= 1.81) {
    return {
      label: "grey",
      color: "var(--hold)",
      blurb: "Grey zone — heightened scrutiny warranted but not distress.",
    };
  }
  return {
    label: "distress",
    color: "var(--sell)",
    blurb: "Distress zone. Hard 'do not recommend' threshold per the spec.",
  };
}

function beneishZone(m: number): ZoneStyle {
  if (m > -1.78) {
    return {
      label: "flag",
      color: "var(--sell)",
      blurb: "Above the −1.78 threshold — potential earnings manipulation signals.",
    };
  }
  return {
    label: "clean",
    color: "var(--buy)",
    blurb: "Below the manipulation threshold; accruals/sales/leverage indices are stable.",
  };
}

function sloanZone(ratio: number): ZoneStyle {
  if (ratio >= 0.10) {
    return {
      label: "high",
      color: "var(--sell)",
      blurb: "Earnings driven by accruals more than cash — quality concern.",
    };
  }
  if (ratio >= 0.04) {
    return {
      label: "elevated",
      color: "var(--hold)",
      blurb: "Modest accrual buildup — watch for follow-through next period.",
    };
  }
  return {
    label: "clean",
    color: "var(--buy)",
    blurb: "CFO closely tracks net income — earnings backed by cash.",
  };
}

function fmtZ(n: number): string {
  return n.toFixed(2);
}

function fmtPctRatio(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function Cell({
  title,
  value,
  zone,
}: {
  title: string;
  value: string;
  zone: ZoneStyle | null;
}) {
  return (
    <div className="border border-[var(--border)] rounded p-2">
      <div className="text-[10px] tracking-widest uppercase text-[var(--muted-foreground)]">
        {title}
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <div
          className="font-bold text-base"
          style={{ color: zone?.color ?? "var(--foreground)" }}
        >
          {value}
        </div>
        {zone ? (
          <div
            className="text-[10px] uppercase tracking-wider"
            style={{ color: zone.color }}
          >
            {zone.label}
          </div>
        ) : null}
      </div>
      {zone ? (
        <div className="text-[11px] text-[var(--muted-foreground)] mt-1 leading-snug">
          {zone.blurb}
        </div>
      ) : (
        <div className="text-[11px] text-[var(--muted-foreground)] mt-1 leading-snug">
          Not enough warehouse data to compute.
        </div>
      )}
    </div>
  );
}

export async function QualityCard({ ticker }: { ticker: string }) {
  const scores = await getQualityScores(ticker);

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] tracking-widest uppercase text-[var(--muted-foreground)]">
          Fundamentals Quality · {ticker.toUpperCase()}
        </div>
        {scores?.priorPiotroski != null && scores?.piotroski != null ? (
          <div className="text-[11px] text-[var(--muted-foreground)]">
            prior F: {scores.priorPiotroski}/9
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Cell
          title="Piotroski F-Score"
          value={
            scores?.piotroski != null ? `${scores.piotroski}/9` : "—"
          }
          zone={
            scores?.piotroski != null ? piotroskiZone(scores.piotroski) : null
          }
        />
        <Cell
          title="Altman Z"
          value={scores?.altmanZ != null ? fmtZ(scores.altmanZ) : "—"}
          zone={
            scores?.altmanZ != null ? altmanZone(scores.altmanZ) : null
          }
        />
        <Cell
          title="Beneish M"
          value={scores?.beneishM != null ? fmtZ(scores.beneishM) : "—"}
          zone={
            scores?.beneishM != null ? beneishZone(scores.beneishM) : null
          }
        />
        <Cell
          title="Sloan Accruals"
          value={
            scores?.sloanAccruals != null
              ? fmtPctRatio(scores.sloanAccruals)
              : "—"
          }
          zone={
            scores?.sloanAccruals != null
              ? sloanZone(scores.sloanAccruals)
              : null
          }
        />
      </div>
      <div className="mt-2 text-[10px] text-[var(--muted-foreground)] italic">
        Informational only, not investment advice.
      </div>
    </div>
  );
}
