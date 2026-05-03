# Dashboard Redesign — Design Spec

**Date:** 2026-05-04
**Author:** Sang Lippert (with Claude Opus 4.7)
**Status:** Approved for implementation planning
**Supersedes:** `2026-05-02-actionable-dashboard-phase-1-design.md` for the `/app` overview surface. Phase 2/3/4 metric services and tiles are reused; only the homepage composition changes.

---

## 1. Problem

The current `/app` is two surfaces stacked. The Phase 1 actionable layer (Daily Headline + Decision Queue + 3 context tiles) sits on top of the legacy DashboardView (NextMoveHero + BlockGrid + RiskRadarCard + CompactCounterfactual + StrategyFullBrief). User feedback after live use:

- No greeting or portfolio summary at the top — the page opens with a decision card with no anchor for "where am I right now?"
- Daily Headline duplicates Next Move Hero (both are "the one thing to do")
- Decision Queue duplicates Risk Radar (both are "things to watch")
- Visual style mismatch between the new actionable layer and the legacy widgets — they were never designed together
- Wasted space; reads dense without rewarding the density

The user's framing: *"a dashboard is a quick visual of what needs attention, how does everything look, how's my portfolio."*

This redesign produces a single coherent dashboard that answers the four questions a money-decision dashboard must answer in under five seconds:

1. How's my money doing? → portfolio hero with $ + day change + benchmarks + 30-day sparkline + top 5 movers
2. Anything I need to do? → ONE primary decision (with "+ N more" collapse for additional ranked items)
3. What else should I be watching? → "Watch this week" — top 3 inline, "view all" drill
4. What is the market doing? → Market conditions sidebar (regime + key macro signals)

Customizable widgets live below the fold so power users still get depth without polluting the first-paint.

---

## 2. Goals

1. **Glanceable above the fold.** A user opens `/app`, sees portfolio anchor + ONE decision + watch list + market conditions in one screen height with no horizontal scroll.
2. **Kill the duplications.** Daily Headline + Next Move Hero merge into one "Today's decision." Decision Queue + Risk Radar merge into "Watch this week." Three separate context tiles merge into one "Market conditions" sidebar.
3. **Preserve depth.** Customizable BlockGrid (allocation donut, holdings, risk metrics, news, etc.) remains accessible below the fold.
4. **Visual coherence.** Editorial-warm theme tokens applied consistently. Fraunces italic on the Market conditions label and Today's decision header. Single accent rule (border-l-3 in `--decisive` rust) for the decision card; dashed dividers between Watch list rows.
5. **Configurable benchmarks.** User picks which indices/tickers their portfolio is compared against (S&P 500, Nasdaq, Dow defaults; sector ETFs, custom tickers, classic 60/40 portfolio as additions).

### Non-goals

- Not redesigning `/app/year-outlook`, `/app/history`, `/app/research`, `/app/portfolio`, `/app/settings/*`. Those routes remain as-is.
- Not changing any backend service (urgency engine, queue-builder, risk-loader, regime-loader, factor-loader, etc.). The redesign is composition + visual.
- Not adding new algorithms. All Phase 2-4 metrics already exist; this spec consumes them.
- Not changing AppShell top nav or footer. Only `/app` page composition changes.

---

## 3. Locked design decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Structural shape | **A · Unified Pane** (single coherent surface, top-to-bottom flow) |
| Consolidation strategy | **B · Moderate** (above-the-fold = 5 modules; BlockGrid stays customizable below the fold) |
| Density profile | **A+B combo** (B's working-desk hero w/ sparkline + side actions; A's readable Watch this week list with badges) |
| Naming | **"Market conditions"** (not Regime), **"Today's movers"** rolled into hero |
| Hero composition | Greeting + $ + day change + benchmark pills (left) · sparkline + top-5 movers (right, 2-row stack) |
| Multiple decisions | **Hero + collapse** (top decision is the hero treatment; "+ N more ▾" expands abbreviated rows 2-N inline) |
| Benchmarks | Configurable pills with picker; defaults S&P 500 / Nasdaq / Dow; +custom |

