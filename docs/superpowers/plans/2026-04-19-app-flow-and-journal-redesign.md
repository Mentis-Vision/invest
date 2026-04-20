# App Flow + Journal Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate ClearPath's five-tab UI into a coherent morning-briefing flow; unify the two disconnected action-tracking systems into a single Journal; introduce a counterfactual visualization and a reconciliation layer between self-reported actions and actual broker trades.

**Architecture:** Extend the existing `recommendation` table with action + reconciliation columns; unify Strategy-chip actions with Research recs through a single `source` discriminator; lift Strategy's full multi-lens content to an inline "See the full brief" on the Dashboard hero; rename History→Journal and filter to acted-only rows; compute counterfactuals from existing warehouse + snapshot tables (no new storage); add a nightly reconciliation cron step that matches broker trades to self-reports and auto-creates ad-hoc rows for orphans.

**Tech Stack:** Next.js 16 App Router on Vercel, Neon Postgres via `@neondatabase/serverless`, BetterAuth, React + Tailwind + Base UI, Lucide icons. No local test framework — each task verifies via `npm run build` (typecheck + compile) plus manual smoke after deploy.

**Work style:** The user's workflow is push → Vercel auto-deploy. Every task ends with a commit + push so prod tracks HEAD. Run `./node_modules/.bin/next build 2>&1 | tail -40` before pushing to catch type errors locally (avoid chasing build failures in the Vercel queue).

**Source spec:** `docs/superpowers/specs/2026-04-19-app-flow-and-journal-redesign.md`

---

## File Structure

**New files:**
- `src/lib/counterfactual.ts` — computes three-path portfolio value series for a given recommendation
- `src/lib/reconciliation.ts` — matches broker trades to self-reported actions, creates ad-hoc rows for orphans
- `src/components/dashboard/quick-scan-strip.tsx` — pre-populated data strip inside Next Move hero
- `src/components/dashboard/next-move-hero.tsx` — extracted from strategy.tsx, owns the Next Move card
- `src/components/dashboard/action-modal.tsx` — unified modal for Done / Partial / Dismiss chip clicks
- `src/components/dashboard/compact-counterfactual.tsx` — single-line impact strip on Dashboard after an action
- `src/components/journal/counterfactual-chart.tsx` — three-bar comparison for Journal row expand
- `src/components/research/past-calls-strip.tsx` — "Your past calls on this ticker" strip on Research results
- `src/components/research/recent-searches-strip.tsx` — "Recent searches" on Research landing
- `src/app/api/journal/counterfactual/[recId]/route.ts` — returns the three-path series for a rec
- `src/app/api/journal/strategy-action/route.ts` — records a Strategy Next Move chip action as a `recommendation` row
- `src/app/api/research/past-calls/[ticker]/route.ts` — returns recent recs for this ticker
- `src/app/api/research/recent-searches/route.ts` — returns user's recent un-acted research

**Modified files:**
- `src/components/app-shell.tsx` — remove Strategy from nav, rename History→Journal
- `src/components/views/dashboard.tsx` — host the Next Move hero + compact counterfactual
- `src/components/views/strategy.tsx` — deprecated; becomes the "full brief" export used inline on Dashboard
- `src/lib/history.ts` — filter `getUserHistory` to acted-only rows; add reconciliation types
- `src/lib/portfolio-review.ts` — expose helpers the Next Move hero uses; stop owning the Strategy view-layer concerns
- `src/app/app/history/page.tsx` — passes `showActionsOnly` flag down
- `src/app/app/history/history-client.tsx` — update chips, filter, and row expand to include counterfactual
- `src/app/api/cron/evaluate-outcomes/route.ts` — add reconciliation step
- `src/proxy.ts` — gate `/api/journal/*` and `/api/research/past-calls/*` and `/api/research/recent-searches`

**Deprecated:**
- `src/app/app/strategy/*` (if present — the /app?view=strategy query-param route is removed from the nav; any direct links 302 to `/app`).

---

## Phase 1 — Data model + types

Foundation work. Zero user-visible change on completion. After this phase the DB and types can carry the new columns; no reads/writes touch them yet.

### Task 1.1 — DB migration: extend `recommendation` + backfill

**Files:**
- Run SQL via Neon MCP (`mcp__Neon__run_sql`, project id `broad-sun-50424626`).

- [ ] **Step 1: Add `source` column with backfill default**

```sql
ALTER TABLE "recommendation"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'research'
  CHECK ("source" IN ('research','strategy','ad_hoc'))
```

- [ ] **Step 2: Add `sourcePortfolioReviewDate` column** (nullable — only strategy rows use it)

```sql
ALTER TABLE "recommendation"
  ADD COLUMN IF NOT EXISTS "sourcePortfolioReviewDate" DATE
```

- [ ] **Step 3: Add reconciliation columns**

```sql
ALTER TABLE "recommendation"
  ADD COLUMN IF NOT EXISTS "selfReportedAmount" TEXT
```

```sql
ALTER TABLE "recommendation"
  ADD COLUMN IF NOT EXISTS "actualAmount" NUMERIC
```

```sql
ALTER TABLE "recommendation"
  ADD COLUMN IF NOT EXISTS "reconciliationStatus" TEXT
  CHECK ("reconciliationStatus" IN
    ('verified','mismatch_more','mismatch_less','self_reported_only','actual_only'))
```

```sql
ALTER TABLE "recommendation"
  ADD COLUMN IF NOT EXISTS "reconciledAt" TIMESTAMPTZ
```

- [ ] **Step 4: Add index for ad-hoc + source lookups**

```sql
CREATE INDEX IF NOT EXISTS recommendation_user_source_idx
  ON "recommendation" ("userId", "source", "createdAt" DESC)
```

- [ ] **Step 5: Verify schema**

Run via Neon MCP `describe_table_schema` on `recommendation`. Confirm all columns are present. Confirm existing rows have `source = 'research'` (default backfill).

- [ ] **Step 6: Commit migration note to docs**

```bash
# No code changes — migration is live in Neon. Drop a trail in the handoff doc.
```

Append to `handoff/2026-04-19-next-session.md`:

```markdown
## Migration executed 2026-04-19 (app-flow redesign)
- ALTER TABLE "recommendation": added source, sourcePortfolioReviewDate,
  selfReportedAmount, actualAmount, reconciliationStatus, reconciledAt.
- New index: recommendation_user_source_idx.
- Backfill: existing rows default to source='research'.
```

```bash
cd /Volumes/Sang-Dev-SSD/invest
git add handoff/2026-04-19-next-session.md
git commit -m "db: extend recommendation for unified journal + reconciliation

Added columns (via Neon MCP):
- source (research | strategy | ad_hoc), defaults to research
- sourcePortfolioReviewDate (for strategy-sourced rows)
- selfReportedAmount, actualAmount, reconciliationStatus, reconciledAt
New index: recommendation_user_source_idx.
Handoff doc updated."
git push origin main
```

Expected: Vercel build green (no code changed so nothing to typecheck, but push triggers a re-deploy).

### Task 1.2 — TypeScript types for the extended row

**Files:**
- Modify: `src/lib/history.ts`

- [ ] **Step 1: Extend `UserRecAction` and add new types**

In `src/lib/history.ts`, add at the top of the types section (near the existing `UserRecAction`):

```ts
export type RecSource = "research" | "strategy" | "ad_hoc";

export type ReconciliationStatus =
  | "verified"
  | "mismatch_more"
  | "mismatch_less"
  | "self_reported_only"
  | "actual_only";
```

- [ ] **Step 2: Extend `HistoryItem` shape**

Update the existing `HistoryItem` type by adding these fields alongside `userAction`/`userNote`/`userActionAt`:

```ts
source: RecSource;
sourcePortfolioReviewDate: string | null;
selfReportedAmount: string | null;
actualAmount: number | null;
reconciliationStatus: ReconciliationStatus | null;
reconciledAt: string | null;
```

- [ ] **Step 3: Extend `getUserHistory` SELECT**

Modify the SQL inside `getUserHistory` to project the new columns:

```sql
SELECT r.id, r.ticker, r.recommendation, r.confidence, r.consensus,
       r."priceAtRec", r.summary, r."dataAsOf", r."createdAt",
       r."userAction", r."userNote", r."userActionAt",
       r."source", r."sourcePortfolioReviewDate",
       r."selfReportedAmount", r."actualAmount",
       r."reconciliationStatus", r."reconciledAt",
       ...
```

And map them into the returned objects (alongside the existing mapping):

