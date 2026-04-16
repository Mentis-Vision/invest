"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { HistoryItem } from "@/lib/history";

type OutcomeFilter = "all" | "losses" | "wins";

const REC_STYLE: Record<string, string> = {
  BUY: "bg-[var(--buy)]/10 text-[var(--buy)] border-[var(--buy)]/20",
  SELL: "bg-[var(--sell)]/10 text-[var(--sell)] border-[var(--sell)]/20",
  HOLD: "bg-[var(--hold)]/10 text-[var(--hold)] border-[var(--hold)]/20",
  INSUFFICIENT_DATA: "bg-muted text-muted-foreground",
};

const VERDICT_LABEL: Record<string, string> = {
  followed_win: "✓ Followed — paid off",
  followed_loss: "✗ Followed — lost",
  followed_flat: "Followed — flat",
  ignored_win: "Missed — we were right",
  ignored_bullet: "Dodged — we were wrong",
  ignored_regret: "Missed — should have sold",
  ignored_rally: "Good hold — we were wrong",
  ignored_flat: "Ignored — flat",
  contrary_regret: "Traded contrary — regretted",
  contrary_win: "Traded contrary — paid off",
  hold_confirmed: "HOLD confirmed",
};

type TrackRecord = {
  totals: { total: number; buys: number; sells: number; holds: number };
  outcomes: { evaluated: number; wins: number; losses: number; flats: number; acted: number };
};

const LOSS_VERDICTS = new Set([
  "followed_loss",
  "ignored_regret",
  "contrary_regret",
]);
const WIN_VERDICTS = new Set([
  "followed_win",
  "ignored_win",
  "contrary_win",
]);

function hasVerdictIn(it: HistoryItem, set: Set<string>): boolean {
  return it.outcomes.some((o) => o.verdict !== null && set.has(o.verdict));
}

