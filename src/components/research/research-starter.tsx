"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  History as HistoryIcon,
  Flame,
  CalendarClock,
  FileText,
  Loader2,
} from "lucide-react";
import { getHoldings, type Holding } from "@/lib/client/holdings-cache";

/**
 * Editorial empty-state for the Research page.
 *
 * Replaces the blank "Enter a ticker" experience with:
 *   • "Your holdings" chips — one-click research for any position
 *   • Recently researched — the user's own last 12 lookups (last 30 days)
 *   • Earnings this week — held tickers reporting in the next 7 days
 *   • Recent filings on your holdings — 8-K/10-Q/10-K in the last 7 days
 *   • Trending — top anonymized tickers across the platform (last 7 days)
 *
 * All data is read-only and $0 — backing endpoint /api/research/starter.
 * Selecting any chip fires an onPick(ticker) which the parent uses to
 * populate the ticker input and kick off the analysis.
 */

type StarterData = {
  recent: Array<{ ticker: string; recommendation: string; when: string }>;
  trending: Array<{ ticker: string; count: number }>;
  earnings: Array<{ ticker: string; eventDate: string }>;
  filings: Array<{
    ticker: string;
    eventType: string;
    eventDate: string;
    url: string | null;
  }>;
};

export default function ResearchStarter({
  onPick,
}: {
  onPick: (ticker: string) => void;
}) {
  const [data, setData] = useState<StarterData | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/research/starter").then((r) => (r.ok ? r.json() : null)),
      getHoldings().catch(() => null),
    ]).then(([starter, h]) => {
      if (!alive) return;
      setData(starter ?? null);
      setHoldings(h?.holdings ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const topHoldings = useMemo(() => {
    return [...holdings]
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, 10);
  }, [holdings]);

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading context…
        </div>
      </div>
    );
  }

  const anyChips =
    topHoldings.length > 0 ||
    (data?.recent.length ?? 0) > 0 ||
    (data?.earnings.length ?? 0) > 0 ||
    (data?.filings.length ?? 0) > 0 ||
    (data?.trending.length ?? 0) > 0;

  if (!anyChips) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-[var(--muted-foreground)]" />
        <p className="mt-2 text-base font-medium text-[var(--foreground)]">
          Ready to research?
        </p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Enter any ticker above — or link a brokerage so we can personalize
          this starter surface.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {topHoldings.length > 0 && (
        <Lane
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Your holdings"
          description="Top positions by market value"
        >
          {topHoldings.map((h) => (
            <Chip key={h.ticker} onClick={() => onPick(h.ticker)}>
              <span className="font-mono font-medium">{h.ticker}</span>
              {h.value != null && (
                <span className="ml-2 text-[10px] text-[var(--muted-foreground)]">
                  ${Math.round(h.value).toLocaleString("en-US")}
                </span>
              )}
            </Chip>
          ))}
        </Lane>
      )}

      {(data?.earnings?.length ?? 0) > 0 && (
        <Lane
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          label="Earnings this week"
          description="Held tickers reporting in the next 7 days"
        >
          {data!.earnings.map((e) => {
            const days = daysUntil(e.eventDate);
            return (
              <Chip key={e.ticker} onClick={() => onPick(e.ticker)}>
                <span className="font-mono font-medium">{e.ticker}</span>
                <span className="ml-2 text-[10px] text-[var(--decisive)]">
                  {days <= 0
                    ? "today"
                    : `${days}d`}
                </span>
              </Chip>
            );
          })}
        </Lane>
      )}

      {(data?.filings?.length ?? 0) > 0 && (
        <Lane
          icon={<FileText className="h-3.5 w-3.5" />}
          label="Recent filings on your holdings"
          description="SEC filings in the last 7 days"
        >
          {data!.filings.map((f, i) => (
            <Chip
              key={`${f.ticker}-${f.eventType}-${i}`}
              onClick={() => onPick(f.ticker)}
            >
              <span className="font-mono font-medium">{f.ticker}</span>
              <span className="ml-2 text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">
                {filingLabel(f.eventType)}
              </span>
            </Chip>
          ))}
        </Lane>
      )}

      {(data?.recent?.length ?? 0) > 0 && (
        <Lane
          icon={<HistoryIcon className="h-3.5 w-3.5" />}
          label="Recently researched"
          description="Your queries in the last 30 days"
        >
          {data!.recent.map((r) => (
            <Chip
              key={`${r.ticker}-${r.when}`}
              onClick={() => onPick(r.ticker)}
            >
              <span className="font-mono font-medium">{r.ticker}</span>
              <span
                className={`ml-2 text-[10px] ${recColor(r.recommendation)}`}
              >
                {r.recommendation}
              </span>
            </Chip>
          ))}
        </Lane>
      )}

      {(data?.trending?.length ?? 0) > 0 && (
        <Lane
          icon={<Flame className="h-3.5 w-3.5" />}
          label="Trending on ClearPath"
          description="Most-researched tickers across the platform (last 7 days)"
        >
          {data!.trending.map((t) => (
            <Chip key={t.ticker} onClick={() => onPick(t.ticker)}>
              <span className="font-mono font-medium">{t.ticker}</span>
              <span className="ml-2 text-[10px] text-[var(--muted-foreground)]">
                {t.count}×
              </span>
            </Chip>
          ))}
        </Lane>
      )}
    </div>
  );
}

function Lane({
  icon,
  label,
  description,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between border-b border-[var(--border)] pb-1.5">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--foreground)] font-medium">
          <span className="text-[var(--muted-foreground)]">{icon}</span>
          {label}
        </div>
        {description && (
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {description}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function Chip({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-baseline rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs transition-all hover:-translate-y-[1px] hover:border-[var(--foreground)]/40 hover:shadow-[0_2px_8px_-6px_rgba(26,22,19,0.3)]"
    >
      {children}
      <span
        aria-hidden
        className="ml-1 text-[var(--muted-foreground)] opacity-0 transition-opacity group-hover:opacity-70"
      >
        ↗
      </span>
    </button>
  );
}

function daysUntil(iso: string): number {
  const d = new Date(iso).getTime();
  const now = new Date().setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

function filingLabel(eventType: string): string {
  switch (eventType) {
    case "filing_8k":
      return "8-K";
    case "filing_10q":
      return "10-Q";
    case "filing_10k":
      return "10-K";
    default:
      return eventType;
  }
}

function recColor(rec: string): string {
  switch (rec) {
    case "BUY":
      return "text-[var(--buy)]";
    case "SELL":
      return "text-[var(--sell)]";
    case "HOLD":
      return "text-[var(--hold)]";
    default:
      return "text-[var(--muted-foreground)]";
  }
}
