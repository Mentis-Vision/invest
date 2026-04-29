"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useClientNowMs } from "@/lib/client/use-client-now";

type Result = {
  ticker: string;
  recDate: string;
  series: Array<{ date: string; ignored: number; actual: number; followed: number }>;
  deltaIgnored: number;
  deltaActual: number;
  deltaFollowed: number;
  fidelity: string;
};

type Horizon = "7d" | "30d" | "90d" | "all";

export function CounterfactualChart({ recId }: { recId: string }) {
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const nowMs = useClientNowMs();
  const [horizon, setHorizon] = useState<Horizon>("all");

  useEffect(() => {
    let alive = true;
    fetch(`/api/journal/counterfactual/${recId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setData(d as Result))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [recId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
        <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Computing impact…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="py-3 text-xs text-muted-foreground">
        Counterfactual not available (non-ticker recommendation, no position, or
        not enough days of data yet).
      </div>
    );
  }

  // Slice the series by horizon
  if (nowMs == null) return null;
  const now = nowMs;
  const horizonMs =
    horizon === "7d"
      ? 7 * 864e5
      : horizon === "30d"
        ? 30 * 864e5
        : horizon === "90d"
          ? 90 * 864e5
          : Infinity;
  const sliced = data.series.filter(
    (p) => now - new Date(p.date).getTime() <= horizonMs
  );
  const last = sliced[sliced.length - 1] ?? data.series[data.series.length - 1];
  const first = sliced[0] ?? data.series[0];

  const dActual = last.actual - first.ignored;
  const dFollowed = last.followed - first.ignored;
  const dIgnoredFinal = last.ignored - first.ignored;
  const values = [dIgnoredFinal, dActual, dFollowed];
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);

  return (
    <div className="rounded-md border border-border bg-secondary/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
          Impact vs alternatives
        </div>
        <div className="flex gap-1">
          {(["7d", "30d", "90d", "all"] as const).map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`rounded px-2 py-0.5 text-[10px] ${
                horizon === h
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {h === "all" ? "Since action" : h}
            </button>
          ))}
        </div>
      </div>

      <Bar label="If you ignored" value={dIgnoredFinal} max={max} tone="neutral" />
      <Bar label="Your actual path" value={dActual} max={max} tone="actual" />
      <Bar label="If you'd fully followed" value={dFollowed} max={max} tone="followed" />

      <div className="mt-2 text-[10px] text-muted-foreground">
        {data.fidelity}
      </div>
    </div>
  );
}

function Bar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "neutral" | "actual" | "followed";
}) {
  const pct = Math.min(100, Math.abs(value) / max * 100);
  const color =
    tone === "actual"
      ? "bg-primary"
      : tone === "followed"
        ? "bg-[var(--buy)]"
        : value < 0
          ? "bg-[var(--sell)]"
          : "bg-[var(--hold)]";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const display = `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return (
    <div className="mb-1 grid grid-cols-[140px_1fr_80px] items-center gap-2">
      <div className="text-[11px]">{label}</div>
      <div className="relative h-[10px] rounded-sm bg-border">
        <div
          className={`absolute left-0 top-0 h-full rounded-sm ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`font-mono text-[11px] tabular-nums ${value < 0 ? "text-[var(--sell)]" : value > 0 ? "text-[var(--buy)]" : "text-muted-foreground"}`}>
        {display}
      </div>
    </div>
  );
}
