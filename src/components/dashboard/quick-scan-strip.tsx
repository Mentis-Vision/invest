"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Pre-populated quick-scan data strip for the Next Move hero. Pulls from
 * /api/dashboard/quick-scan/[ticker] which reads the warehouse + user's
 * holding row. Zero AI cost.
 *
 * Renders 5 data points + a latest headline. Returns null when:
 *   - ticker prop is null (non-ticker-specific Next Move)
 *   - API returns an error (graceful degradation — hero still renders)
 */

type WarehouseTickerData = {
  ticker: string;
  name?: string | null;
  lastPrice: number | null;
  changePct: number | null;
  range52w: { low: number | null; high: number | null } | null;
  avgCostBasis: number | null;
  unrealizedPct: number | null;
  move30d: number | null;
  rsi14: number | null;
  latestHeadline: { source: string; title: string; whenAgo: string } | null;
};

export function QuickScanStrip({
  ticker,
  apiPath = "/api/dashboard/quick-scan",
}: {
  ticker: string | null;
  apiPath?: string;
}) {
  const [data, setData] = useState<WarehouseTickerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticker) {
      const timer = setTimeout(() => setLoading(false), 0);
      return () => clearTimeout(timer);
    }
    const loadingTimer = setTimeout(() => {
      setLoading(true);
      setData(null);
    }, 0);
    let alive = true;
    fetch(`${apiPath}/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setData(d as WarehouseTickerData);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      clearTimeout(loadingTimer);
    };
  }, [ticker, apiPath]);

  if (!ticker) return null;
  if (loading) {
    return (
      <div className="mb-4 h-24 animate-pulse rounded-md bg-secondary/40" />
    );
  }
  if (!data) return null;

  return (
    <div className="mb-4 rounded-md bg-secondary/40 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[13px]">
          <span className="font-mono font-semibold">{data.ticker}</span>
          {data.name && (
            <span className="text-muted-foreground"> &middot; {data.name}</span>
          )}
          {data.lastPrice !== null && (
            <span className="ml-1 font-mono">${data.lastPrice.toFixed(2)}</span>
          )}
          {data.changePct !== null && (
            <span
              className={`ml-1 font-mono text-[12px] ${
                data.changePct >= 0
                  ? "text-[var(--buy)]"
                  : "text-[var(--sell)]"
              }`}
            >
              {data.changePct >= 0 ? "+" : ""}
              {data.changePct.toFixed(2)}%
            </span>
          )}
        </div>
        <Link
          href={`/app?view=research&ticker=${encodeURIComponent(ticker)}`}
          className="text-[11px] text-primary underline-offset-4 hover:underline"
        >
          Full research &rarr;
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Datum
          label="52w range"
          value={
            data.range52w?.low != null && data.range52w?.high != null
              ? `$${data.range52w.low.toFixed(2)} \u2013 $${data.range52w.high.toFixed(2)}`
              : "\u2014"
          }
        />
        <Datum
          label="Your avg"
          value={
            data.avgCostBasis != null
              ? `$${data.avgCostBasis.toFixed(2)}`
              : "\u2014"
          }
        />
        <Datum
          label="Unrealized"
          value={
            data.unrealizedPct != null
              ? `${data.unrealizedPct >= 0 ? "+" : ""}${data.unrealizedPct.toFixed(1)}%`
              : "\u2014"
          }
          tone={data.unrealizedPct}
        />
        <Datum
          label="30d"
          value={
            data.move30d != null
              ? `${data.move30d >= 0 ? "+" : ""}${data.move30d.toFixed(1)}%`
              : "\u2014"
          }
          tone={data.move30d}
        />
        <Datum
          label="RSI(14)"
          value={data.rsi14 != null ? data.rsi14.toFixed(0) : "\u2014"}
        />
      </div>

      {data.latestHeadline && (
        <div className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          &ldquo;{data.latestHeadline.title}&rdquo; (
          {data.latestHeadline.source} &middot; {data.latestHeadline.whenAgo})
        </div>
      )}
    </div>
  );
}

function Datum({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number | null;
}) {
  const color =
    tone == null
      ? ""
      : tone > 0
        ? "text-[var(--buy)]"
        : tone < 0
          ? "text-[var(--sell)]"
          : "";
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      <div className={`font-mono text-[12px] ${color}`}>{value}</div>
    </div>
  );
}