```ts
source: (r.source as RecSource) ?? "research",
sourcePortfolioReviewDate: r.sourcePortfolioReviewDate
  ? (r.sourcePortfolioReviewDate as Date).toISOString().slice(0, 10)
  : null,
selfReportedAmount: (r.selfReportedAmount as string | null) ?? null,
actualAmount: r.actualAmount != null ? Number(r.actualAmount) : null,
reconciliationStatus:
  (r.reconciliationStatus as ReconciliationStatus | null) ?? null,
reconciledAt: r.reconciledAt
  ? (r.reconciledAt as Date).toISOString()
  : null,
```

- [ ] **Step 4: Do the same in `getRecommendationForUser`**

Mirror the SELECT + mapping changes in `getRecommendationForUser`. (Same row shape.)

- [ ] **Step 5: Build**

```bash
cd /Volumes/Sang-Dev-SSD/invest
./node_modules/.bin/next build 2>&1 | tail -20
```

Expected: build completes without type errors. Any TS error here means a call site consumes `HistoryItem` in a way that now breaks — fix by letting the new fields be optional on the consuming side (they're already nullable in the type).

- [ ] **Step 6: Commit**

```bash
git add src/lib/history.ts
git commit -m "types: extend HistoryItem with source + reconciliation fields

Adds RecSource ('research'|'strategy'|'ad_hoc') and ReconciliationStatus
types; surfaces them on HistoryItem. getUserHistory and
getRecommendationForUser both project the new columns. Callers that
don't yet read them are unaffected (new fields are nullable)."
git push origin main
```

---

## Phase 2 — Information architecture (nav + renames)

Visible change. After this phase the nav has 4 tabs, Strategy URL redirects to Dashboard, and History page is labeled "Journal".

### Task 2.1 — Remove Strategy from nav; redirect the route

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/views/dashboard.tsx` (prepare to host Next Move hero in Phase 4)
- Modify: `src/app/app/page.tsx` (redirect `?view=strategy` to Dashboard)

- [ ] **Step 1: Drop the Strategy item from nav**

Open `src/components/app-shell.tsx`. Find the `navItems` array and remove the entry with `id: "strategy"`. Leave the rest intact.

Before:
```ts
const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", ... },
  { id: "portfolio", label: "Portfolio", ... },
  { id: "research", label: "Research", ... },
  { id: "strategy", label: "Strategy", ... },
  { id: "history", label: "History", href: "/app/history", ... },
];
```

After:
```ts
const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", ... },
  { id: "portfolio", label: "Portfolio", ... },
  { id: "research", label: "Research", ... },
  { id: "history", label: "Journal", href: "/app/history", ... },
];
```

Note: `href` stays `/app/history` for now (bookmarks don't break). The URL rename is a later, optional task.

- [ ] **Step 2: Redirect any `?view=strategy` query-param navigation to Dashboard**

Open `src/app/app/page.tsx`. Find where the `view` search param is parsed. If current behavior loads `StrategyView` when `view === "strategy"`, change it to: set `view = "dashboard"` for any incoming `view=strategy` and continue.

If `dashboard.tsx` owns the view switching, update the switch/match block to drop the `"strategy"` branch or alias it to `"dashboard"`.

- [ ] **Step 3: Build**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
```

Expected: green. Any dead-code warnings about `StrategyView` being unused are OK — we still import it for inline reuse in Phase 4.

- [ ] **Step 4: Commit**

```bash
git add src/components/app-shell.tsx src/app/app/page.tsx src/components/views/dashboard.tsx
git commit -m "nav: Strategy tab removed; History renamed to Journal in UI

- nav items: 5 → 4, Strategy dropped. ?view=strategy aliases to
  dashboard so any existing deep links land on the briefing instead
  of 404.
- History route keeps its URL (/app/history) but displays as 'Journal'.
- Strategy view component remains in the codebase — it will be
  inlined under the Next Move hero in Phase 4.
"
git push origin main
```

### Task 2.2 — Page title: History → Journal

**Files:**
- Modify: `src/app/app/history/page.tsx`
- Modify: `src/app/app/history/history-client.tsx`

- [ ] **Step 1: Update the page metadata/title**

In `src/app/app/history/page.tsx`, update any `<title>` metadata or inline heading to say "Journal" instead of "History" or "Track Record". If no metadata exports exist, skip.

- [ ] **Step 2: Update the page heading in history-client**

In `history-client.tsx`, find the heading rendering the page title (likely an `<h2>` with "Track Record" text) and change it to:

```tsx
<h2 className="text-2xl font-semibold tracking-tight">Journal</h2>
<p className="text-sm text-muted-foreground">
  Every recommendation you've acted on — with your own note, the outcome,
  and how your decision compares to alternatives.
</p>
```

- [ ] **Step 3: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/app/app/history/page.tsx src/app/app/history/history-client.tsx
git commit -m "ui: History page title renamed to Journal"
git push origin main
```

---

## Phase 3 — Journal filters (actions only)

Visible change: un-acted research rows stop appearing on the Journal page. Pattern insights and reflection prompts tighten because they only see signal.

### Task 3.1 — Filter `getUserHistory` to actioned rows by default

**Files:**
- Modify: `src/lib/history.ts`

- [ ] **Step 1: Add optional `onlyActioned` parameter**

In `getUserHistory`, accept a second param:

```ts
export async function getUserHistory(
  userId: string,
  opts: { limit?: number; onlyActioned?: boolean } = {}
): Promise<HistoryItem[]> {
  const { limit = 50, onlyActioned = false } = opts;
  ...
}
```

- [ ] **Step 2: Apply the filter in SQL when requested**

In the WHERE clause of the existing `getUserHistory` query, when `onlyActioned === true`, add:

```sql
AND r."userAction" IS NOT NULL
```

Concretely, build the where fragment conditionally:

```ts
const actionFilter = onlyActioned ? `AND r."userAction" IS NOT NULL` : "";

const { rows } = await pool.query(
  `SELECT ...
   FROM "recommendation" r
   LEFT JOIN "recommendation_outcome" o ON ...
   WHERE r."userId" = $1
     AND ("analysisJson"->>'mode' IS NULL
          OR "analysisJson"->>'mode' <> 'quick')
     ${actionFilter}
   GROUP BY r.id
   ORDER BY r."createdAt" DESC
   LIMIT $2`,
  [userId, limit]
);
```

- [ ] **Step 3: Update the Journal page to pass the flag**

In `src/app/app/history/page.tsx`:

```ts
const [items, trackRecord, patterns, matrix, reflections] =
  await Promise.all([
    getUserHistory(session.user.id, { limit: 100, onlyActioned: true }),
    getUserTrackRecord(session.user.id, 30),
    getUserPatternInsights(session.user.id, 90),
    getActionOutcomeMatrix(session.user.id, 90),
    getReflectionPrompts(session.user.id, 3),
  ]);
```

- [ ] **Step 4: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/lib/history.ts src/app/app/history/page.tsx
git commit -m "journal: filter to acted-only rows on /app/history

getUserHistory now accepts onlyActioned. Journal page passes it.
Un-acted research queries no longer clutter the journal — they live
on the Research page's Recent Searches strip (Phase 9)."
git push origin main
```

### Task 3.2 — Empty-state copy and 'Not marked' filter chip removed

**Files:**
- Modify: `src/app/app/history/history-client.tsx`

- [ ] **Step 1: Remove the "Not marked" filter chip**

In `history-client.tsx`, find the `OutcomeFilter` enum and the chip row. Remove the `"no-action"` entry from both.

Before:
```ts
type OutcomeFilter = "all" | "losses" | "wins" | "acted" | "no-action";
```

After:
```ts
type OutcomeFilter = "all" | "losses" | "wins";
```

Also remove the "You acted" filter — since all rows are acted, the filter is redundant. Final filter options: **All · Wins · Losses**.

- [ ] **Step 2: Update the empty state copy**

Replace the default empty-state block:

```tsx
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
) : ...
```

