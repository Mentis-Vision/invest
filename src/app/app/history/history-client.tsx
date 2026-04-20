"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  X,
  CheckCircle2,
  MinusCircle,
  CircleSlash,
  AlertOctagon,
  Loader2,
  StickyNote,
  Download,
  Target,
  Flame,
  TrendingUp,
} from "lucide-react";
import type {
  HistoryItem,
  UserRecAction,
  PatternInsight,
  ActionOutcomeMatrix,
  ReflectionItem,
} from "@/lib/history";
import Link from "next/link";
import { CounterfactualChart } from "@/components/journal/counterfactual-chart";

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

/**
 * Four user-recorded-action options.
 *
 * Distinct from the auto-computed outcomes (which score the call by
 * price movement). This is "did YOU act, and how?" — the thing that
 * turns a track record from a scoreboard into a journal.
 */
const ACTION_OPTIONS: Array<{
  value: UserRecAction;
  label: string;
  short: string;
  icon: typeof CheckCircle2;
  tone: string;
  chip: string;
}> = [
  {
    value: "took",
    label: "Took it",
    short: "Took it",
    icon: CheckCircle2,
    tone: "text-[var(--buy)] border-[var(--buy)]/40 hover:bg-[var(--buy)]/10",
    chip: "bg-[var(--buy)]/10 text-[var(--buy)] border-[var(--buy)]/25",
  },
  {
    value: "partial",
    label: "Took some",
    short: "Partial",
    icon: MinusCircle,
    tone: "text-foreground border-border hover:bg-secondary",
    chip: "bg-secondary text-foreground border-border",
  },
  {
    value: "ignored",
    label: "Didn't act",
    short: "Skipped",
    icon: CircleSlash,
    tone: "text-muted-foreground border-border hover:bg-secondary/60",
    chip: "bg-muted/40 text-muted-foreground border-border",
  },
  {
    value: "opposed",
    label: "Did the opposite",
    short: "Opposed",
    icon: AlertOctagon,
    tone:
      "text-[var(--sell)] border-[var(--sell)]/40 hover:bg-[var(--sell)]/10",
    chip: "bg-[var(--sell)]/10 text-[var(--sell)] border-[var(--sell)]/25",
  },
];

const ACTION_BY_VALUE = new Map(ACTION_OPTIONS.map((o) => [o.value, o]));