---

## 4. Information Architecture

`/app` page rebuilt. AppShell (top nav, ticker tape, trial banner, account dropdown) is unchanged.

**Above the fold, top to bottom:**

```
┌─────────────────────────────────────────────────────────────┐
│  PORTFOLIO HERO                                             │
│  Sun May 3 · Good morning, Sang                             │
│  $342,810  +$1,240 today (+0.36%)   │   30-day trend ↗      │
│  MTD +2.1% · YTD +9.4% ·             │   ┌──┬──┬──┬──┬──┐    │
│  vs S&P +0.4% · Nasdaq −1.2% ·       │   │AAPL│META│GOOG│… │ │
│  Dow +2.4% · + benchmark             │   └──┴──┴──┴──┴──┘    │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  TODAY'S DECISION · 1 of 5                       + 4 more ▾ │
│  Trim NVDA by ~25pp before earnings                         │
│  Concentration is 29.7%, your cap is 5–6%. Earnings T-12d.  │
│  [conc 29.7%] [TQ 41] [cons 2/3 sell] [Kelly ¼ 2.3%]        │
│                                          [Open thesis]      │
│                                          [Snooze 1d]        │
│                                          [Dismiss]          │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────┬───────────────────────────┐
│  WATCH THIS WEEK · 3            │  MARKET CONDITIONS        │
│                       View all →│                           │
│  AMD · re-research  EARNINGS T5d│  Neutral                  │
│  ─────────────────────────────  │  VIX 16.9 · contango      │
│  META · 30d outcome     REVIEW  │  FOMC in 38d              │
│  ─────────────────────────────  │  Real 10Y +2.1%           │
│  $3,200 idle           DEPLOY   │  view full outlook →      │
└─────────────────────────────────┴───────────────────────────┘
```

**Below the fold:**

```
↓ Customizable widgets · pinned
┌──────────┬──────────┬──────────┐
│Allocation│ Holdings │ Risk 60d │   ← user-pinned subset
└──────────┴──────────┴──────────┘
+ Customize widgets · news · sector heatmap · upcoming evals · …
```

Mobile (375px width): all sections collapse to single column; Watch+Conditions stack vertically.

---

## 5. Components

Five new components in `src/components/dashboard/redesign/`. Each has one responsibility, each takes server-loaded data through props, each renders empty/null states gracefully.

### 5.1 `<PortfolioHero>`

**Props:**
```ts
interface PortfolioHeroProps {
  userName: string | null;
  totalValue: number | null;        // current portfolio value in $
  dayChangeDollars: number | null;
  dayChangePct: number | null;
  mtdPct: number | null;
  ytdPct: number | null;
  benchmarks: BenchmarkComparison[]; // ordered list, max 4 inline
  sparklineData: { date: string; value: number }[]; // 30 trading days
  topMovers: TickerMover[];          // top 5 by absolute % move today
}
interface BenchmarkComparison {
  key: string;       // "sp500" | "nasdaq" | "dow" | ticker | "60-40"
  label: string;     // "S&P 500" | user-set label
  deltaPct: number;  // portfolio − benchmark over chosen window
}
interface TickerMover {
  ticker: string;
  changePct: number;  // signed
}
```

**Layout:** 2-column grid (left ~58%, right ~42%). Left: greeting line, $ + day change baseline-aligned, MTD/YTD line, benchmark pills, "+ benchmark" CTA. Right: sparkline (top half, ~50% height) with absolute $ delta in top-right corner; top-5 movers grid (5 mini-cards, 9px ticker label + 10px % delta colored green/wine).

**Empty states:**
- New user with no broker: "Connect a brokerage to see your portfolio →" CTA, no $ shown, sparkline area shows "—"
- Broker syncing: "Syncing holdings — first sync can take 1–3 minutes" placeholder
- < 5 movers (small portfolio): show what exists; no fake placeholder cards