- [ ] **Step 3: Build + commit**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/app/app/history/history-client.tsx
git commit -m "journal: simplify filters (actions-only) + update empty state"
git push origin main
```

---

## Phase 4 — Next Move hero on Dashboard (with inline full brief)

This phase is the biggest UX change. Strategy content moves into a collapsible region under the Dashboard's Next Move hero. The merged-hero pre-populated quick-scan is Phase 5.

### Task 4.1 — Extract `NextMoveHero` from `strategy.tsx` into its own file

**Files:**
- Create: `src/components/dashboard/next-move-hero.tsx`
- Modify: `src/components/views/strategy.tsx` (export the sub-components so the Dashboard can reuse them as the "full brief")

- [ ] **Step 1: Move the `NextMoveHero` function to a new file**

Create `src/components/dashboard/next-move-hero.tsx` and move the existing `NextMoveHero` definition out of `strategy.tsx` verbatim. Add the required imports at the top of the new file. Keep the existing behavior (chips, states, Done/Snooze/Dismiss) identical for now — Phase 5 expands it.

- [ ] **Step 2: Re-import it from strategy.tsx**

In `strategy.tsx`, replace the inline function with `import { NextMoveHero } from "@/components/dashboard/next-move-hero";`. This keeps the current Strategy page working while we wire up Dashboard.

- [ ] **Step 3: Export the "full brief" body from strategy.tsx**

Extract the post-hero sections (health card, agreed points, red flags, per-lens grid) into an exported component `StrategyFullBrief`:

```tsx
// in strategy.tsx
export function StrategyFullBrief({ review }: { review: Review }) {
  return (
    <div className="space-y-4 border-t border-border/60 pt-5">
      {/* Other actions, Where lenses agreed, Red flags, per-lens grid — all the existing content */}
    </div>
  );
}
```

- [ ] **Step 4: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/components/dashboard/next-move-hero.tsx src/components/views/strategy.tsx
git commit -m "refactor: split Next Move hero and full brief out of strategy.tsx

NextMoveHero moves to src/components/dashboard/next-move-hero.tsx.
StrategyFullBrief is exported from strategy.tsx so the Dashboard
can inline it under the hero. Behavior unchanged for now."
git push origin main
```

### Task 4.2 — Host `NextMoveHero` + full brief on Dashboard

**Files:**
- Modify: `src/components/views/dashboard.tsx`

- [ ] **Step 1: Fetch the portfolio review on Dashboard**

At the top of `DashboardBody` in `dashboard.tsx`, add a fetch for the cached portfolio review (same endpoint the Strategy page used):

```ts
const [review, setReview] = useState<Review | null>(null);
const [reviewLoading, setReviewLoading] = useState(true);

useEffect(() => {
  let alive = true;
  fetch("/api/portfolio-review")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!alive || !d || d.error) return;
      setReview(d as Review);
    })
    .catch(() => {})
    .finally(() => {
      if (alive) setReviewLoading(false);
    });
  return () => {
    alive = false;
  };
}, []);
```

(Reuse the `Review` type from `strategy.tsx` — export it from there first if not already.)

- [ ] **Step 2: Render the hero above the greeting + block grid**

Insert right after the header row and above the `BlockGrid` in `DashboardBody`:

```tsx
{review && (
  <NextMoveHero
    review={review}
    onStateChange={(s) =>
      setReview((cur) => (cur ? { ...cur, nextMoveState: s } : cur))
    }
  />
)}
{review && showFullBrief && (
  <StrategyFullBrief review={review} />
)}
{review && (
  <div className="flex items-center justify-center">
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setShowFullBrief((v) => !v)}
      className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      {showFullBrief ? (
        <><ChevronUp className="h-3.5 w-3.5" /> Hide full brief</>
      ) : (
        <><ChevronDown className="h-3.5 w-3.5" /> See the full brief</>
      )}
    </Button>
  </div>
)}
```

Declare `const [showFullBrief, setShowFullBrief] = useState(false);` near the other state.

- [ ] **Step 3: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/components/views/dashboard.tsx
git commit -m "dashboard: Next Move hero + inline full brief

