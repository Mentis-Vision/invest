"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Holding } from "@/lib/client/holdings-cache";
import {
  DrillHeader,
  DrillBody,
  DrillSection,
  StatRow,
  DrillFooterLink,
} from "./panel-shell";
import { money, moneyFull, pctRawSigned } from "../format";

/**
 * Shows the user's specific position for this ticker — shares, cost
 * basis, unrealized P&L, plus any recommendations and trades on the
 * ticker pulled from /api/track-record/[ticker].
 */
export function DrillPosition({ holding }: { holding: Holding }) {
  const ticker = holding.ticker;
  const [record, setRecord] = useState<{
    recs: Array<{
      id: string;
      recommendation: "BUY" | "HOLD" | "SELL";
      createdAt: string;
      priceAtRec: number;
      currentPrice?: number | null;
      pctMove?: number | null;
      outcome?: string | null;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/track-record/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setRecord(d);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ticker]);

  const shares = Number(holding.shares) || 0;
  const price = Number(holding.price) || 0;
  const value =
    typeof holding.value === "number" && holding.value > 0
      ? holding.value
      : shares * price;
  const costBasis =
    typeof holding.costBasis === "number"
      ? holding.costBasis
      : null;
  const unrealized = costBasis != null ? value - costBasis * shares : null;
  const unrealizedPct =
    costBasis != null && costBasis > 0
      ? ((price - costBasis) / costBasis) * 100
      : null;

  return (
    <>
      <DrillHeader
        eyebrow="Your position"
        title={<span className="font-mono tracking-tight">{ticker}</span>}
        subtitle={
          <>
            <span className="block">{holding.name}</span>
            {(holding.institutionName || holding.accountName) && (
              <span className="block mt-1 text-[10px] uppercase tracking-widest opacity-70">
                {holding.institutionName}
                {holding.accountName ? ` · ${holding.accountName}` : ""}
              </span>
            )}
          </>
        }
        action={
          <div className="flex gap-2">
            <DrillFooterLink
              href={`/app?view=research&ticker=${encodeURIComponent(ticker)}`}
            >
              Run full research
            </DrillFooterLink>
          </div>
        }
      />
      <DrillBody>
        <DrillSection label="Position">
          <StatRow
            label="Shares"
            value={shares.toLocaleString("en-US", {
              maximumFractionDigits: 6,
            })}
          />
          <StatRow label="Last price" value={moneyFull(price)} />
          <StatRow label="Market value" value={moneyFull(value)} />
          <StatRow
            label="Avg cost basis"
            value={costBasis != null ? moneyFull(costBasis) : "—"}
          />
          {unrealized != null && unrealizedPct != null && (
            <StatRow
              label="Unrealized P&L"
              value={`${moneyFull(unrealized)} · ${pctRawSigned(unrealizedPct)}`}
              tone={unrealized >= 0 ? "up" : "down"}
            />
          )}
          {holding.sector && (
            <StatRow
              label="Sector / industry"
              value={
                holding.industry
                  ? `${holding.sector} · ${holding.industry}`
                  : holding.sector
              }
            />
          )}
          {holding.assetClass && (
            <StatRow label="Asset class" value={holding.assetClass} />
          )}
        </DrillSection>

        <DrillSection
          label="Recommendations on this ticker"
          description={loading ? "loading…" : `${record?.recs?.length ?? 0} total`}
        >
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="h-3 w-3 animate-spin" /> fetching track record…
            </div>
          ) : !record || record.recs.length === 0 ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--secondary)]/60 px-3 py-3 text-sm text-[var(--muted-foreground)]">
              No research history for this ticker yet. Try running research
              from the action above to build your track record.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {record.recs.slice(0, 8).map((r) => {
                const tone =
                  r.recommendation === "BUY"
                    ? "text-[var(--buy)]"
                    : r.recommendation === "SELL"
                      ? "text-[var(--sell)]"
                      : "text-[var(--hold)]";
                return (
                  <li
                    key={r.id}
                    className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-3 py-2 text-sm"
                  >
                    <span
                      className={`font-mono text-[11px] uppercase tracking-widest ${tone}`}
                    >
                      {r.recommendation}
                    </span>
                    <span className="text-[11px] text-[var(--muted-foreground)] font-mono tabular-nums">
                      {r.createdAt.slice(0, 10)}
                    </span>
                    <span className="font-mono tabular-nums text-right">
                      {money(r.priceAtRec)}
                    </span>
                    <span
                      className={`font-mono tabular-nums text-right text-xs w-[4rem] ${
                        r.pctMove == null
                          ? "text-[var(--muted-foreground)]"
                          : r.pctMove > 0
                            ? "text-[var(--buy)]"
                            : "text-[var(--sell)]"
                      }`}
                    >
                      {r.pctMove != null ? pctRawSigned(r.pctMove) : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </DrillSection>

        <DrillSection label="Deeper lookups">
          <div className="flex flex-wrap gap-3 text-sm">
            <DrillFooterLink href={`/app?view=research&ticker=${ticker}`}>
              Run new research
            </DrillFooterLink>
            <DrillFooterLink href={`/app/history?filter=${ticker}`}>
              Full recommendation history
            </DrillFooterLink>
          </div>
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            The row above is your cumulative exposure. The warehouse detail
            (valuation, technicals, fundamentals) is in the ticker panel —
            click the ticker symbol anywhere on the dashboard to open it.
          </p>
        </DrillSection>

        <p className="mt-6 text-[10px] italic text-[var(--muted-foreground)]">
          Past recommendation outcomes are informational only. Not a
          guarantee of future performance. Not investment advice.
        </p>
      </DrillBody>
    </>
  );
}