### 5.2 `<TodayDecision>`

**Props:**
```ts
interface TodayDecisionProps {
  primary: QueueItem | null;       // highest-urgency item; null if queue empty
  others: QueueItem[];             // ranked, abbreviated for collapse rows
  onPromote?: (itemKey: string) => void;  // promote a row to primary
}
```

**Layout:**
- Top row: "Today's decision · {N of M}" header on the left, "+ {others.length} more ▾" caret on the right (visible only when others.length > 0).
- Primary card: title (18px bold), body (12px muted), chip row (Layered chips from existing system), action stack on the right (Open thesis · Snooze 1d · Dismiss).
- Collapsible region (initially closed): list of `others` as abbreviated rows — `2.` `<ticker>` · 1-line title · key chips on the right. Click row to promote OR open thesis.

**Empty state:**
- queue is empty AND no recent recommendations: "No urgent decisions. Browse research candidates →" CTA → `/app?view=research`.
- queue is empty BUT recommendations exist: "All decisions handled. Latest research recommendations available below."

**Backend reuse:**
- `buildQueueForUser(userId)` returns the ranked QueueItem[] (already exists). `primary = items[0]`, `others = items.slice(1)`.

### 5.3 `<WatchThisWeek>`

**Props:**
```ts
interface WatchThisWeekProps {
  items: QueueItem[];   // top 3 by horizon=THIS_WEEK; sorted by urgency
  totalCount: number;   // total queue items across all horizons (for "View all →" pluralizing)
}
```

**Layout:**
- Header: "Watch this week · 3" left, "View all →" right (links to `/app/history` or a new `/app/queue` drill — see §6).
- Three rows separated by dashed `--border` dividers:
  - Left: `<b>{ticker} · {action}</b>` followed by muted secondary text
  - Right: a horizon/category badge (`EARNINGS T-5d` rust, `REVIEW` gold, `DEPLOY` gold, `RISK` wine)
- Click row → primary action (research / outcome mark / portfolio deploy) per existing queue-builder deeplinks.

**Empty state:** "Nothing to watch this week. Quiet weeks are normal."

### 5.4 `<MarketConditionsSidebar>`

**Props:**
```ts
interface MarketConditionsSidebarProps {
  label: RegimeLabel;      // "RISK_ON" | "NEUTRAL" | "FRAGILE" | "STRESS"
  signals: {
    vix: number | null;
    vixTermStructure: "contango" | "backwardation" | null;
    daysToFOMC: number;
    real10Y: number | null;  // %
  };
  asOf: string | null;     // ISO date of latest signal
}
```

**Layout:**
- Header: "Market conditions" (uppercase, gold)
- Big label: 18px bold, *italic* (Fraunces). Color: green (RISK_ON), foreground (NEUTRAL), rust (FRAGILE), wine (STRESS).
- 3-line signal block (10px muted): `VIX 16.9 · contango`, `FOMC in 38d`, `Real 10Y +2.1%`.
- Footer: "view full outlook →" → `/app/year-outlook`.
- AsOf footnote at bottom (uses existing `<AsOfFootnote>`).

**Backend reuse:** `getMarketRegime()` from `regime-loader.ts` (already exists).

### 5.5 `<BenchmarkPicker>`

Modal triggered by "+ benchmark" pill in `<PortfolioHero>`.

**Props:**
```ts
interface BenchmarkPickerProps {
  selected: string[];     // keys of currently-active benchmarks
  onChange: (selected: string[]) => void;  // saves to /api/user/benchmarks
}
```

**Content sections:**
- **Major indices** (toggle pills): S&P 500 / Nasdaq / Dow / Russell 2000 / MSCI World
- **Diversified portfolios**: VTI Total US / Classic 60-40 (60% SPY + 40% AGG) / Three-fund (VTI + VXUS + BND)
- **Sector ETFs**: XLK / XLF / XLV / XLE / XLY / XLP / XLI / XLB / XLU / XLRE / XLC
- **Custom**: input field + ticker validation; calls `/api/benchmarks/validate?ticker=...` to confirm `ticker_market_daily` has price history