export default function HistoryClient({
  items,
  trackRecord,
}: {
  items: HistoryItem[];
  trackRecord: TrackRecord;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialOutcomeFilter = ((): OutcomeFilter => {
    const raw = searchParams.get("filter");
    if (raw === "losses" || raw === "wins") return raw;
    return "all";
  })();

  const [filter, setFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>(
    initialOutcomeFilter
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  // Auto-expand the first match on "losses" so the user lands on the detail.
  useEffect(() => {
    if (outcomeFilter === "losses" && items.length > 0 && !expanded) {
      const firstLoss = items.find((it) => hasVerdictIn(it, LOSS_VERDICTS));
      if (firstLoss) setExpanded(firstLoss.id);
    }
    // Don't re-run when `expanded` changes — only on filter/items change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeFilter, items]);

  // Keep URL in sync with the filter state so the view is shareable + bookmarkable.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (outcomeFilter === "all") {
      url.searchParams.delete("filter");
    } else {
      url.searchParams.set("filter", outcomeFilter);
    }
    window.history.replaceState({}, "", url.toString());
    // Router is imported to ensure RSC revalidation contract; we use
    // replaceState for cheap same-page updates.
    void router;
  }, [outcomeFilter, router]);

  const filtered = useMemo(() => {
    let pool = items;
    if (outcomeFilter === "losses") {
      pool = pool.filter((it) => hasVerdictIn(it, LOSS_VERDICTS));
    } else if (outcomeFilter === "wins") {
      pool = pool.filter((it) => hasVerdictIn(it, WIN_VERDICTS));
    }
    if (!filter.trim()) return pool;
    const q = filter.trim().toUpperCase();
    return pool.filter(
      (it) => it.ticker.includes(q) || it.recommendation.includes(q)
    );
  }, [items, filter, outcomeFilter]);

  const hitRate =
    trackRecord.outcomes.evaluated > 0
      ? Math.round((trackRecord.outcomes.wins / trackRecord.outcomes.evaluated) * 100)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Track Record</h2>
        <p className="text-sm text-muted-foreground">
          Every recommendation we&rsquo;ve made for you — the wins, the
          losses, and the flats. We keep a permanent record.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Recommendations" value={String(trackRecord.totals.total)} />
            <Stat
              label="BUY / HOLD / SELL"
              value={`${trackRecord.totals.buys} / ${trackRecord.totals.holds} / ${trackRecord.totals.sells}`}
            />
            <Stat
              label="Evaluated outcomes"
              value={String(trackRecord.outcomes.evaluated)}
            />
            <Stat
              label="Hit rate"
              value={hitRate !== null ? `${hitRate}%` : "—"}
            />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Past recommendation outcomes are informational only. Not a guarantee
            of future performance. Not investment advice.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Filter by ticker…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5 text-xs">
          {(["all", "losses", "wins"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setOutcomeFilter(key)}
              className={`rounded px-3 py-1 transition-colors ${
                outcomeFilter === key
                  ? key === "losses"
                    ? "bg-[var(--sell)]/10 text-[var(--sell)]"
                    : key === "wins"
                    ? "bg-[var(--buy)]/10 text-[var(--buy)]"
                    : "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/40"
              }`}
            >
              {key === "all" ? "All" : key === "losses" ? "Losses only" : "Wins only"}
            </button>
          ))}
        </div>
        {outcomeFilter !== "all" && (
          <button
            type="button"
            onClick={() => setOutcomeFilter("all")}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Clear outcome filter"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {items.length}
        </span>
      </div>

      {outcomeFilter === "losses" && (
        <Card className="border-[var(--sell)]/30 bg-[var(--sell)]/5">
          <CardContent className="py-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">The misses.</span>{" "}
            Every recommendation that went against us at the 7 / 30 / 90 / 365-day
            check. We keep these in front of you on purpose — so the track record
            is honest, not curated.
          </CardContent>
        </Card>
      )}

      {outcomeFilter === "wins" && (
        <Card className="border-[var(--buy)]/30 bg-[var(--buy)]/5">
          <CardContent className="py-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">The wins.</span>{" "}
            Recommendations that played out as called at one or more check
            windows. Past performance does not guarantee future results.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {items.length === 0 ? (
                <>
                  No recommendations yet.{" "}
                  <a href="/app?view=research" className="underline">
                    Run your first research query
                  </a>
                  .
                </>
              ) : outcomeFilter === "losses" ? (
                <>No losses to show — nothing has gone against us yet at any check window.</>
              ) : outcomeFilter === "wins" ? (
                <>No wins to show yet — outcome checks run at 7 / 30 / 90 / 365 days.</>
              ) : (
                <>No matches for &ldquo;{filter}&rdquo;.</>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((it) => (
                <div key={it.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="font-mono font-semibold w-16">{it.ticker}</div>
                    <Badge
                      variant="outline"
                      className={`${REC_STYLE[it.recommendation] ?? ""} text-[11px]`}
                    >
                      {it.recommendation}
                    </Badge>
                    <Badge variant="outline" className="text-[11px]">
                      {it.confidence}
                    </Badge>
                    <div className="flex-1 text-sm text-muted-foreground truncate">
                      {it.summary}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(it.createdAt).toLocaleDateString()}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setExpanded(expanded === it.id ? null : it.id)
                      }
                    >
                      {expanded === it.id ? "Hide" : "Details"}
                    </Button>
                  </div>
                  {expanded === it.id && (
                    <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs">
                      <p className="mb-2">
                        <span className="font-medium">Price at rec:</span> $
                        {it.priceAtRec.toFixed(2)} ·{" "}
                        <span className="font-medium">Consensus:</span> {it.consensus} ·{" "}
                        <span className="font-medium">Data as of:</span>{" "}
                        {new Date(it.dataAsOf).toLocaleString()}
                      </p>
                      <div className="mt-3">
                        <div className="font-medium">Outcomes</div>
                        <div className="mt-1 grid gap-1">
                          {it.outcomes.length === 0 ? (
                            <div className="text-muted-foreground">
                              (no outcome windows scheduled — INSUFFICIENT_DATA
                              rec)
                            </div>
                          ) : (
                            it.outcomes.map((o, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className="w-10 font-mono">{o.window}</span>
                                {o.status === "pending" ? (
                                  <span className="text-muted-foreground">
                                    Pending evaluation
                                  </span>
                                ) : (
                                  <>
                                    <span>
                                      {o.priceAtCheck !== null
                                        ? `$${Number(o.priceAtCheck).toFixed(2)}`
                                        : "—"}
                                    </span>
                                    {o.percentMove !== null && (
                                      <span
                                        className={
                                          Number(o.percentMove) > 0
                                            ? "text-[var(--buy)]"
                                            : Number(o.percentMove) < 0
                                            ? "text-[var(--sell)]"
                                            : "text-muted-foreground"
                                        }
                                      >
                                        ({Number(o.percentMove) >= 0 ? "+" : ""}
                                        {Number(o.percentMove).toFixed(1)}%)
                                      </span>
                                    )}
                                    <span className="text-muted-foreground">
                                      —{" "}
                                      {o.verdict
                                        ? VERDICT_LABEL[o.verdict] ?? o.verdict
                                        : "—"}
                                    </span>
                                  </>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
