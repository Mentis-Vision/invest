"use client";

/**
 * Block content components — one per registered block ID.
 *
 * Each block is a small React component that renders just the body
 * (no header, no card — that chrome lives in BlockShell). It pulls
 * its own data from existing endpoints and handles loading / empty
 * states locally.
 *
 * Blocks are registered in blocks.tsx's BLOCK_REGISTRY at the bottom
 * of this file. When you add a block:
 *   1. Write the body component here.
 *   2. Add it to the registry with title, hint, defaultSize, and an
 *      optional catalog description shown in the Add panel.
 *   3. Add the ID to DEFAULT_LAYOUT in lib/dashboard-layout.ts if it
 *      should be on by default.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Holding } from "@/lib/client/holdings-cache";
import { getHoldings } from "@/lib/client/holdings-cache";
import { MiniSparkline } from "@/components/research/mini-sparkline";

// ─── Shared helpers ──────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

function fmtCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  const s = n > 0 ? "+" : "";
  return `${s}${n.toFixed(digits)}%`;
}

function toneClass(
  n: number | null | undefined,
  threshold = 0
): "text-[var(--buy)]" | "text-[var(--sell)]" | "text-muted-foreground" {
  if (n == null) return "text-muted-foreground";
  if (n > threshold) return "text-[var(--buy)]";
  if (n < threshold) return "text-[var(--sell)]";
  return "text-muted-foreground";
}

function relTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 60) return `${Math.max(diffMin, 0)}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Shared data hook (holdings) ─────────────────────────────────────

type Totals = {
  holdings: Holding[];
  totalValue: number;
  connected: boolean;
  /** Portfolio-level day-change (computed from snapshot-series when
   *  available). Per-holding day-change isn't in the SnapTrade payload,
   *  so we use yesterday's portfolio-snapshot vs today's total. */
  dayChangePct: number | null;
  dayChangeDollar: number | null;
  cashPct: number;
};