**Constraints:**
- Max 4 active inline (cap enforced server-side; fifth selection prompts user to deselect one)
- Saved to new `user_profile.benchmarks JSONB` column (see §6.3)

---

## 6. Data layer

### 6.1 Reused services (no changes)

- `buildQueueForUser(userId)` — provides `primary` + `others` for `<TodayDecision>`, top 3 of `THIS_WEEK` horizon for `<WatchThisWeek>`
- `getMarketRegime()` — provides `<MarketConditionsSidebar>` data
- `loadPortfolioDailyReturns(userId)` — sparkline data + benchmark deltas
- `getPortfolioRisk(userId)` — sparkline absolute $ delta computation
- `getReviewSummary(userId)` — `holdings`, `cashIdle`, etc. (used by widgets below the fold and by `<TodayDecision>` derivations)

### 6.2 New services

`src/lib/dashboard/hero-loader.ts` — composes hero data:
```ts
export interface HeroData {
  totalValue: number | null;
  dayChange: { dollars: number; pct: number } | null;
  mtdPct: number | null;
  ytdPct: number | null;
  benchmarks: BenchmarkComparison[];
  sparkline: { date: string; value: number }[];
  topMovers: TickerMover[];
  asOf: string | null;
}

export async function getHeroData(userId: string): Promise<HeroData>;
```

Internals:
- `totalValue` ← `getPortfolioValue(userId)` (already exists)
- `dayChange` ← compare today's portfolio value to yesterday's via `portfolio_snapshot` table
- `mtdPct`, `ytdPct` ← compute from `portfolio_snapshot` history (snapshot at month-start / year-start vs current)
- `benchmarks` ← read user's saved benchmarks from `user_profile.benchmarks` (fallback to defaults: `["sp500", "nasdaq", "dow"]`); for each, compute portfolio delta vs benchmark over the ytd window using `ticker_market_daily`
- `sparkline` ← daily `portfolio_snapshot.totalValue` for trailing 30 trading days
- `topMovers` ← user's holdings sorted by abs(today's `change_pct` from `ticker_market_daily`) limited to 5

`src/lib/dashboard/benchmark-resolver.ts` — resolves benchmark keys to ticker symbols and labels:
```ts
export const BENCHMARK_PRESETS: Record<string, { ticker: string; label: string }> = {
  sp500: { ticker: "SPY", label: "S&P 500" },
  nasdaq: { ticker: "QQQ", label: "Nasdaq" },
  dow: { ticker: "DIA", label: "Dow" },
  russell2000: { ticker: "IWM", label: "Russell 2000" },
  msci_world: { ticker: "URTH", label: "MSCI World" },
  vti: { ticker: "VTI", label: "Total US Market" },
  "60-40": { /* synthetic — see below */ },
  // sector ETFs
  xlk: { ticker: "XLK", label: "Tech" },
  xlf: { ticker: "XLF", label: "Financials" },
  // ... 9 more
};

export async function resolveBenchmarkReturn(key: string, fromDate: string): Promise<number | null>;
```

For `60-40` (synthetic), compute as `0.6 * SPY_return + 0.4 * AGG_return`. For custom user tickers (not in presets), the key IS the ticker — validated against `ticker_market_daily` at picker time.

### 6.3 Schema change

One new migration: `migrations/2026-05-04-user-benchmarks.sql`:

```sql
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS benchmarks JSONB NOT NULL DEFAULT '["sp500","nasdaq","dow"]'::jsonb;
```

`benchmarks` stores an ordered array of benchmark keys (presets) or ticker strings. Limit enforced in API (max 4).

### 6.4 New API routes