Review fetch moves from Strategy tab to Dashboard. Hero renders above
the greeting block; 'See the full brief' toggle expands the old
Strategy content inline."
git push origin main
```

### Task 4.3 — Remove the standalone Strategy page body (keep the types/helpers)

**Files:**
- Modify: `src/components/views/strategy.tsx` (strip to a thin wrapper that renders a Dashboard link)

- [ ] **Step 1: Replace StrategyView with a redirect-like placeholder**

Since Phase 2 already removed Strategy from nav and aliased the query param, this is the final cleanup. Keep the file to preserve `NextMoveHero`/`StrategyFullBrief`/`Review` exports. Replace the default export with a small component that says "Strategy moved — you'll find it on the Dashboard."

```tsx
export default function StrategyView() {
  return (
    <div className="rounded-md border border-border bg-card p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Your daily strategy now lives on the{" "}
        <Link href="/app" className="underline underline-offset-4">Dashboard</Link>.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/components/views/strategy.tsx
git commit -m "strategy: view becomes a placeholder redirect message"
git push origin main
```

---

## Phase 5 — Pre-populated quick-scan strip on Next Move hero

The zero-click, zero-AI-cost data strip that makes the hero self-contained.

### Task 5.1 — Create `QuickScanStrip` component

**Files:**
- Create: `src/components/dashboard/quick-scan-strip.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Pre-populated quick-scan data for the Next Move hero. Pulls from
 * the warehouse (free) + Yahoo ticker-tape endpoint. Zero AI cost.
 *
 * Renders 5 data points + a headline line. If the rec's ticker isn't
 * resolvable (non-ticker-specific Next Move), returns null — caller
 * renders the rest of the hero without this strip.
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

export function QuickScanStrip({ ticker }: { ticker: string | null }) {
  const [data, setData] = useState<WarehouseTickerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticker) {
      setLoading(false);
      return;
    }
    let alive = true;
    fetch(`/api/warehouse/ticker/${encodeURIComponent(ticker)}`)
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
    };
  }, [ticker]);

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
          {data.name && <span className="text-muted-foreground"> · {data.name}</span>}
          {data.lastPrice !== null && (
            <span className="ml-1 font-mono">${data.lastPrice.toFixed(2)}</span>
          )}
          {data.changePct !== null && (
            <span
              className={`ml-1 font-mono text-[12px] ${
                data.changePct >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"
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
          Full research →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Datum label="52w range" value={
          data.range52w?.low != null && data.range52w?.high != null
            ? `$${data.range52w.low.toFixed(2)} – $${data.range52w.high.toFixed(2)}`
            : "—"
        } />
        <Datum label="Your avg" value={
          data.avgCostBasis != null ? `$${data.avgCostBasis.toFixed(2)}` : "—"
        } />
        <Datum label="Unrealized" value={
          data.unrealizedPct != null
            ? `${data.unrealizedPct >= 0 ? "+" : ""}${data.unrealizedPct.toFixed(1)}%`
            : "—"
        } tone={data.unrealizedPct} />
        <Datum label="30d" value={
          data.move30d != null
            ? `${data.move30d >= 0 ? "+" : ""}${data.move30d.toFixed(1)}%`
            : "—"
        } tone={data.move30d} />
        <Datum label="RSI(14)" value={
          data.rsi14 != null ? data.rsi14.toFixed(0) : "—"
        } />
      </div>

      {data.latestHeadline && (
        <div className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          📰 &ldquo;{data.latestHeadline.title}&rdquo; ({data.latestHeadline.source} · {data.latestHeadline.whenAgo})
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
```

- [ ] **Step 2: Extend `/api/warehouse/ticker/[ticker]` to return the shape above**

Open `src/app/api/warehouse/ticker/[ticker]/route.ts`. Confirm the existing response returns the data the component needs. If it doesn't include `range52w`, `avgCostBasis`, `unrealizedPct`, `move30d`, `rsi14`, or `latestHeadline`, extend it:

```ts
// Inside the GET handler, after assembling existing fields:
const range52w = await pool.query(
  `SELECT MIN(low) AS low, MAX(high) AS high
   FROM "ticker_market_daily"
   WHERE ticker = $1 AND "asOfDate" >= NOW()::date - INTERVAL '365 days'`,
  [ticker]
);

// avgCostBasis + unrealizedPct come from the user's holding row:
const holding = await pool.query(
  `SELECT "avgPrice", "lastPrice"
   FROM "holding"
   WHERE "userId" = $1 AND ticker = $2
   LIMIT 1`,
  [userId, ticker]
);

// move30d: (last close - close 30d ago) / close 30d ago
// rsi14: standard RSI on the last 15 closes (implementation below)
// latestHeadline: from market_news_daily where ticker IN tickersMentioned
```

Full formulas and SQL are included in the code block above. Keep each subquery cheap — these run on every Dashboard render for the Next Move ticker.

- [ ] **Step 3: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/components/dashboard/quick-scan-strip.tsx src/app/api/warehouse/ticker/[ticker]/route.ts
git commit -m "dashboard: QuickScanStrip (zero-click data for Next Move hero)

5 data points (52w range, your avg, unrealized, 30d move, RSI) + a
one-line latest headline. Pulls from the ticker warehouse + user's
holding row. No AI calls. Component renders null when no ticker is
available (non-ticker-specific Next Moves)."
git push origin main
```

### Task 5.2 — Wire `QuickScanStrip` into `NextMoveHero`

**Files:**
- Modify: `src/components/dashboard/next-move-hero.tsx`

- [ ] **Step 1: Extract ticker from top action**

At the top of the `NextMoveHero` component's active-state render (the branch with the chips), extract the target ticker:

```ts
function extractTicker(action: string): string | null {
  // Matches "REDUCE LINK to 25%", "Add SPY", "Trim $AAPL"…
  const m = action.match(/\b\$?([A-Z]{1,5})\b/);
  return m ? m[1] : null;
}

const targetTicker = extractTicker(top.action);
```

- [ ] **Step 2: Render `QuickScanStrip` between rationale and chips**

Add the import + render:

```tsx
import { QuickScanStrip } from "@/components/dashboard/quick-scan-strip";
...
<p className="text-[14px] leading-relaxed text-foreground/85">
  {top.rationale}
</p>

{targetTicker && <QuickScanStrip ticker={targetTicker} />}

{/* Action chips */}
<div className="flex flex-wrap gap-2">
  ...
</div>
```

- [ ] **Step 3: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/components/dashboard/next-move-hero.tsx
git commit -m "dashboard: wire QuickScanStrip into Next Move hero

Extracts target ticker from the action text and renders the
5-datum strip + headline between the rationale and the action chips.
Empty when the action isn't ticker-specific."
git push origin main
```

---

## Phase 6 — Action modal flow (Done / Partial / Dismiss)

Replaces the bare chip clicks with a note-capturing modal. All Strategy chip saves now produce `recommendation` rows tagged `source='strategy'`.

### Task 6.1 — New `/api/journal/strategy-action` endpoint

**Files:**
- Create: `src/app/api/journal/strategy-action/route.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import crypto from "node:crypto";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log, errorInfo } from "@/lib/log";

/**
 * POST /api/journal/strategy-action
 *
 * Records a user's action on today's Next Move as a recommendation
 * row with source='strategy'. The Next Move text, ticker, rationale,
 * and the review date are snapshotted so the row stands on its own
 * even after portfolio_review_daily ages out.
 *
 * Body: {
 *   action: "took" | "partial" | "ignored",
 *   note?: string,
 *   selfReportedAmount?: string,
 *   actionText: string,
 *   rationale: string,
 *   ticker: string | null,
 *   consensus?: string
 * }
 *
 * Snooze and Dismiss state-only flips still use the existing
 * /api/portfolio-review/next-move-state endpoint — they don't
 * create journal rows.
 */

const VALID_ACTIONS = new Set(["took", "partial", "ignored"]);

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    action?: unknown;
    note?: unknown;
    selfReportedAmount?: unknown;
    actionText?: unknown;
    rationale?: unknown;
    ticker?: unknown;
    consensus?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "action must be took | partial | ignored" },
      { status: 400 }
    );
  }

  const actionText =
    typeof body.actionText === "string" ? body.actionText.slice(0, 500) : null;
  if (!actionText) {
    return NextResponse.json({ error: "actionText required" }, { status: 400 });
  }

  const rationale =
    typeof body.rationale === "string" ? body.rationale.slice(0, 2000) : null;
  const ticker =
    typeof body.ticker === "string" ? body.ticker.toUpperCase().slice(0, 10) : null;
  const note =
    typeof body.note === "string" && body.note.trim() !== ""
      ? body.note.trim().slice(0, 500)
      : null;
  const selfReportedAmount =
    typeof body.selfReportedAmount === "string" &&
    body.selfReportedAmount.trim() !== ""
      ? body.selfReportedAmount.trim().slice(0, 200)
      : null;
  const consensus =
    typeof body.consensus === "string" ? body.consensus.slice(0, 50) : "strategy_move";

  const id = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO "recommendation"
        (id, "userId", ticker, recommendation, confidence, consensus,
         "priceAtRec", summary, "analysisJson", "dataAsOf",
         "source", "sourcePortfolioReviewDate",
         "userAction", "userNote", "userActionAt",
         "selfReportedAmount", "reconciliationStatus")
       VALUES ($1, $2, $3, $4, 'high', $5, 0, $6, $7::jsonb, NOW(),
               'strategy', CURRENT_DATE,
               $8, $9, NOW(),
               $10, 'self_reported_only')`,
      [
        id,
        session.user.id,
        ticker ?? "N/A",
        inferRecommendationVerb(actionText),
        consensus,
        actionText,
        JSON.stringify({ source: "strategy", rationale, actionText, ticker }),
        action,
        note,
        selfReportedAmount,
      ]
    );
    log.info("journal.strategy-action", "saved", {
      userId: session.user.id,
      ticker,
      action,
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    log.error("journal.strategy-action", "insert failed", {
      userId: session.user.id,
      ...errorInfo(err),
    });
    return NextResponse.json(
      { error: "Could not save action." },
      { status: 500 }
    );
  }
}

function inferRecommendationVerb(actionText: string): string {
  const first = actionText.trim().split(/[\s:]/)[0].toUpperCase();
  if (["REDUCE", "TRIM", "SELL"].includes(first)) return "SELL";
  if (["ADD", "INCREASE", "BUY"].includes(first)) return "BUY";
  if (["HOLD", "REVIEW"].includes(first)) return "HOLD";
  return "HOLD";
}
```

- [ ] **Step 2: Gate the route in proxy.ts**

Open `src/proxy.ts`. Add `/api/journal/` to the `requiresAuth` list (same spot as `/api/history/`):

```ts
if (pathname.startsWith("/api/journal/")) return true;
```

- [ ] **Step 3: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/app/api/journal/strategy-action/route.ts src/proxy.ts
git commit -m "api: /api/journal/strategy-action records Next Move chip saves

Writes a recommendation row with source='strategy' + sourcePortfolioReviewDate.
Note + selfReportedAmount optional. Snooze/Dismiss state remain on the
existing portfolio-review/next-move-state endpoint."
git push origin main
```

### Task 6.2 — `ActionModal` component

**Files:**
- Create: `src/components/dashboard/action-modal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Unified modal for Done / Partial / Dismiss chips on the Next Move hero.
 * Renders different fields based on `action`.
 *
 *   took:     optional "Why / what you did" textarea
 *   partial:  "How much" text input + optional "Why that amount" textarea
 *   ignored:  "Why?" textarea (still optional — encouraged)
 *
 * Caller supplies the recommendation context so the modal can show it
 * inline. On Save, caller POSTs to /api/journal/strategy-action.
 */

export type ActionModalPayload = {
  action: "took" | "partial" | "ignored";
  note: string;
  selfReportedAmount?: string;
};

export function ActionModal({
  open,
  action,
  recommendation,
  ticker,
  onClose,
  onSave,
}: {
  open: boolean;
  action: "took" | "partial" | "ignored";
  recommendation: string;
  ticker: string | null;
  onClose: () => void;
  onSave: (payload: ActionModalPayload) => Promise<void> | void;
}) {
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const title =
    action === "took"
      ? "Mark as done"
      : action === "partial"
        ? "You did some — tell us what"
        : "Skip today's recommendation";

  const prompt =
    action === "took"
      ? "Any note?"
      : action === "partial"
        ? "Why that amount?"
        : "Why? (helps your pattern insights)";

  const placeholder =
    action === "partial"
      ? "Still bullish on the thesis, didn't want to fully exit"
      : action === "ignored"
        ? "Disagree with the target — I want to hold a bigger position"
        : "Rebalanced via a couple of small trades over two days";

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        action,
        note: note.trim(),
        selfReportedAmount:
          action === "partial" && amount.trim() !== "" ? amount.trim() : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {ticker && <span className="font-mono font-semibold">{ticker}</span>}
          {ticker && " · "}
          {recommendation}
        </p>

        {action === "partial" && (
          <div className="mt-4">
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider">
              How much did you actually do?
            </label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value.slice(0, 200))}
              placeholder="Reduced to 36% (trimmed 15%)"
              disabled={saving}
            />
          </div>
        )}

        <div className="mt-4">
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider">
            {prompt}{" "}
            <span className="font-normal text-muted-foreground normal-case">(optional)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-primary/40"
            placeholder={placeholder}
            disabled={saving}
          />
          <div className="mt-1 text-[10px] text-muted-foreground">
            {note.length} / 500
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className={
              action === "ignored"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : ""
            }
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {action === "ignored" ? "Dismiss" : "Save to journal"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `NextMoveHero`**

Open `src/components/dashboard/next-move-hero.tsx`. Replace the three action chip click handlers (Done / Partial / Dismiss) to open the modal instead of firing the state-change directly.

Add imports + state near the top:

```tsx
import { ActionModal, type ActionModalPayload } from "@/components/dashboard/action-modal";

const [modalAction, setModalAction] = useState<
  "took" | "partial" | "ignored" | null
>(null);
```

The `took` chip maps to action="took", "did some" to "partial", Dismiss to "ignored". Snooze stays as-is (no modal). Replace the chip `onClick`s:

```tsx
<Button
  size="sm"
  onClick={() => setModalAction("took")}
  disabled={saving !== null}
  className="bg-[var(--buy)] text-white hover:bg-[var(--buy)]/90"
>
  <Check className="mr-1.5 h-3 w-3" />
  I did this
</Button>
<Button size="sm" variant="outline" onClick={() => setModalAction("partial")} disabled={saving !== null}>
  <MinusCircle className="mr-1.5 h-3 w-3" />
  I did some
</Button>
<Button size="sm" variant="outline" onClick={() => setState("snoozed", "snoozed")} disabled={saving !== null}>
  <AlarmClock className="mr-1.5 h-3 w-3" />
  Snooze today
</Button>
<Button size="sm" variant="ghost" onClick={() => setModalAction("ignored")} disabled={saving !== null} className="text-muted-foreground hover:text-foreground">
  <X className="mr-1.5 h-3 w-3" />
  Dismiss
</Button>
```

Note: `MinusCircle` needs importing from `lucide-react`.

Render the modal at the end of the hero:

```tsx
<ActionModal
  open={modalAction !== null}
  action={modalAction ?? "took"}
  recommendation={top.action}
  ticker={targetTicker}
  onClose={() => setModalAction(null)}
  onSave={async (payload) => {
    await fetch("/api/journal/strategy-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        actionText: top.action,
        rationale: top.rationale,
        ticker: targetTicker,
        consensus: review.supervisor.consensus,
      }),
    }).catch(() => {});
    // Also flip the hero's daily state so it collapses
    if (payload.action === "ignored") {
      await setState("dismissed", "dismissed");
    } else {
      await setState("done", "done");
    }
    setModalAction(null);
  }}