type TrackRecord = {
  totals: { total: number; buys: number; sells: number; holds: number };
  outcomes: {
    evaluated: number;
    wins: number;
    losses: number;
    flats: number;
    acted: number;
  };
  actions: {
    acted_total: number;
    acted_took: number;
    acted_partial: number;
    acted_ignored: number;
    acted_opposed: number;
    acted_took_wins: number;
    acted_took_evaluated: number;
  };
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
  items: initialItems,
  trackRecord,
  patterns,
  matrix,
  reflections,
}: {
  items: HistoryItem[];
  trackRecord: TrackRecord;
  patterns: PatternInsight;
  matrix: ActionOutcomeMatrix;
  reflections: ReflectionItem[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialOutcomeFilter = ((): OutcomeFilter => {
    const raw = searchParams.get("filter");
    if (raw === "losses" || raw === "wins") return raw;
    return "all";
  })();

  const [items, setItems] = useState<HistoryItem[]>(initialItems);
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
      ? Math.round(
          (trackRecord.outcomes.wins / trackRecord.outcomes.evaluated) * 100
        )
      : null;

  const followThroughRate =
    trackRecord.actions.acted_took_evaluated > 0
      ? Math.round(
          (trackRecord.actions.acted_took_wins /
            trackRecord.actions.acted_took_evaluated) *
            100
        )
      : null;

  // Optimistic in-place update when a row's action is saved.
  const handleActionSaved = useCallback(
    (id: string, action: UserRecAction | null, note: string | null) => {
      setItems((cur) =>
        cur.map((it) =>
          it.id === id
            ? {
                ...it,
                userAction: action,
                userNote: note,
                userActionAt: action ? new Date().toISOString() : null,
              }
            : it
        )
      );
    },
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Journal</h2>
          <p className="text-sm text-muted-foreground">
            Every recommendation you&apos;ve acted on — with your own note,
            the outcome, and how your decision compares to alternatives.
          </p>
        </div>
        {/* Full-CSV download — just the user's own data, no PII beyond
            what they already see. Opens/saves in the browser via the
            Content-Disposition: attachment response. */}
        <a
          href="/api/history/export"
          download
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground/80 transition-colors hover:border-primary/50 hover:text-foreground"
          title="Download your journal as CSV"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </a>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat
              label="Recommendations"
              value={String(trackRecord.totals.total)}
            />
            <Stat
              label="BUY / HOLD / SELL"
              value={`${trackRecord.totals.buys} / ${trackRecord.totals.holds} / ${trackRecord.totals.sells}`}
            />
            <Stat
              label="Hit rate"
              value={hitRate !== null ? `${hitRate}%` : "—"}
              hint={`${trackRecord.outcomes.wins} of ${trackRecord.outcomes.evaluated} evaluated`}
            />
            <Stat
              label="You acted on"
              value={String(trackRecord.actions.acted_total)}
              hint={
                trackRecord.actions.acted_total > 0
                  ? `${trackRecord.actions.acted_took} took · ${trackRecord.actions.acted_ignored} skipped`
                  : "Mark your actions below"
              }
            />
            <Stat
              label="Your follow-through"
              value={
                followThroughRate !== null ? `${followThroughRate}%` : "—"
              }
              hint={
                followThroughRate !== null
                  ? `Wins among calls you took`
                  : "Evaluate a few calls first"
              }
            />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Past recommendation outcomes are informational only. Not a
            guarantee of future performance. Not investment advice.
          </p>
        </CardContent>
      </Card>

      {/* Pattern insights — the behavioral lens on top of the journal. */}
      <PatternCard patterns={patterns} />

      {/* Action × outcome crosstab — the "did acting help?" card. */}
      <ActionOutcomeCard matrix={matrix} />

      {/* Reflection prompts — show 30-day-old notes against what
          actually happened. The feedback loop users never naturally
          run on themselves. */}
      <ReflectionCard reflections={reflections} />

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
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-card p-0.5 text-xs">
          {(
            ["all", "wins", "losses"] as const
          ).map((key) => (
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
              {key === "all" ? "All" : key === "losses" ? "Losses" : "Wins"}
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
                  Nothing to journal yet. When you act on a recommendation —
                  from the Dashboard or Research — it shows up here.{" "}
                  <Link href="/app" className="underline">Start at the Dashboard →</Link>
                </>
              ) : outcomeFilter === "losses" ? (
                <>No losses yet — nothing has gone against you at any check window.</>
              ) : outcomeFilter === "wins" ? (
                <>No wins yet — outcome checks run at 7 / 30 / 90 / 365 days.</>
              ) : (
                <>No matches for &ldquo;{filter}&rdquo;.</>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((it) => {
                const actionMeta = it.userAction
                  ? ACTION_BY_VALUE.get(it.userAction)
                  : null;
                const isExpanded = expanded === it.id;
                return (
                  <div key={it.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-16 font-mono font-semibold">
                        {it.ticker}
                      </div>
                      <Badge
                        variant="outline"
                        className={`${REC_STYLE[it.recommendation] ?? ""} text-[11px]`}
                      >
                        {it.recommendation}
                      </Badge>
                      <Badge variant="outline" className="text-[11px]">
                        {it.confidence}
                      </Badge>
                      {actionMeta && (
                        <Badge
                          variant="outline"
                          className={`text-[11px] ${actionMeta.chip}`}
                        >
                          <actionMeta.icon className="mr-1 h-3 w-3" />
                          {actionMeta.short}
                        </Badge>
                      )}
                      {it.userNote && !actionMeta && (
                        <Badge
                          variant="outline"
                          className="text-[11px] bg-secondary text-muted-foreground border-border"
                        >
                          <StickyNote className="mr-1 h-3 w-3" />
                          Note
                        </Badge>
                      )}
                      <div className="flex-1 truncate text-sm text-muted-foreground">
                        {it.summary}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(it.createdAt).toLocaleDateString()}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setExpanded(isExpanded ? null : it.id)
                        }
                      >
                        {isExpanded ? "Hide" : "Details"}
                      </Button>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 space-y-4 rounded-md border bg-muted/30 p-3 text-xs">
                        <p>
                          <span className="font-medium">Price at rec:</span> $
                          {it.priceAtRec.toFixed(2)} ·{" "}
                          <span className="font-medium">Consensus:</span>{" "}
                          {it.consensus} ·{" "}
                          <span className="font-medium">Data as of:</span>{" "}
                          {new Date(it.dataAsOf).toLocaleString()}
                        </p>

                        {/* ── Action tracker ────────────────────────── */}
                        <ActionTracker
                          recommendationId={it.id}
                          ticker={it.ticker}
                          currentAction={it.userAction}
                          currentNote={it.userNote}
                          actionAt={it.userActionAt}
                          onSaved={handleActionSaved}
                        />

                        {/* ── Outcomes ──────────────────────────────── */}
                        <div>
                          <div className="mb-1 font-medium">Outcomes</div>
                          <div className="grid gap-1">
                            {it.outcomes.length === 0 ? (
                              <div className="text-muted-foreground">
                                (no outcome windows scheduled —
                                INSUFFICIENT_DATA rec)
                              </div>
                            ) : (
                              it.outcomes.map((o, i) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-2"
                                >
                                  <span className="w-10 font-mono">
                                    {o.window}
                                  </span>
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
                                          (
                                          {Number(o.percentMove) >= 0 ? "+" : ""}
                                          {Number(o.percentMove).toFixed(1)}%)
                                        </span>
                                      )}
                                      <span className="text-muted-foreground">
                                        —{" "}
                                        {o.verdict
                                          ? VERDICT_LABEL[o.verdict] ??
                                            o.verdict
                                          : "—"}
                                      </span>
                                    </>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <CounterfactualChart recId={it.id} />

                        <div className="flex justify-end">
                          <Link
                            href={`/app/r/${it.id}`}
                            className="text-[11px] text-primary underline-offset-4 hover:underline"
                          >
                            Open full recommendation →
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Behavioral pattern card.
 *
 * Shows 90-day rolling insights: are you missing calls you shouldn't
 * miss? Are you taking calls you shouldn't take? How aggressive is
 * your BUY follow-through? Renders nothing when there isn't enough
 * evaluated data yet — an insight card that says "not enough data"
 * three times is worse than not showing one.
 */
function PatternCard({ patterns }: { patterns: PatternInsight }) {
  const { missedOpportunities, overReached, buyFollowThrough, daysWindow } =
    patterns;

  // Decide which insights to render. Each one has a minimum threshold:
  //   - missed: need ≥3 ignored total AND ≥1 actual miss
  //   - overReached: need ≥3 taken AND ≥1 actual over-reach
  //   - buyFollowThrough: need ≥3 total BUYs
  const showMissed =
    missedOpportunities.totalIgnored >= 3 && missedOpportunities.count >= 1;
  const showOverReached =
    overReached.totalTaken >= 3 && overReached.count >= 1;
  const showBuyFT = buyFollowThrough.total >= 3;

  const anyToShow = showMissed || showOverReached || showBuyFT;

  if (!anyToShow) {
    // Keep the card visible with a friendly empty-state — the user
    // should see where pattern analysis will appear even before they
    // have enough history. Prevents "the card is broken" confusion
    // later when a query unexpectedly returns.
    return (
      <Card className="border-dashed border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-muted-foreground" />
            Behavioral patterns
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-muted-foreground">
            Once you&rsquo;ve marked actions on a handful of recommendations
            and the 7/30-day outcome checks have evaluated them, we&rsquo;ll
            surface patterns here — whether you&rsquo;re skipping the right
            calls, taking the right ones, and how aggressive your
            follow-through is on BUYs. Come back after a few evaluated
            calls.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/4 to-transparent">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" />
            Behavioral patterns
          </CardTitle>
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Last {daysWindow} days
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          How your actions line up with the outcomes — your journal&rsquo;s
          second order.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {showMissed && (
            <PatternTile
              icon={Flame}
              iconTone="text-[var(--hold)]"
              headline={
                missedOpportunities.pctOfIgnored !== null
                  ? `${missedOpportunities.count} of ${missedOpportunities.totalIgnored} skipped calls won (${missedOpportunities.pctOfIgnored}%)`
                  : `${missedOpportunities.count} skipped calls won`
              }
              body={
                missedOpportunities.count >= 3
                  ? "You may be filtering too tight — the model caught things you missed."
                  : "A few skipped calls paid off — watch for the pattern."
              }
              examples={missedOpportunities.examples}
              exampleLabel="Examples you skipped:"
            />
          )}

          {showOverReached && (
            <PatternTile
              icon={AlertOctagon}
              iconTone="text-[var(--sell)]"
              headline={
                overReached.pctOfTaken !== null
                  ? `${overReached.count} of ${overReached.totalTaken} taken calls lost (${overReached.pctOfTaken}%)`
                  : `${overReached.count} taken calls lost`
              }
              body={
                overReached.pctOfTaken !== null && overReached.pctOfTaken > 40
                  ? "Over-eager follow-through — consider narrowing to high-confidence calls."
                  : "A few of your acted-on calls didn't pay off — review the common thread."
              }
              examples={overReached.examples}
              exampleLabel="Examples you acted on:"
            />
          )}

          {showBuyFT && (
            <PatternTile
              icon={TrendingUp}
              iconTone="text-[var(--buy)]"
              headline={
                buyFollowThrough.pctTook !== null
                  ? `You acted on ${buyFollowThrough.took} of ${buyFollowThrough.total} BUYs (${buyFollowThrough.pctTook}%)`
                  : `${buyFollowThrough.took} of ${buyFollowThrough.total} BUYs acted on`
              }
              body={
                buyFollowThrough.pctTook !== null && buyFollowThrough.pctTook < 30
                  ? "You're skipping most BUY calls. If your hit rate is high, consider loosening your filter."
                  : buyFollowThrough.pctTook !== null && buyFollowThrough.pctTook > 70
                    ? "High follow-through on BUYs — make sure your confidence threshold matches."
                    : "A balanced BUY follow-through rate."
              }
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PatternTile({
  icon: Icon,
  iconTone,
  headline,
  body,
  examples,
  exampleLabel,
}: {
  icon: typeof Target;
  iconTone: string;
  headline: string;
  body: string;
  examples?: Array<{
    ticker: string;
    recommendation: string;
    createdAt: string;
  }>;
  exampleLabel?: string;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-card px-3 py-3">
      <div className={`flex items-center gap-2 ${iconTone}`}>
        <Icon className="h-4 w-4" />
        <span className="text-[13px] font-semibold text-foreground">
          {headline}
        </span>
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      {examples && examples.length > 0 && (
        <div className="pt-1 text-[11px] text-muted-foreground">
          <div className="mb-0.5 font-medium text-foreground/70">
            {exampleLabel}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {examples.map((e) => (
              <span
                key={`${e.ticker}-${e.createdAt}`}
                className="inline-flex items-center gap-1 rounded border border-border bg-secondary/60 px-1.5 py-0.5 font-mono text-[10px]"
              >
                {e.ticker}
                <span className="text-muted-foreground">· {e.recommendation}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Action × Outcome 2×2 — visual crosstab that answers the big
 * journal question: "Did acting help?"
 *
 * Four tiles:
 *   Acted + Won  — your wins from follow-through
 *   Acted + Lost — your losses from follow-through
 *   Skipped + Won — missed opportunities (worst quadrant if big)
 *   Skipped + Lost — bullets dodged (best quadrant if big)
 *
 * Hides when no evaluated outcomes exist yet (same threshold idea as
 * PatternCard — don't show a grid of zeros).
 */
function ActionOutcomeCard({ matrix }: { matrix: ActionOutcomeMatrix }) {
  const hasData =
    matrix.tookWins +
      matrix.tookLosses +
      matrix.ignoredWins +
      matrix.ignoredLosses >
    0;

  if (!hasData) return null;

  const followThroughRate =
    matrix.tookWins + matrix.tookLosses > 0
      ? Math.round(
          (matrix.tookWins / (matrix.tookWins + matrix.tookLosses)) * 100
        )
      : null;
  const skipAccuracy =
    matrix.ignoredWins + matrix.ignoredLosses > 0
      ? Math.round(
          (matrix.ignoredLosses /
            (matrix.ignoredWins + matrix.ignoredLosses)) *
            100
        )
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Did acting help?</CardTitle>
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Last {matrix.daysWindow} days
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Your actions cross-tabbed against the 7 / 30-day outcome
          check. Bigger numbers in the green quadrants mean your
          instinct is paying off.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          <MatrixTile
            title="You acted + won"
            count={matrix.tookWins}
            pending={matrix.tookPending}
            tone="good"
            rate={followThroughRate}
            rateLabel="follow-through hit rate"
          />
          <MatrixTile
            title="You acted + lost"
            count={matrix.tookLosses}
            tone="bad"
          />
          <MatrixTile
            title="You skipped, it won"
            subtitle="Missed opportunities"
            count={matrix.ignoredWins}
            pending={matrix.ignoredPending}
            tone="bad"
          />
          <MatrixTile
            title="You skipped, it lost"
            subtitle="Bullets dodged"
            count={matrix.ignoredLosses}
            tone="good"
            rate={skipAccuracy}
            rateLabel="skip accuracy"
          />
        </div>

        {matrix.unmarkedTotal > 0 && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">
              {matrix.unmarkedTotal}
            </span>{" "}
            recommendations in this window don&rsquo;t have an action
            marked. A filled-in journal sharpens these numbers.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MatrixTile({
  title,
  subtitle,
  count,
  pending,
  tone,
  rate,
  rateLabel,
}: {
  title: string;
  subtitle?: string;
  count: number;
  pending?: number;
  tone: "good" | "bad";
  rate?: number | null;
  rateLabel?: string;
}) {
  const bg =
    tone === "good"
      ? "border-[var(--buy)]/25 bg-[var(--buy)]/5"
      : "border-[var(--sell)]/25 bg-[var(--sell)]/5";
  const accent =
    tone === "good" ? "text-[var(--buy)]" : "text-[var(--sell)]";

  return (
    <div className={`rounded-md border ${bg} p-3`}>
      <div className="text-[11px] font-medium text-foreground/80">{title}</div>
      {subtitle && (
        <div className="text-[10px] text-muted-foreground">{subtitle}</div>
      )}
      <div className={`mt-1 text-[22px] font-semibold tabular-nums ${accent}`}>
        {count}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
        {pending !== undefined && pending > 0 && (
          <span>+{pending} still pending</span>
        )}
        {rate !== null && rate !== undefined && rateLabel && (
          <span>
            · {rate}% {rateLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Reflection card — 30-day-old notes alongside the outcome that
 * followed. "Here's what you said then, here's what happened since."
 *
 * Renders nothing when there are no eligible notes (window 21-45 days
 * + note >10 chars). Each item shows the ticker, the user's original
 * note, the price at rec vs now (or the outcome verdict if evaluated),
 * and a link back to the recommendation detail.
 */
function ReflectionCard({ reflections }: { reflections: ReflectionItem[] }) {
  if (reflections.length === 0) return null;

  return (
    <Card className="border-[var(--hold)]/30 bg-[var(--hold)]/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <StickyNote className="h-4 w-4 text-[var(--hold)]" />
          Your notes, revisited
        </CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Notes you left about 30 days ago — and what happened since.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {reflections.map((r) => {
            const actionMeta = r.userAction
              ? ACTION_BY_VALUE.get(r.userAction)
              : null;
            const recTone =
              REC_STYLE[r.recommendation] ?? "bg-muted text-muted-foreground";
            const moveColor =
              r.percentMove !== null && r.percentMove > 0
                ? "text-[var(--buy)]"
                : r.percentMove !== null && r.percentMove < 0
                  ? "text-[var(--sell)]"
                  : "text-muted-foreground";

            return (
              <div
                key={r.id}
                className="rounded-md border border-border bg-background px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{r.ticker}</span>
                  <Badge
                    variant="outline"
                    className={`${recTone} text-[11px]`}
                  >
                    {r.recommendation}
                  </Badge>
                  {actionMeta && (
                    <Badge
                      variant="outline"
                      className={`text-[11px] ${actionMeta.chip}`}
                    >
                      <actionMeta.icon className="mr-1 h-3 w-3" />
                      {actionMeta.short}
                    </Badge>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {r.daysAgo} days ago
                  </span>
                </div>

                <blockquote className="mt-2 border-l-2 border-[var(--hold)] pl-3 text-[13px] italic leading-relaxed text-foreground/85">
                  &ldquo;{r.userNote}&rdquo;
                </blockquote>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                  {r.verdict ? (
                    <span className="text-foreground/80">
                      Since then:{" "}
                      <span className="font-medium">
                        {VERDICT_LABEL[r.verdict] ?? r.verdict}
                      </span>
                      {r.percentMove !== null && (
                        <span className={`ml-1 font-mono ${moveColor}`}>
                          ({r.percentMove >= 0 ? "+" : ""}
                          {r.percentMove.toFixed(1)}% @ {r.outcomeWindow})
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Outcome still pending.
                    </span>
                  )}
                  <Link
                    href={`/app/r/${r.id}`}
                    className="ml-auto text-primary underline-offset-4 hover:underline"
                  >
                    Open →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

/**
 * Action tracker — the inline widget on an expanded recommendation.
 *
 * Four action buttons + an optional free-text note (max 500 chars).
 * Saves to /api/history/action on every button click (no submit).
 * Optimistic update via `onSaved` so the row chip flips instantly.
 */
function ActionTracker({
  recommendationId,
  ticker,
  currentAction,
  currentNote,
  actionAt,
  onSaved,
}: {
  recommendationId: string;
  ticker: string;
  currentAction: UserRecAction | null;
  currentNote: string | null;
  actionAt: string | null;
  onSaved: (
    id: string,
    action: UserRecAction | null,
    note: string | null
  ) => void;
}) {
  const [noteDraft, setNoteDraft] = useState(currentNote ?? "");
  const [saving, setSaving] = useState<UserRecAction | "note" | "clear" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  // Re-sync draft when the upstream note changes (row collapse/expand).
  useEffect(() => {
    setNoteDraft(currentNote ?? "");
  }, [currentNote]);

  const dirtyNote = noteDraft.trim() !== (currentNote ?? "").trim();

  async function post(
    action: UserRecAction | null,
    note: string | null,
    stateKey: UserRecAction | "note" | "clear"
  ) {
    setSaving(stateKey);
    setError(null);
    try {
      const res = await fetch("/api/history/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationId, action, note }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save");
        return;
      }
      const data = (await res.json()) as {
        action: UserRecAction | null;
        note: string | null;
      };
      onSaved(recommendationId, data.action, data.note);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-medium text-foreground">
          What did you do on {ticker}?
        </div>
        {actionAt && (
          <div className="text-[10px] text-muted-foreground">
            Last marked{" "}
            {new Date(actionAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ACTION_OPTIONS.map((opt) => {
          const selected = currentAction === opt.value;
          const isSaving = saving === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={saving !== null}
              onClick={() =>
                post(
                  selected ? null : opt.value,
                  noteDraft.trim() || null,
                  opt.value
                )
              }
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-60 ${
                selected
                  ? `${opt.chip} ring-1 ring-current/20`
                  : `bg-card ${opt.tone}`
              }`}
              aria-pressed={selected}
            >
              {isSaving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <opt.icon className="h-3 w-3" />
              )}
              {opt.label}
            </button>
          );
        })}
        {currentAction !== null && (
          <button
            type="button"
            disabled={saving !== null}
            onClick={() => post(null, noteDraft.trim() || null, "clear")}
            className="ml-1 inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {saving === "clear" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3 w-3" />
            )}
            Clear
          </button>
        )}
      </div>

      <div className="mt-3">
        <label
          htmlFor={`note-${recommendationId}`}
          className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground"
        >
          Your note — private, for your own journal
        </label>
        <textarea
          id={`note-${recommendationId}`}
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value.slice(0, 500))}
          rows={2}
          placeholder={
            currentAction === "opposed"
              ? "Why you went the other way…"
              : currentAction === "ignored"
              ? "Why you held off…"
              : "Why — your thesis, or what changed…"
          }
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-[12px] leading-relaxed outline-none focus:border-primary/40"
          maxLength={500}
        />
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{noteDraft.length} / 500</span>
          {dirtyNote && (
            <button
              type="button"
              disabled={saving !== null}
              onClick={() =>
                post(currentAction, noteDraft.trim() || null, "note")
              }
              className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background hover:bg-foreground/85 disabled:opacity-60"
            >
              {saving === "note" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              Save note
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-2 text-[11px] text-[var(--destructive)]">
          {error}
        </div>
      )}
    </div>
  );
}