- `GET /api/user/benchmarks` → returns array of saved keys
- `POST /api/user/benchmarks` → updates array; validates max length 4; verifies custom tickers exist in `ticker_market_daily`
- `GET /api/benchmarks/validate?ticker=XYZ` → returns `{ valid: boolean, label?: string, history_days?: number }` for custom-ticker picker validation

All BetterAuth-gated via existing `proxy.ts` `/api/*` matcher.

---

## 7. Page composition

`src/app/app/page.tsx` rewritten:

```tsx
export default async function AppPage({ searchParams }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/sign-in");
  const userId = session.user.id;

  const params = await searchParams;
  const viewParam = typeof params.view === "string" ? params.view : null;

  // Existing ?view= passthrough for portfolio/research/strategy/integrations
  // dashboard view alias removed: viewParam === "dashboard" now redirects to /app
  if (viewParam && viewParam !== "overview" && viewParam !== "dashboard") {
    return <DashboardClient user={...} />;
  }

  const [hero, queue, regime] = await Promise.all([
    getHeroData(userId).catch(() => null),
    buildQueueForUser(userId).catch(() => []),
    getMarketRegime().catch(() => null),
  ]);

  const primary = queue[0] ?? null;
  const others = queue.slice(1);
  const watchThisWeek = queue
    .filter((i) => i.horizon === "THIS_WEEK")
    .slice(0, 3);

  return (
    <TooltipProvider>
      <main className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-3">
        <PortfolioHero {...hero} userName={session.user.name} />
        <TodayDecision primary={primary} others={others} />
        <div className="grid grid-cols-[1.8fr_1fr] gap-3">
          <WatchThisWeek items={watchThisWeek} totalCount={queue.length} />
          <MarketConditionsSidebar {...regime} />
        </div>
      </main>
      <BlockGridSection userId={userId} />
    </TooltipProvider>
  );
}
```

Below the fold, `<BlockGridSection>` is a thin client wrapper around the existing `<BlockGrid>` configured to render the user's pinned widgets. Default pinned set on first visit: `["allocation", "holdings", "risk60d"]`. User can customize via existing BlockGrid edit mode.

### 7.1 What's removed

| Removed | Reason |
|---|---|
| `<DailyHeadline>` (homepage usage) | Folded into `<TodayDecision>` |
| `<DecisionQueue>` (full ranked list on homepage) | Folded into `<TodayDecision>` collapse + `<WatchThisWeek>` |
| `<RiskTile>`, `<VarTile>`, `<MarketRegimeTile>` (3 separate tiles) | Folded into `<MarketConditionsSidebar>` (regime) and BlockGrid widget (risk) |
| `<NextMoveHero>` (legacy) | Subsumed by `<TodayDecision>` |
| `<RiskRadarCard>` (legacy) | Items now flow through `buildQueueForUser` → Watch this week |
| `<StrategyFullBrief>` collapse on homepage | Drill into `/app?view=research&ticker=...` instead |
| `<CompactCounterfactual>` strip | Moved to `/app/history` (already exists there) |
| `<legacy-dashboard-section>` (Phase 4 stack-fix) | Replaced by clean composition |

These components are NOT deleted from the codebase — they remain available for use in other surfaces (drill panels, history view, etc.). Only their use on `/app` is removed.

### 7.2 What's kept

- `<BlockGrid>` and all individual block components (KPIs strip, allocation donut, holdings list, sector heatmap, news strip, upcoming evaluations, top movers chart, etc.) — accessible below the fold, customizable.
- All `/app/*` sub-routes: `/r/[id]`, `/history`, `/year-outlook`, `/settings`, `/portfolio` (DashboardClient), `/research` (DashboardClient).
- The `?view=` query param passthrough for `portfolio | research | strategy | integrations`.
- `decision_queue_state` table and snooze/dismiss/done API routes — used by `<TodayDecision>` and `<WatchThisWeek>`.
- All Phase 2-4 metric loaders.