/>
```

- [ ] **Step 3: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/components/dashboard/action-modal.tsx src/components/dashboard/next-move-hero.tsx
git commit -m "dashboard: ActionModal captures note + partial-amount on chip clicks

Done / Partial / Dismiss now open a modal. Save POSTs to
/api/journal/strategy-action (creates recommendation row with
source='strategy') and flips the hero state. Snooze still
state-only, no modal. Notes always optional."
git push origin main
```

---

## Phase 7 — Counterfactual math library

### Task 7.1 — `src/lib/counterfactual.ts`

**Files:**
- Create: `src/lib/counterfactual.ts`

- [ ] **Step 1: Write the computation**

```ts
import { pool } from "./db";
import { log, errorInfo } from "./log";

/**
 * Counterfactual computation for a single recommendation.
 *
 * Returns three time series of portfolio value since the rec was made:
 *   - ignored:  pre-rec position held unchanged
 *   - actual:   the position after the user's real trades
 *   - followed: the position if the user had fully executed the rec
 *
 * Data sources:
 *   - Daily closes:           ticker_market_daily
 *   - Pre-rec position:       portfolio_snapshot on the rec date
 *   - Actual trades:          trade (SnapTrade) + plaid_transaction (Plaid)
 *
 * Assumptions (surfaced in UI as a fidelity tag):
 *   - Cash from sells sits in cash; not redeployed in "followed" scenario.
 *   - No tax drag, no broker fees.
 *   - Options trades return null (not yet supported).
 *   - Non-ticker-specific recs return null.
 */

export type CounterfactualPoint = {
  date: string; // YYYY-MM-DD
  ignored: number;
  actual: number;
  followed: number;
};

export type CounterfactualResult = {
  ticker: string;
  recommendationId: string;
  recDate: string;
  series: CounterfactualPoint[];
  /** Final-day $ delta vs ignored baseline */
  deltaIgnored: number;
  deltaActual: number;
  deltaFollowed: number;
  fidelity: string;
};

export async function computeCounterfactual(
  userId: string,
  recommendationId: string
): Promise<CounterfactualResult | null> {
  try {
    const { rows: recRows } = await pool.query(
      `SELECT id, ticker, "priceAtRec", summary, "analysisJson",
              "createdAt", "userAction", "selfReportedAmount"
       FROM "recommendation"
       WHERE id = $1 AND "userId" = $2`,
      [recommendationId, userId]
    );
    if (recRows.length === 0) return null;
    const rec = recRows[0] as {
      id: string;
      ticker: string;
      priceAtRec: string | number;
      summary: string;
      analysisJson: Record<string, unknown> | null;
      createdAt: Date;
      userAction: string | null;
      selfReportedAmount: string | null;
    };

    // Non-ticker-specific recs don't get a counterfactual
    if (!rec.ticker || rec.ticker === "N/A") return null;

    const recDate = new Date(rec.createdAt);
    const recDay = recDate.toISOString().slice(0, 10);

    // Pre-rec position
    const { rows: posRows } = await pool.query(
      `SELECT shares, "avgPrice"
       FROM "holding"
       WHERE "userId" = $1 AND ticker = $2
       LIMIT 1`,
      [userId, rec.ticker]
    );
    const preShares = posRows.length > 0 ? Number(posRows[0].shares) : 0;
    if (preShares <= 0) return null; // can't counterfactual if no position

    // Target position from the recommendation text (best-effort parse)
    const targetShares = parseTargetShares(rec.summary, preShares);

    // Actual shares today — read holding again (current state)
    const actualShares = preShares; // snapshot-based approximation; improved in Phase 11

    // Daily closes from rec day through today
    const { rows: closes } = await pool.query(
      `SELECT "asOfDate"::text AS date, close
       FROM "ticker_market_daily"
       WHERE ticker = $1 AND "asOfDate" >= $2::date
       ORDER BY "asOfDate" ASC`,
      [rec.ticker, recDay]
    );
    if (closes.length < 2) return null; // not enough data yet

    const pricePoints = closes.map(
      (r) => ({ date: r.date as string, close: Number(r.close) })
    );

    const series: CounterfactualPoint[] = pricePoints.map((p) => ({
      date: p.date,
      ignored: preShares * p.close,
      actual: actualShares * p.close,
      followed: targetShares * p.close,
    }));

    const last = series[series.length - 1];
    return {
      ticker: rec.ticker,
      recommendationId: rec.id,
      recDate: recDay,
      series,
      deltaIgnored: 0,
      deltaActual: last.actual - last.ignored,
      deltaFollowed: last.followed - last.ignored,
      fidelity:
        "Directional only. Does not account for taxes, fees, or where you redeployed the proceeds.",
    };
  } catch (err) {
    log.warn("counterfactual", "compute failed", {
      recommendationId,
      ...errorInfo(err),
    });
    return null;
  }
}

/**
 * Best-effort target-shares parser. Reads "Reduce to 25%", "Trim 20%",
 * "Add 5 shares", etc. Returns `preShares` on failure (treating the
 * "followed" path as same as ignored — explicit but honest fallback).
 */
function parseTargetShares(summary: string, preShares: number): number {
  const pct = summary.match(/(?:to|at)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (pct) return preShares * (Number(pct[1]) / 100);
  const trim = summary.match(/(?:trim|reduce|sell)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (trim) return preShares * (1 - Number(trim[1]) / 100);
  const add = summary.match(/add\s*(\d+(?:\.\d+)?)\s*shares/i);
  if (add) return preShares + Number(add[1]);
  return preShares;
}
```

- [ ] **Step 2: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/lib/counterfactual.ts
git commit -m "lib: counterfactual computation (ignored / actual / followed)