function useHoldings(): { data: Totals | null; loading: boolean } {
  const [state, setState] = useState<{ data: Totals | null; loading: boolean }>({
    data: null,
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    Promise.all([
      getHoldings(),
      fetch("/api/track-record")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([d, tr]) => {
        if (!alive) return;
        const holdings = d.holdings ?? [];
        const totalValue = d.totalValue ?? 0;
        // Day change: today's total vs yesterday's snapshot.
        let dayChangeDollar: number | null = null;
        let dayChangePct: number | null = null;
        const series = (tr?.portfolioSeries ?? []) as Array<{
          date: string;
          totalValue: number;
        }>;
        if (series.length >= 2 && totalValue > 0) {
          const prev = series[series.length - 2]?.totalValue ?? 0;
          if (prev > 0) {
            dayChangeDollar = totalValue - prev;
            dayChangePct = (dayChangeDollar / prev) * 100;
          }
        }
        // Cash share
        const cashClasses = new Set(["cash", "money_market", "mmf"]);
        const cash = holdings.reduce((sum, h) => {
          const cls = (h.assetClass ?? "").toLowerCase();
          const isCash =
            cashClasses.has(cls) ||
            h.ticker.toUpperCase() === "CASH" ||
            h.ticker.toUpperCase().endsWith("CASH");
          return isCash ? sum + (h.value ?? 0) : sum;
        }, 0);
        const cashPct = totalValue > 0 ? (cash / totalValue) * 100 : 0;
        setState({
          data: {
            holdings,
            totalValue,
            connected: !!d.connected,
            dayChangePct,
            dayChangeDollar,
            cashPct,
          },
          loading: false,
        });
      })
      .catch(() => {
        if (alive) setState({ data: null, loading: false });
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

// ─── 1. Summary (KPI row) ────────────────────────────────────────────

export function BlockSummary() {
  const { data, loading } = useHoldings();
  const [hitRate, setHitRate] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/track-record")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.outcomes) return;
        const { wins, evaluated } = d.outcomes;
        if (evaluated > 0) setHitRate((wins / evaluated) * 100);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded bg-secondary/50"
          />
        ))}
      </div>
    );
  }
  const stats: Array<{ k: string; v: string; d?: string; tone?: string }> = [
    {
      k: "Total Value",
      v: data?.connected ? fmtMoney(data.totalValue, 0) : "Not connected",
      d:
        data?.dayChangeDollar != null && data?.dayChangePct != null
          ? `${data.dayChangeDollar > 0 ? "+" : ""}${fmtMoney(data.dayChangeDollar, 0)} (${fmtPct(data.dayChangePct)}) today`
          : undefined,
      tone:
        data?.dayChangePct != null && data.dayChangePct > 0
          ? "text-[var(--buy)]"
          : data?.dayChangePct != null && data.dayChangePct < 0
            ? "text-[var(--sell)]"
            : undefined,
    },
    {
      k: "Positions",
      v: data ? String(data.holdings.length) : "—",
      d: data?.connected ? "Across linked accounts" : "Link a brokerage",
    },
    {
      k: "Cash",
      v: data ? `${data.cashPct.toFixed(1)}%` : "—",
      d: data && data.cashPct < 5 ? "Light" : data && data.cashPct > 20 ? "Heavy" : "Balanced",
    },
    {
      k: "Hit rate",
      v: hitRate != null ? `${Math.round(hitRate)}%` : "—",
      d: hitRate != null ? "Last 12 months" : "No outcomes yet",
    },
    {
      k: "Day change",
      v: data?.dayChangePct != null ? fmtPct(data.dayChangePct) : "—",
      tone:
        data?.dayChangePct != null && data.dayChangePct > 0
          ? "text-[var(--buy)]"
          : data?.dayChangePct != null && data.dayChangePct < 0
            ? "text-[var(--sell)]"
            : undefined,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((s) => (
        <div key={s.k}>
          <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {s.k}
          </div>
          <div
            className={`mt-1 font-mono text-[20px] font-semibold tracking-[-0.02em] ${s.tone ?? "text-foreground"}`}
          >
            {s.v}
          </div>
          {s.d && (
            <div className={`mt-1 text-[11px] ${s.tone ?? "text-muted-foreground"}`}>
              {s.d}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 2. Holdings table ───────────────────────────────────────────────

export function BlockHoldings() {
  const { data, loading } = useHoldings();
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-secondary/40" />
        ))}
      </div>
    );
  }
  if (!data?.connected || data.holdings.length === 0) {
    return (
      <div className="py-6 text-center text-[13px] text-muted-foreground">
        <p>No holdings synced yet.</p>
        <Link
          href="/app?view=portfolio"
          className="mt-2 inline-block text-[13px] font-medium text-primary hover:underline"
        >
          Link a brokerage →
        </Link>
      </div>
    );
  }
  const sorted = [...data.holdings].sort(
    (a, b) => (b.value ?? 0) - (a.value ?? 0)
  );
  const maxVal = Math.max(...sorted.map((h) => h.value ?? 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            <th className="py-1.5 pr-2 text-left font-medium">Ticker</th>
            <th className="py-1.5 pr-2 text-left font-medium">Name</th>
            <th className="py-1.5 pr-2 text-left font-medium">Weight</th>
            <th className="py-1.5 pr-2 text-right font-medium font-mono">
              Shares
            </th>
            <th className="py-1.5 pr-2 text-right font-medium font-mono">
              Price
            </th>
            <th className="py-1.5 text-right font-medium font-mono">Value</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 10).map((h) => {
            const weight = maxVal > 0 ? ((h.value ?? 0) / maxVal) * 100 : 0;
            return (
              <tr key={h.ticker} className="border-b border-border/60">
                <td className="py-2 pr-2 font-mono font-semibold text-foreground">
                  {h.ticker}
                </td>
                <td className="py-2 pr-2 text-muted-foreground">
                  {h.name ?? h.ticker}
                </td>
                <td className="py-2 pr-2">
                  <div className="h-1 w-14 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${weight}%` }}
                    />
                  </div>
                </td>
                <td className="py-2 pr-2 text-right font-mono text-muted-foreground">
                  {h.shares.toLocaleString("en-US", {
                    maximumFractionDigits: 4,
                  })}
                </td>
                <td className="py-2 pr-2 text-right font-mono text-foreground">
                  {fmtMoney(h.price, 2).replace("$", "")}
                </td>
                <td className="py-2 text-right font-mono text-foreground">
                  {fmtCompact(h.value)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── 3. Alerts ───────────────────────────────────────────────────────

type Alert = {
  id: string;
  ticker: string | null;
  kind: string;
  title: string;
  seen: boolean;
  createdAt: string;
};

export function BlockAlerts() {
  const [items, setItems] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/alerts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setItems((d.items as Alert[]) ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (loading)
    return <div className="h-16 animate-pulse rounded bg-secondary/30" />;
  if (items.length === 0)
    return (
      <div className="py-4 text-center text-[12px] text-muted-foreground">
        All caught up.
      </div>
    );
  return (
    <ul className="divide-y divide-border/60 text-[12px]">
      {items.slice(0, 5).map((a) => (
        <li key={a.id} className="flex items-baseline justify-between py-2">
          <span className="text-foreground/90">
            {a.ticker && (
              <span className="mr-2 font-mono font-semibold">{a.ticker}</span>
            )}
            {a.title}
          </span>
          <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {a.kind.replace(/_/g, " ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─── 4. Performance chart (YTD portfolio value) ─────────────────────

type Point = { date: string; totalValue: number };

export function BlockChart() {
  const [series, setSeries] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/track-record")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.portfolioSeries) return;
        setSeries(d.portfolioSeries as Point[]);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (loading)
    return <div className="h-32 animate-pulse rounded bg-secondary/30" />;
  if (series.length < 2)
    return (
      <div className="py-8 text-center text-[12px] text-muted-foreground">
        Need at least two daily snapshots. Back tomorrow.
      </div>
    );
  const values = series.map((p) => p.totalValue);
  const first = values[0];
  const last = values[values.length - 1];
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className={`font-mono text-[14px] font-semibold ${toneClass(pct)}`}>
          {fmtPct(pct)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {series.length} days
        </span>
      </div>
      <div className="h-28">
        <MiniSparkline data={values} width={520} height={112} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{series[0].date}</span>
        <span className="font-mono">{fmtMoney(last)}</span>
      </div>
    </div>
  );
}

// ─── 5. In the news ──────────────────────────────────────────────────

type NewsItem = {
  id: string;
  publishedAt: string;
  providerName: string;
  title: string;
  url: string;
  tickersMentioned: string[];
};

export function BlockNews() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/market-news?scope=portfolio&limit=5")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.items) return;
        setItems(d.items as NewsItem[]);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (loading)
    return <div className="h-24 animate-pulse rounded bg-secondary/30" />;
  if (items.length === 0)
    return (
      <div className="py-4 text-center text-[12px] text-muted-foreground">
        Nothing on your holdings right now.
      </div>
    );
  return (
    <ul className="divide-y divide-border/60">
      {items.map((n) => (
        <li key={n.id} className="py-2.5">
          <a
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block transition-colors hover:text-primary"
          >
            <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {n.providerName}
              {n.tickersMentioned.slice(0, 2).length > 0 && (
                <span className="ml-1">
                  · <span className="font-mono">{n.tickersMentioned.slice(0, 2).join(" ")}</span>
                </span>
              )}{" "}
              · {relTime(n.publishedAt)}
            </div>
            <div className="mt-0.5 text-[13px] leading-snug">{n.title}</div>
          </a>
        </li>
      ))}
    </ul>
  );
}

// ─── 6. Calendar ─────────────────────────────────────────────────────

type UpEvent = {
  ticker: string;
  eventType: string;
  eventDate: string;
};

function labelForEvent(t: string): string {
  switch (t) {
    case "earnings":
      return "Earnings";
    case "dividend_ex":
      return "Ex-dividend";
    case "dividend_pay":
      return "Dividend pay";
    case "filing_10q":
      return "10-Q filing";
    case "filing_10k":
      return "10-K filing";
    case "filing_8k":
      return "8-K filing";
    default:
      return t;
  }
}

export function BlockCalendar() {
  const [items, setItems] = useState<UpEvent[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/upcoming-evaluations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.events) return;
        setItems(d.events as UpEvent[]);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (loading)
    return <div className="h-24 animate-pulse rounded bg-secondary/30" />;
  if (items.length === 0)
    return (
      <div className="py-4 text-center text-[12px] text-muted-foreground">
        Quiet week ahead.
      </div>
    );
  return (
    <ul className="divide-y divide-border/60">
      {items.slice(0, 6).map((e, i) => {
        const d = new Date(e.eventDate);
        const day = d.toLocaleDateString("en-US", { weekday: "short" });
        const date = d.getDate();
        return (
          <li
            key={`${e.ticker}-${i}`}
            className="grid grid-cols-[44px_1fr_auto] items-baseline gap-3 py-2"
          >
            <div>
              <div className="font-mono text-[15px] font-semibold leading-none">
                {date}
              </div>
              <div className="mt-1 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                {day}
              </div>
            </div>
            <div className="text-[12px]">
              <span className="font-mono font-semibold">{e.ticker}</span>
              <span className="ml-2 text-muted-foreground">
                {labelForEvent(e.eventType)}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── 7. Sector mix ───────────────────────────────────────────────────

export function BlockSector() {
  const { data, loading } = useHoldings();
  if (loading)
    return <div className="h-24 animate-pulse rounded bg-secondary/30" />;
  if (!data?.connected || data.holdings.length === 0)
    return (
      <div className="py-4 text-center text-[12px] text-muted-foreground">
        No sector data yet.
      </div>
    );
  const buckets = new Map<string, number>();
  for (const h of data.holdings) {
    const s = h.sector ?? "Unclassified";
    buckets.set(s, (buckets.get(s) ?? 0) + (h.value ?? 0));
  }
  const rows = [...buckets.entries()]
    .map(([s, v]) => ({ sector: s, value: v, pct: (v / data.totalValue) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li
          key={r.sector}
          className="grid grid-cols-[1fr_auto] items-center gap-3 text-[12px]"
        >
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-foreground/85">{r.sector}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {r.pct.toFixed(0)}%
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(r.pct, 100)}%` }}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── 8. Macro ────────────────────────────────────────────────────────

type MacroPoint = {
  series: string;
  label: string;
  value: number;
  unit?: string;
  delta?: number;
};

export function BlockMacro() {
  const [items, setItems] = useState<MacroPoint[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/macro")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.snapshot) return;
        setItems((d.snapshot as MacroPoint[]).slice(0, 4));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (loading)
    return <div className="h-24 animate-pulse rounded bg-secondary/30" />;
  if (items.length === 0)
    return (
      <div className="py-4 text-center text-[12px] text-muted-foreground">
        Macro unavailable.
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((m) => (
        <div key={m.series} className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {m.label}
          </div>
          <div className="mt-1 font-mono text-[15px] font-semibold">
            {m.value.toFixed(2)}
            {m.unit === "Percent" ? "%" : ""}
          </div>
          {typeof m.delta === "number" && (
            <div className="text-[10px] text-muted-foreground">
              {m.delta > 0 ? "+" : ""}
              {m.delta.toFixed(2)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 9. Recent research ──────────────────────────────────────────────

type Rec = {
  id: string;
  ticker: string;
  recommendation: string;
  createdAt: string;
};

export function BlockResearch() {
  const [items, setItems] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/track-record?limit=5")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.recent) return;
        setItems((d.recent as Rec[]).slice(0, 5));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (loading)
    return <div className="h-24 animate-pulse rounded bg-secondary/30" />;
  if (items.length === 0)
    return (
      <div className="py-4 text-center text-[12px] text-muted-foreground">
        No research yet. Try the Research tab.
      </div>
    );
  return (
    <ul className="divide-y divide-border/60 text-[12px]">
      {items.map((r) => {
        const cls =
          r.recommendation === "BUY"
            ? "text-[var(--buy)] bg-[var(--buy)]/10"
            : r.recommendation === "SELL"
              ? "text-[var(--sell)] bg-[var(--sell)]/10"
              : "text-[var(--hold)] bg-[var(--hold)]/10";
        return (
          <li key={r.id} className="flex items-baseline justify-between py-2">
            <span>
              <span className="font-mono font-semibold">{r.ticker}</span>
              <span
                className={`ml-2 inline-block rounded-sm px-1.5 py-0.5 font-mono text-[10px] ${cls}`}
              >
                {r.recommendation}
              </span>
            </span>
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {relTime(r.createdAt)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── 10. Top movers ──────────────────────────────────────────────────

type TapeHolding = {
  symbol: string;
  changePct: number;
  up: boolean;
  kind: "index" | "holding";
};

export function BlockMovers() {
  const [items, setItems] = useState<TapeHolding[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/ticker-tape")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        // ticker-tape returns indexes + holdings; keep holdings only
        // for the "top movers" view.
        const all = (d?.items ?? []) as TapeHolding[];
        setItems(all.filter((x) => x.kind === "holding"));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (loading)
    return <div className="h-20 animate-pulse rounded bg-secondary/30" />;
  if (items.length === 0)
    return (
      <div className="py-4 text-center text-[12px] text-muted-foreground">
        Sync your holdings to see movers.
      </div>
    );
  const sorted = [...items]
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 5);
  return (
    <ul className="divide-y divide-border/60 text-[12px]">
      {sorted.map((h) => (
        <li
          key={h.symbol}
          className="flex items-baseline justify-between py-2"
        >
          <span className="font-mono font-semibold">{h.symbol}</span>
          <span className={`font-mono ${toneClass(h.changePct)}`}>
            {fmtPct(h.changePct)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─── Placeholder for "coming soon" blocks ────────────────────────────

export function BlockPlaceholder({ label }: { label: string }) {
  return (
    <div className="py-6 text-center text-[12px] text-muted-foreground">
      <p className="font-medium text-foreground/70">{label} is coming soon.</p>
      <p className="mt-1">We&rsquo;ll wire this up shortly.</p>
    </div>
  );
}

// ─── Block registry ──────────────────────────────────────────────────

import type { ComponentType } from "react";
import type { BlockSize } from "@/lib/dashboard-layout";

export type BlockDef = {
  id: string;
  title: string;
  hint?: string;
  defaultSize: BlockSize;
  Component: ComponentType;
  /** Short description for the Add panel. */
  description: string;
};

export const BLOCK_REGISTRY: Record<string, BlockDef> = {
  summary: {
    id: "summary",
    title: "Portfolio summary",
    hint: "Today",
    defaultSize: 12,
    Component: BlockSummary,
    description: "Total value, day change, positions, cash, hit rate",
  },
  holdings: {
    id: "holdings",
    title: "Holdings",
    hint: "By weight",
    defaultSize: 8,
    Component: BlockHoldings,
    description: "Dense table of all positions with prices + day change",
  },
  alerts: {
    id: "alerts",
    title: "Alerts",
    hint: "Overnight",
    defaultSize: 4,
    Component: BlockAlerts,
    description: "Price moves, insider activity, concentration flags",
  },
  chart: {
    id: "chart",
    title: "Performance",
    hint: "YTD",
    defaultSize: 6,
    Component: BlockChart,
    description: "Portfolio value sparkline over the year",
  },
  news: {
    id: "news",
    title: "In the news",
    hint: "Your holdings",
    defaultSize: 6,
    Component: BlockNews,
    description: "WSJ / CNBC / IBD headlines mentioning your tickers",
  },
  calendar: {
    id: "calendar",
    title: "Calendar",
    hint: "This week",
    defaultSize: 4,
    Component: BlockCalendar,
    description: "Earnings, ex-dividends, filings on your holdings",
  },
  sector: {
    id: "sector",
    title: "Sector mix",
    hint: "By weight",
    defaultSize: 4,
    Component: BlockSector,
    description: "Horizontal bar breakdown of sector allocation",
  },
  macro: {
    id: "macro",
    title: "Macro",
    hint: "FRED",
    defaultSize: 4,
    Component: BlockMacro,
    description: "10-Y yield, Fed funds, CPI, USD index",
  },
  research: {
    id: "research",
    title: "Recent research",
    hint: "Last 30 days",
    defaultSize: 4,
    Component: BlockResearch,
    description: "Your most recent research reads with verdicts",
  },
  movers: {
    id: "movers",
    title: "Top movers",
    hint: "Today",
    defaultSize: 4,
    Component: BlockMovers,
    description: "Biggest absolute % moves in your portfolio today",
  },
};

/** Catalog for the Add-a-section panel — registered blocks + some
 *  placeholder "coming soon" items so the shape is visible. */
export const ADD_CATALOG: Array<{ id: string; label: string; description: string }> = [
  ...Object.values(BLOCK_REGISTRY).map((b) => ({
    id: b.id,
    label: b.title,
    description: b.description,
  })),
  { id: "watchlist", label: "Watchlist", description: "Tickers you follow without holding (soon)" },
  { id: "worth-reading", label: "Worth reading", description: "Damodaran / Marks long-form (soon)" },
  { id: "insider", label: "Insider activity", description: "SEC Form 4 on your holdings (soon)" },
  { id: "dividends", label: "Dividend calendar", description: "Pay dates + ex-div dates (soon)" },
  { id: "notes", label: "Notes", description: "Your own notes on holdings (soon)" },
];