### 7.3 New widget candidates (Phase 6 backlog)

These didn't make this spec but are documented for the BlockGrid roadmap (each is a self-contained block component):

1. **EarningsCalendarBlock** — next 4 weeks of earnings on holdings, T-N day count
2. **DividendCalendarBlock** — upcoming ex-div dates + projected income next 90d
3. **InsiderActivityBlock** — last 7d Form 4 cluster signals on held tickers
4. **TaxHarvestMiniBlock** — `$X harvestable` + countdown to Dec 31
5. **GoalProgressMiniBlock** — pacing % toward target wealth (condensed Year Outlook)
6. **NewsDigestBlock** — top 3-5 news on holdings, last 24h
7. **SectorHeatmapBlock** — color grid of holding sector weights vs benchmark
8. **StyleTiltBlock** — value/growth + large/small from Fama-French betas
9. **TopContributorsBlock** — which 3-5 positions drove YTD return
10. **AccountSplitBlock** — taxable/IRA/401k/Roth breakdown
11. **ConcentrationMeterBlock** — radial gauge of top-N weights
12. **DrawdownClockBlock** — days since peak + current drawdown depth

Phase 6 ships in waves; this spec only requires the existing widgets render correctly in the new BlockGrid section.

---

## 8. Visual style

| Token | Where applied |
|---|---|
| `--background` (warm ivory `#FAF7F2`) | Page background, secondary surfaces, expanded collapse rows |
| `--card` (white) | Hero, decision card, watch list, conditions sidebar, blocks |
| `--foreground` (deep ink `#1A1A1E`) | Primary text, ticker labels, $ totals |
| `--muted-foreground` | Secondary text, chip values, signal lines |
| `--border` (warm gray `#E8E4DC`) | Section dividers, chip outlines, dashed row dividers |
| `--decisive` (rust `#B54F2A`) | Today's decision left border, "+ N more" caret, "View all →" links, custom-benchmark dashed pill |
| `--buy` (forest `#2D5F3F`) | Positive deltas (day change, MTD, YTD, mover gains, RISK_ON regime) |
| `--sell` (wine `#8B1F2A`) | Negative deltas (mover losses, RISK badges, STRESS regime) |
| `--hold` (gold `#9A7B3F`) | Section eyebrows ("WATCH THIS WEEK · 3"), date masthead, "view full outlook →" |

Typography:
- Greeting eyebrow: 10px, letter-spaced, gold
- Portfolio total: 32px, weight 800, foreground
- Benchmark pills: 10px, FAF7F2 background, E8E4DC border, weight 700 inside
- Today's decision title: 18px, weight 700
- Decision body: 12px, muted
- Watch list rows: 12px, foreground; secondary text 11px muted
- Market conditions label: 18px, *italic* (Fraunces stack)

Spacing:
- Page: `max-w-5xl mx-auto px-4 py-6 gap-3` (24px top/bottom, 16px lateral, 12px between sections)
- Cards: 16-18px padding, 14px between sub-rows
- Chips: 2-7px padding, 8px border-radius (pill)

---

## 9. Acceptance criteria