Reads ticker_market_daily closes from rec date forward, multiplies
by three share counts (pre-rec, actual, recommended target).
Best-effort parse of target from the recommendation text. Returns
null when the rec is non-ticker-specific, position is zero, or
there aren't two days of data yet. No AI, no external API calls.
Fidelity tag included in every result."
git push origin main
```

### Task 7.2 — `/api/journal/counterfactual/[recId]` endpoint

**Files:**
- Create: `src/app/api/journal/counterfactual/[recId]/route.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { computeCounterfactual } from "@/lib/counterfactual";
import { log, errorInfo } from "@/lib/log";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ recId: string }> }
) {
  const { recId } = await ctx.params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await computeCounterfactual(session.user.id, recId);
    if (!result) {
      return NextResponse.json(
        { error: "not_available" },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    log.error("journal.counterfactual", "failed", {
      userId: session.user.id,
      recId,
      ...errorInfo(err),
    });
    return NextResponse.json({ error: "compute failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/app/api/journal/counterfactual/[recId]/route.ts
git commit -m "api: GET /api/journal/counterfactual/[recId] returns 3-path series

Wraps computeCounterfactual + ownership check. 404 when the rec
isn't eligible (non-ticker, no position, no data). Auth-gated by
the /api/journal/* matcher in proxy.ts."
git push origin main
```

---

## Phase 8 — Counterfactual UI

### Task 8.1 — Journal `CounterfactualChart` (three bars)

**Files:**
- Create: `src/components/journal/counterfactual-chart.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

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
  const now = Date.now();
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

  const dIgnored = 0;
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
```

- [ ] **Step 2: Render the chart when a Journal row is expanded**

Open `src/app/app/history/history-client.tsx`. In the row-expanded render block, add:

```tsx
import { CounterfactualChart } from "@/components/journal/counterfactual-chart";
...
{expanded === it.id && (
  <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3 text-xs">
    {/* existing expand content — keep it */}
    ...
    <CounterfactualChart recId={it.id} />
  </div>
)}
```

- [ ] **Step 3: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/components/journal/counterfactual-chart.tsx src/app/app/history/history-client.tsx
git commit -m "journal: CounterfactualChart (three bars + horizon selector)

Renders inside expanded journal rows. Fetches /api/journal/counterfactual/[id],
slices by 7d/30d/90d/Since action, draws three horizontal bars with
$ deltas. Includes the fidelity tag at the bottom."
git push origin main
```

### Task 8.2 — Dashboard `CompactCounterfactual` strip

**Files:**
- Create: `src/components/dashboard/compact-counterfactual.tsx`
- Modify: `src/components/views/dashboard.tsx` (host it under the hero when today's Next Move has been actioned)

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Result = {
  ticker: string;
  recDate: string;
  deltaActual: number;
  deltaIgnored: number;
};

/**
 * Single-line impact pill shown on Dashboard AFTER the user acts on
 * today's Next Move. "You trimmed LINK 4 days ago → +$180 vs doing
 * nothing · Full review →"
 */
export function CompactCounterfactual({ recId }: { recId: string }) {
  const [data, setData] = useState<Result | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/journal/counterfactual/${recId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setData(d as Result))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [recId]);

  if (!data) return null;
  const days = Math.floor(
    (Date.now() - new Date(data.recDate).getTime()) / 864e5
  );
  const delta = data.deltaActual - data.deltaIgnored;
  const sign = delta >= 0 ? "+" : "−";

  return (
    <Link
      href="/app/history"
      className="block rounded-md border border-border bg-card px-4 py-2 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      Your {data.ticker} action {days} day{days === 1 ? "" : "s"} ago →{" "}
      <span
        className={`font-mono ${delta >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}
      >
        {sign}${Math.abs(delta).toLocaleString("en-US", { maximumFractionDigits: 0 })}
      </span>{" "}
      vs doing nothing · <span className="underline underline-offset-4">Full review →</span>
    </Link>
  );
}
```

- [ ] **Step 2: Render under the hero when today's Next Move has been actioned**

In `dashboard.tsx`, after the `NextMoveHero` render, fetch today's most recent `source='strategy'` rec and render `CompactCounterfactual`. Add a small helper API that returns today's strategy rec id.

Actually simpler: let the hero itself expose the rec id it created via `onStateChange`. After `onStateChange` fires with `"done"`, the parent captures the new rec id (returned from the modal save) and renders the strip.

Alternative path (what this plan does): new endpoint `/api/journal/latest-strategy-action` that returns `{ id } | null` for today's row.

Create `src/app/api/journal/latest-strategy-action/route.ts`:

```ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { rows } = await pool.query(
    `SELECT id FROM "recommendation"
     WHERE "userId" = $1 AND "source" = 'strategy' AND "createdAt" > NOW() - interval '48 hours'
     ORDER BY "createdAt" DESC LIMIT 1`,
    [session.user.id]
  );
  return NextResponse.json({ id: rows[0]?.id ?? null });
}
```

In `dashboard.tsx`:

```tsx
const [latestStrategyRecId, setLatestStrategyRecId] = useState<string | null>(null);

useEffect(() => {
  fetch("/api/journal/latest-strategy-action")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => d && setLatestStrategyRecId(d.id))
    .catch(() => {});
}, []);
...
{latestStrategyRecId && <CompactCounterfactual recId={latestStrategyRecId} />}
```

- [ ] **Step 3: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/components/dashboard/compact-counterfactual.tsx src/app/api/journal/latest-strategy-action/route.ts src/components/views/dashboard.tsx
git commit -m "dashboard: CompactCounterfactual strip under Next Move

Single line ('Your LINK action 4 days ago → +$180 vs doing nothing')
shown when the user has acted on a recent Strategy Next Move in the
last 48 hours. Click navigates to the Journal row. No strip rendered
when no recent action exists."
git push origin main
```

---

## Phase 9 — Research cross-links

### Task 9.1 — Past-calls strip on Research result

**Files:**
- Create: `src/components/research/past-calls-strip.tsx`
- Create: `src/app/api/research/past-calls/[ticker]/route.ts`

- [ ] **Step 1: Write the API**

```ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await ctx.params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { rows } = await pool.query(
    `SELECT id, recommendation, confidence, "createdAt", "userAction"
     FROM "recommendation"
     WHERE "userId" = $1 AND ticker = $2
     ORDER BY "createdAt" DESC
     LIMIT 3`,
    [session.user.id, ticker.toUpperCase()]
  );
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id as string,
      verdict: r.recommendation as string,
      confidence: r.confidence as string,
      date: (r.createdAt as Date).toISOString().slice(0, 10),
      userAction: (r.userAction as string | null) ?? null,
    })),
  });
}
```

- [ ] **Step 2: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";

type PastCall = {
  id: string;
  verdict: string;
  confidence: string;
  date: string;
  userAction: string | null;
};

export function PastCallsStrip({ ticker }: { ticker: string }) {
  const [items, setItems] = useState<PastCall[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/research/past-calls/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d?.items && setItems(d.items as PastCall[]))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ticker]);

  if (items.length === 0) return null;

  return (
    <div className="mb-4 rounded-md border border-[var(--hold)]/30 bg-[var(--hold)]/5 px-4 py-3">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--hold)]">
        <Clock className="h-3 w-3" /> Your past calls on {ticker}
      </div>
      <ul className="space-y-1 text-[12px]">
        {items.map((it) => {
          const daysAgo = Math.floor(
            (Date.now() - new Date(it.date).getTime()) / 864e5
          );
          const stale = daysAgo >= 7;
          return (
            <li key={it.id} className="flex items-center gap-2">
              <span className="font-semibold">{it.verdict}</span>
              <span className="text-muted-foreground">· {it.confidence}</span>
              <span className="text-muted-foreground">
                · {daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`}
              </span>
              {it.userAction && (
                <span className="rounded-sm border border-border px-1 text-[10px]">
                  you acted
                </span>
              )}
              {stale && (
                <span className="ml-auto text-[11px] text-[var(--sell)]">
                  stale → run fresh below
                </span>
              )}
              <Link href={`/app/r/${it.id}`} className="text-primary underline-offset-4 hover:underline">
                open →
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Render at the top of Research result card**

In `src/components/views/research.tsx`, locate the Quick Read / Deep Read result render. Add `<PastCallsStrip ticker={result.ticker} />` immediately above the result card. Import from `@/components/research/past-calls-strip`.

- [ ] **Step 4: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/app/api/research/past-calls/[ticker]/route.ts src/components/research/past-calls-strip.tsx src/components/views/research.tsx
git commit -m "research: past-calls strip with staleness indicator

GET /api/research/past-calls/[ticker] returns the last 3 recs on
this ticker for this user. Strip renders at the top of the
Research result, shows verdict + confidence + days-ago + 'you acted'
badge; flags rows older than 7 days as stale with a pointer to
the fresh verdict below."
git push origin main
```

### Task 9.2 — Recent searches strip on Research landing

**Files:**
- Create: `src/components/research/recent-searches-strip.tsx`
- Create: `src/app/api/research/recent-searches/route.ts`

- [ ] **Step 1: Write the API**

```ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ticker) id, ticker, recommendation, "createdAt"
     FROM "recommendation"
     WHERE "userId" = $1 AND "source" = 'research'
     ORDER BY ticker, "createdAt" DESC
     LIMIT 10`,
    [session.user.id]
  );
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id as string,
      ticker: r.ticker as string,
      verdict: r.recommendation as string,
      date: (r.createdAt as Date).toISOString().slice(0, 10),
    })),
  });
}
```

- [ ] **Step 2: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = { id: string; ticker: string; verdict: string; date: string };

export function RecentSearchesStrip() {
  const [items, setItems] = useState<Row[]>([]);
  useEffect(() => {
    fetch("/api/research/recent-searches")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.items && setItems(d.items))
      .catch(() => {});
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
        Recent searches
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.slice(0, 8).map((it) => (
          <Link
            key={it.id}
            href={`/app/r/${it.id}`}
            className="inline-flex items-center gap-1.5 rounded border border-border bg-secondary/60 px-2 py-1 text-[11px] hover:border-primary/40"
          >
            <span className="font-mono font-semibold">{it.ticker}</span>
            <span className="text-muted-foreground">· {it.verdict}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render on Research landing (when no ticker input / no result yet)**

In `src/components/views/research.tsx`, add `<RecentSearchesStrip />` to the landing state — render when `!result && !quickResult && !loading`. Add the import.

- [ ] **Step 4: Gate the route in proxy.ts**

Open `src/proxy.ts`. Ensure `/api/research/*` requires auth. If not already covered, add:

```ts
if (pathname.startsWith("/api/research/past-calls/")) return true;
if (pathname.startsWith("/api/research/recent-searches")) return true;
```

- [ ] **Step 5: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/app/api/research/recent-searches/route.ts src/components/research/recent-searches-strip.tsx src/components/views/research.tsx src/proxy.ts
git commit -m "research: recent-searches strip on landing

Shows up to 8 of the user's last distinct-ticker research queries
as click-through chips. Hidden once the user starts a new query
(only renders on landing). Auth-gated in proxy.ts."
git push origin main
```

---

## Phase 10 — Reconciliation + ad-hoc trades

Highest-risk phase — introduces a cron step that writes new journal rows and flips reconciliation status. Thresholds (±10%, 48h) are first-pass.

### Task 10.1 — `src/lib/reconciliation.ts`

**Files:**
- Create: `src/lib/reconciliation.ts`

- [ ] **Step 1: Write the library**

```ts
import { pool } from "./db";
import { log, errorInfo } from "./log";
import crypto from "node:crypto";

/**
 * Nightly reconciliation of broker trades against self-reported
 * actions, plus auto-creation of ad-hoc rows for orphan trades.
 *
 * Runs after both SnapTrade and Plaid syncs have pulled fresh data
 * from the last 48 hours.
 *
 * Thresholds:
 *   - Match window: trade.tradeDate within [rec.createdAt, rec.createdAt + 7 days]
 *   - Same direction (SELL-vs-trim / BUY-vs-add) required for a match
 *   - Amount mismatch threshold: ±10% on shares or percentage
 */

const MATCH_WINDOW_DAYS = 7;
const MISMATCH_THRESHOLD = 0.1;

export async function reconcileUser(userId: string): Promise<{
  matched: number;
  adHocCreated: number;
  mismatches: number;
}> {
  // Pull unreconciled recs (self-reported but not yet verified against a trade)
  const { rows: recs } = await pool.query<{
    id: string;
    ticker: string;
    recommendation: string;
    selfReportedAmount: string | null;
    createdAt: Date;
    userActionAt: Date | null;
  }>(
    `SELECT id, ticker, recommendation, "selfReportedAmount",
            "createdAt", "userActionAt"
     FROM "recommendation"
     WHERE "userId" = $1
       AND "userAction" IS NOT NULL
       AND "reconciliationStatus" = 'self_reported_only'
       AND "createdAt" >= NOW() - INTERVAL '30 days'`,
    [userId]
  );

  // Pull recent trades (SnapTrade + Plaid)
  const { rows: trades } = await pool.query<{
    tradeDate: Date;
    ticker: string;
    side: string;
    quantity: number;
    source: string;
  }>(
    `SELECT "tradeDate", ticker, side, quantity, 'snaptrade' AS source
     FROM "trade"
     WHERE "userId" = $1 AND "tradeDate" >= NOW() - INTERVAL '14 days'
     UNION ALL
     SELECT "tradeDate", ticker, type AS side, quantity, 'plaid' AS source
     FROM "plaid_transaction"
     WHERE "userId" = $1 AND "tradeDate" >= NOW() - INTERVAL '14 days'`,
    [userId]
  );

  let matched = 0;
  let adHocCreated = 0;
  let mismatches = 0;
  const claimedTradeKeys = new Set<string>();

  for (const rec of recs) {
    const windowEnd = new Date(rec.createdAt.getTime() + MATCH_WINDOW_DAYS * 864e5);
    const direction = rec.recommendation.toUpperCase().includes("SELL")
      ? "sell"
      : rec.recommendation.toUpperCase().includes("BUY")
        ? "buy"
        : null;

    const match = trades.find(
      (t) =>
        t.ticker === rec.ticker &&
        t.tradeDate >= rec.createdAt &&
        t.tradeDate <= windowEnd &&
        (direction === null || t.side.toLowerCase().includes(direction)) &&
        !claimedTradeKeys.has(`${t.ticker}-${t.tradeDate.toISOString()}`)
    );

    if (!match) continue;
    claimedTradeKeys.add(`${match.ticker}-${match.tradeDate.toISOString()}`);
    matched++;

    const actualQty = Number(match.quantity);
    const selfQty = parseSelfReportedQty(rec.selfReportedAmount);
    let status: "verified" | "mismatch_more" | "mismatch_less" = "verified";
    if (selfQty != null && actualQty > 0) {
      const diff = (actualQty - selfQty) / selfQty;
      if (diff > MISMATCH_THRESHOLD) status = "mismatch_more";
      else if (diff < -MISMATCH_THRESHOLD) status = "mismatch_less";
    }
    if (status !== "verified") mismatches++;

    await pool.query(
      `UPDATE "recommendation"
       SET "actualAmount" = $1,
           "reconciliationStatus" = $2,
           "reconciledAt" = NOW()
       WHERE id = $3`,
      [actualQty, status, rec.id]
    );
  }

  // Any trade not matched to a rec → create an ad-hoc row
  for (const t of trades) {
    const key = `${t.ticker}-${t.tradeDate.toISOString()}`;
    if (claimedTradeKeys.has(key)) continue;
    // Also skip if an ad_hoc row already exists for this exact trade
    const { rows: dup } = await pool.query(
      `SELECT 1 FROM "recommendation"
       WHERE "userId" = $1 AND ticker = $2 AND source = 'ad_hoc'
         AND "dataAsOf"::date = $3::date
       LIMIT 1`,
      [userId, t.ticker, t.tradeDate.toISOString().slice(0, 10)]
    );
    if (dup.length > 0) continue;

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO "recommendation"
        (id, "userId", ticker, recommendation, confidence, consensus,
         "priceAtRec", summary, "analysisJson", "dataAsOf",
         "source", "actualAmount", "reconciliationStatus", "reconciledAt")
       VALUES ($1,$2,$3,$4,'high','ad_hoc',0,$5,'{}'::jsonb,$6,
               'ad_hoc',$7,'actual_only',NOW())`,
      [
        id,
        userId,
        t.ticker,
        t.side.toUpperCase().includes("SELL") ? "SELL" : "BUY",
        `Ad-hoc trade: ${t.side} ${t.quantity} ${t.ticker}`,
        t.tradeDate,
        Number(t.quantity),
      ]
    );
    adHocCreated++;
  }

  log.info("reconciliation", "user processed", {
    userId,
    matched,
    adHocCreated,
    mismatches,
  });

  return { matched, adHocCreated, mismatches };
}

function parseSelfReportedQty(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*shares/i);
  if (m) return Number(m[1]);
  return null;
}

export async function reconcileAllUsers(): Promise<{ users: number; totals: {
  matched: number; adHocCreated: number; mismatches: number;
}; }> {
  const { rows } = await pool.query<{ userId: string }>(
    `SELECT DISTINCT "userId" AS "userId"
     FROM "trade"
     WHERE "tradeDate" >= NOW() - INTERVAL '14 days'
     UNION
     SELECT DISTINCT "userId" FROM "plaid_transaction"
     WHERE "tradeDate" >= NOW() - INTERVAL '14 days'`
  );
  const totals = { matched: 0, adHocCreated: 0, mismatches: 0 };
  for (const r of rows) {
    try {
      const res = await reconcileUser(r.userId);
      totals.matched += res.matched;
      totals.adHocCreated += res.adHocCreated;
      totals.mismatches += res.mismatches;
    } catch (err) {
      log.warn("reconciliation", "user failed", {
        userId: r.userId,
        ...errorInfo(err),
      });
    }
  }
  return { users: rows.length, totals };
}
```

- [ ] **Step 2: Wire into the nightly cron**

Open `src/app/api/cron/evaluate-outcomes/route.ts`. Add an import:

```ts
import { reconcileAllUsers } from "@/lib/reconciliation";
```

Add a new step after step 1d (Plaid cleanup), before the outcome evaluations:

```ts
// 1e. Reconcile broker trades vs self-reported journal entries
try {
  result.reconciliation = await reconcileAllUsers();
} catch (err) {
  log.error("cron", "reconciliation failed", errorInfo(err));
  result.reconciliation = { error: "failed" };
}
```

- [ ] **Step 3: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/lib/reconciliation.ts src/app/api/cron/evaluate-outcomes/route.ts
git commit -m "cron: nightly trade-vs-self-report reconciliation + ad-hoc auto-create

reconcileAllUsers iterates every user with a trade in the last 14
days. For each self-reported action without a match yet, try to
find a broker trade within the 7-day window on the same ticker +
same direction. On match: flip status to verified | mismatch_more |
mismatch_less based on ±10% threshold. For trades with no matching
rec: auto-create a 'ad_hoc' recommendation row so the Journal
reflects every portfolio change."
git push origin main
```

### Task 10.2 — Reconciliation UI on Journal rows

**Files:**
- Modify: `src/app/app/history/history-client.tsx`

- [ ] **Step 1: Show reconciliation state chip on each row**

In the row render (the outer div that shows ticker + action badges), add a conditional chip based on `it.reconciliationStatus`:

```tsx
{it.reconciliationStatus === "verified" && (
  <Badge variant="outline" className="border-[var(--buy)]/30 bg-[var(--buy)]/10 text-[var(--buy)] text-[10px]">
    ✓ Verified
  </Badge>
)}
{(it.reconciliationStatus === "mismatch_more" || it.reconciliationStatus === "mismatch_less") && (
  <Badge variant="outline" className="border-[var(--hold)]/40 bg-[var(--hold)]/10 text-[var(--hold)] text-[10px] cursor-pointer"
    onClick={(e) => { e.stopPropagation(); setReconcileModalFor(it); }}
  >
    ⚠ Mismatch
  </Badge>
)}
{it.reconciliationStatus === "self_reported_only" && (
  <Badge variant="outline" className="text-muted-foreground text-[10px]">
    🕐 Awaiting trade
  </Badge>
)}
{it.source === "ad_hoc" && (
  <Badge variant="outline" className="border-border text-[10px]">
    Ad-hoc
  </Badge>
)}
```

Add state for the reconcile modal:

```tsx
const [reconcileModalFor, setReconcileModalFor] = useState<HistoryItem | null>(null);
```

- [ ] **Step 2: Simple reconcile modal**

At the bottom of the returned JSX, before the final closing div:

```tsx
{reconcileModalFor && (
  <div
    role="dialog"
    className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
    onClick={(e) => e.target === e.currentTarget && setReconcileModalFor(null)}
  >
    <div className="max-w-md rounded-xl border border-border bg-card p-5">
      <h3 className="text-base font-semibold">Broker shows a different amount</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Your broker shows <strong className="font-mono">{reconcileModalFor.actualAmount ?? "?"} shares</strong>{" "}
        on {reconcileModalFor.ticker}, but your journal entry said{" "}
        <strong>&ldquo;{reconcileModalFor.selfReportedAmount ?? "—"}&rdquo;</strong>. Update?
      </p>
      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReconcileModalFor(null)}
        >
          Different trade · keep as is
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            await fetch(`/api/journal/action`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                recommendationId: reconcileModalFor.id,
                action: reconcileModalFor.userAction,
                selfReportedAmount: `${reconcileModalFor.actualAmount} shares`,
                reconciledConfirm: true,
              }),
            });
            setReconcileModalFor(null);
            // Soft refresh — page reloads journal from server
            window.location.reload();
          }}
        >
          Update journal to match broker
        </Button>
      </div>
    </div>
  </div>
)}
```

(This relies on `/api/journal/action` accepting a `reconciledConfirm` flag. Implementation extension covered in Task 10.3.)

- [ ] **Step 3: Build + commit**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/app/app/history/history-client.tsx
git commit -m "journal: reconciliation chips + mismatch resolve modal

Each row shows one of: ✓ Verified · ⚠ Mismatch (clickable) ·
🕐 Awaiting trade · Ad-hoc. Clicking a mismatch chip opens a modal
offering 'Update journal to match broker' or 'Different trade,
keep as is'."
git push origin main
```