1. `/app` p95 load < 600ms with cached portfolio + queue + regime data.
2. Authenticated user with holdings sees: greeting + portfolio total + day change + MTD/YTD + 3+ benchmarks + sparkline + top-5 movers in the hero.
3. Authenticated user with ≥1 queue item sees `<TodayDecision>` with the highest-urgency item; if total queue length > 1, `+ N more ▾` caret appears and expands inline.
4. Authenticated user with ≥1 queue item tagged `THIS_WEEK` sees `<WatchThisWeek>` with up to 3 items; "View all →" links to `/app/history` (or new `/app/queue` if built).
5. `<MarketConditionsSidebar>` renders `Neutral` / `Risk_On` / `Fragile` / `Stress` with 3 signal lines (VIX, FOMC, Real 10Y) and an as-of timestamp.
6. New user with no broker sees an empty-state hero with "Connect a brokerage →" CTA and no fake $ values.
7. Snoozing the primary decision: queue refreshes; row 2 promotes to primary; `+ N more ▾` count decrements; `headline_cache` invalidates per existing eager-refresh logic.
8. Benchmark picker opens, lets user toggle up to 4 selections, persists to `user_profile.benchmarks`, and re-renders the hero with the new pill set.
9. Below-the-fold BlockGrid renders the user's pinned widgets (default `allocation`, `holdings`, `risk60d` on first visit). "+ Customize widgets" link opens edit mode.
10. Mobile (375px): all sections stack vertically; benchmark pills wrap; movers grid stacks 2-wide; no horizontal scroll.
11. Dark mode supported via existing `next-themes` token swaps; no per-component dark overrides needed beyond what tokens provide.
12. Disclaimer banner ("informational only, not investment advice") still visible somewhere on the page (footer or below the fold). Confirm position survives the redesign.

---

## 10. Implementation outline

The implementation plan will sequence:

1. **Migration** — `user_profile.benchmarks` JSONB column (additive).
2. **Services** — `getHeroData(userId)` in `hero-loader.ts`, `resolveBenchmarkReturn(key, fromDate)` in `benchmark-resolver.ts`, validation helper for custom tickers.
3. **Components** — `<PortfolioHero>`, `<TodayDecision>` (with collapse subcomponent `<DecisionList>` for the abbreviated rows), `<WatchThisWeek>`, `<MarketConditionsSidebar>`, `<BenchmarkPicker>` modal.
4. **API routes** — `/api/user/benchmarks` (GET/POST), `/api/benchmarks/validate?ticker=` (GET).
5. **Page composition** — rewrite `src/app/app/page.tsx` per §7.
6. **Removal** — delete `<legacy-dashboard-section>` wrapper; remove the now-unused tile imports from page.tsx.
7. **Block default** — set first-visit BlockGrid default pinned set to `["allocation", "holdings", "risk60d"]` (or whatever the existing block keys are; verify in implementation).
8. **Mobile pass** — manually test 375px breakpoint.
9. **Acceptance pass** — verify each AC.

Each step ships behind a single verification gate (`npm test`, `npx tsc --noEmit`, `npm run build`). The implementation plan elaborates per-step tasks with TDD where applicable.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Hero gets cluttered if a user has no holdings (no movers, no sparkline data) | Empty-state collapses the right column entirely; left column expands to fill. CTA: "Connect a brokerage →" |
| Custom ticker benchmark with no warehouse history | `/api/benchmarks/validate` rejects with friendly error; picker shows "We need 30+ days of price history. Try again later or pick a major index." |
| User pins 4+ benchmarks and inline pills wrap awkwardly | Cap enforced at 4; UI shows "Max 4 active. Deselect one to add another." in picker |
| Removing `<RiskTile>` from `/app` removes Sharpe/Sortino/etc. from the first paint | They live in BlockGrid `risk60d` block (default pinned). Visible below the fold. |
| Existing users have `headline_cache` JSONB rows with old data | Cache is invalidated per existing eager-refresh on next user action; no migration needed |
| `<DashboardClient>` for `?view=portfolio` etc. wraps in its own AppShell — possible double-shell if accidentally rendered with the new overview | The `viewParam !== "overview" && viewParam !== "dashboard"` gate prevents this. The previous `legacy-dashboard-section` solution is removed; clean separation. |

---

## 12. Out of scope (deferred to follow-up specs)

- New BlockGrid widgets from §7.3 (Phase 6)
- `/app/queue` standalone "view all decisions" page (currently links to `/app/history`)
- Tax-loss harvest auto-prompt in queue when window opens (existing math, just not yet a queue item type)
- Customizing the Watch this week count threshold (currently 3, no user control)
- Internationalization / non-USD currency support
- Per-user theme overrides beyond light/dark

---

**End of design.**