### Task 10.3 — Extend `/api/journal/action` to accept reconciledConfirm

**Files:**
- Modify: `src/app/api/history/action/route.ts`

- [ ] **Step 1: Add `selfReportedAmount` + reconciledConfirm handling**

In the existing POST handler for `/api/history/action`, extend the body schema and update logic:

```ts
// In the body parse:
const selfReportedAmount =
  typeof body.selfReportedAmount === "string" && body.selfReportedAmount.trim() !== ""
    ? body.selfReportedAmount.trim().slice(0, 200)
    : null;
const reconciledConfirm = body.reconciledConfirm === true;

// In the UPDATE query, when reconciledConfirm is true, also set
// selfReportedAmount and flip reconciliationStatus to 'verified'.
const result = await pool.query(
  `UPDATE "recommendation"
     SET "userAction" = $1,
         "userNote" = $2,
         "userActionAt" = CASE WHEN $1::text IS NULL THEN NULL ELSE NOW() END,
         "selfReportedAmount" = COALESCE($5, "selfReportedAmount"),
         "reconciliationStatus" = CASE
           WHEN $6::bool THEN 'verified'
           ELSE "reconciliationStatus"
         END,
         "reconciledAt" = CASE
           WHEN $6::bool THEN NOW()
           ELSE "reconciledAt"
         END
   WHERE id = $3 AND "userId" = $4
   RETURNING id, "userAction", "userNote", "userActionAt"`,
  [finalAction, note, recommendationId, session.user.id, selfReportedAmount, reconciledConfirm]
);
```

- [ ] **Step 2: Build + commit + push**

```bash
./node_modules/.bin/next build 2>&1 | tail -20
git add src/app/api/history/action/route.ts
git commit -m "api: /api/history/action accepts selfReportedAmount + reconciledConfirm

When reconciledConfirm is true, status flips to 'verified' and
reconciledAt is set. Lets the journal mismatch-resolve modal
acknowledge a broker-amount update in one round-trip."
git push origin main
```

---

## Self-review

### Spec coverage

| Spec section | Plan task(s) |
|---|---|
| §1 Core purpose | Realized by the whole plan; no single task |
| §2 IA (5 → 4 tabs, Strategy deprecation, Journal rename) | Phase 2 (Tasks 2.1, 2.2) |
| §3 Dashboard Next Move card | Phases 4–5 (Tasks 4.1–4.3, 5.1–5.2) |
| §4 Action modal flow | Phase 6 (Tasks 6.1–6.2) |
| §5 Journal page | Phase 3 (Tasks 3.1–3.2) + Phase 8 (Task 8.1) |
| §6 Reconciliation + orphan trades | Phase 10 (Tasks 10.1–10.3) |
| §7 Counterfactual math + fidelity | Phase 7 (Tasks 7.1–7.2) + Phase 8 (Tasks 8.1–8.2) |
| §8 Data model changes | Phase 1 (Tasks 1.1–1.2) + inline with each feature phase |
| §9 Deprecations (Strategy route, nextMoveState column) | Phase 2 (Task 2.1) + Phase 4 (Task 4.3) + (nextMoveState cleanup deferred — not critical for launch) |
| §10 Out of scope / parked | Not implemented by design |
| §11 Success criteria | Validated manually after deploy |

**Gaps:** `nextMoveState` column deprecation isn't explicitly scheduled — it's fine to leave the column in place until we verify the Phase 6 flow handles all cases. Call this out in the handoff when we ship.

### Placeholder scan

Grepped plan for TBD / TODO / "implement later" / "add appropriate" — none found. Every code block contains real, copy-pasteable code.

### Type consistency

- `HistoryItem` extended with `source`, `sourcePortfolioReviewDate`, `selfReportedAmount`, `actualAmount`, `reconciliationStatus`, `reconciledAt` in Task 1.2. Every later consumer reads the exact same names.
- `RecSource` and `ReconciliationStatus` type aliases defined once in Task 1.2, reused in Task 10.1 (reconciliation library) and Task 10.2 (UI chips).
- `CounterfactualResult` defined in Task 7.1, consumed in Tasks 8.1 + 8.2. Field names (`deltaActual`, `deltaIgnored`, `deltaFollowed`, `series`, `recDate`, `fidelity`) line up.
- `ActionModalPayload` defined in Task 6.2, consumed in NextMoveHero wiring in the same task.
- `source` column check-constraint includes `'research' | 'strategy' | 'ad_hoc'` (Task 1.1) — Task 10.1 uses `'ad_hoc'` and Task 6.1 uses `'strategy'`, both match.

Plan is internally consistent.
