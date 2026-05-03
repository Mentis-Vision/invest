# Actionable Dashboard — Phase 1 Design

**Date:** 2026-05-02
**Author:** Sang Lippert (with Claude Opus 4.7)
**Status:** Approved for implementation planning
**Phase scope:** Phase 1 only — homepage architecture + Daily Headline + Decision Queue. Phase 2 (science layer) and Phase 3 (personal layer) appear as appendices for forward-compatibility, not scope.

---

## 1. Problem

ClearPath Invest today is a research-grade decision engine: a 3-model AI consensus, a 7-component decision engine, brokerage-synced holdings, behavioral journaling, outcome tracking. It is information-rich and analytically deep. But it answers *"what does the data say about this stock?"* — not *"what should I do today, this week, this month, this year?"*

For an informed investor, the surface is acceptable but inefficient. For an average investor, it reads as a research library, not a dashboard. The promised transformation — *clarity on real-money decisions, backed by verified primary sources* — is delivered analytically but not surfaced as actionable guidance.

**The gap is structural, not analytical.** The data and the science are already in place. The dashboard's IA does not surface what to *act on*, when, or in what order.

---

## 2. Goals

1. **Make the homepage actionable** — the user should land at `/app` and see, within one screen-height, the single most important thing to think about today plus a ranked list of remaining open decisions.
2. **Serve both audiences without a mode toggle** — average investors read plain-English headlines; informed investors read the always-on metric chips. Same surface, different reading depths.
3. **Preserve every existing capability** — research view, history, portfolio drill, decision engine, AI consensus, outcome tracking all remain as-is. They become deep-link targets, not the homepage.
4. **No new algorithms in Phase 1** — only structural rework. Phase 2 adds the 14 approved scientific modules. Phase 1 ships the scaffold the algorithms will plug into.
5. **Zero hallucination risk for the headline** — body text is template-rendered from structured data, never a fresh LLM call.

### Non-goals (explicit)

- Not building any new algorithm in Phase 1 (Sharpe, Piotroski, Kelly, etc. — all Phase 2).
- Not changing the navigation shell, the sidebar, or any non-`/app` route.
- Not changing the research view, history view, portfolio view, or decision engine output schema.
- Not adding new AI providers or AI calls.
- Not adding personalization (goals, risk tolerance, target dates) — that is Phase 3.

---

## 3. Approach (locked decisions from brainstorm)

| Decision | Choice | Why |
|---|---|---|
| Homepage shape | **Hybrid: Daily Headline on top + Decision Queue underneath, with horizon tags as urgency badges** | Avoids the four-equal-panes dilution of a strict Today/Week/Month/Year layout. Queue tags surface horizon framing without making it the structural axis. |
| Audience strategy | **Layered chips, no mode toggle** | One surface for everyone. Plain-English headline reads to the average investor; the always-on metric chips read to the informed investor. Chips also act as a teaching surface. |
| Project scope | **Phased — Phase 1 first, then Phase 2 (science), then Phase 3 (personal)** | First ship in days, not weeks. Phase 1 reuses the existing decision engine; Phase 2 plugs new algorithms into a structure already proven. |

---

## 4. Information Architecture

The `/app` homepage is rebuilt as a single-column layout. The existing app shell (sidebar nav, mobile sheet, user dropdown) is unchanged.

**Layout, top to bottom:**

1. **Daily Headline card** — single most important decision today. Approximately 1 screen-height worth of attention.
2. **Decision Queue card** — ranked list of open decisions, each tagged with its horizon. Approximately 3-6 visible items, with snoozed/dismissed expandable.
3. **Context tiles row** — three small tiles: macro regime, MTD performance, year-pace. These are non-actionable framing.

Mobile: identical single-column structure, breakpoints inherited from existing layout. No horizontal scroll at 375px.

**What is removed from `/app`:**
- The current `BlockGrid` widget composition (kept as deep-link surface from queue items, not on homepage).
- The current "Next Move" hero (replaced by Daily Headline, which sources the same data).
- The current Risk Radar tile (replaced by queue items, which source the same data).

**What is preserved on `/app`:**
- Disclaimer banner.
- Onboarding hooks for users without holdings or without disclaimer accepted.
- Theme, fonts, color tokens (Editorial Warm).

---

## 5. Daily Headline

### 5.1 Source priority

The headline is the highest-priority item in the user's Decision Queue at refresh time. Selection rules, in order:

1. The single highest `urgency_score` queue item that is not snoozed, not dismissed, not marked done.
2. If queue is empty: the freshest research recommendation owned by the user from the last 30 days (`recommendation` table, `createdAt DESC` filtered to 30-day window). Surfaced as an `outcome_action_mark`-style headline if old enough to have an evaluated outcome, otherwise a "Re-read your latest thesis" headline.
3. If neither exists (new user, no holdings, no recommendations): a static empty-state headline ("Run your first research →") with a CTA to the research view.

### 5.2 Body rendering

Body text is rendered from a **template**, never from a live LLM call. One template per item type:

- `concentration_breach` → `"Trim {ticker} by ~{deltaPp}pp before {nextEvent}. Concentration is {currentPct}%, your cap is {minCap}–{maxCap}%."`
- `stale_recommendation` → `"Re-research {ticker} — last analyzed {daysAgo}d ago, price {moveSinceRec} since {originalVerdict} at ${priceAtRec}."`
- `catalyst_prep` → `"{ticker} reports {eventName} on {eventDate} ({daysToEvent}d). Last earnings reaction: {priorReaction}. Position is {currentPct}% of portfolio."`
- `outcome_action_mark` → `"Did you act on the {originalDate} {originalVerdict} on {ticker}? Outcome scored {outcomeMove} ({outcomeVerdict})."`
- `cash_idle` → `"${cashAmount} idle for {daysIdle}d. {numCandidates} BUY-rated candidates fit your sector budget."`
- `broker_reauth` → `"{brokerName} disconnected — reauthorize to refresh holdings."`

All template inputs come from existing structured data (`recommendation`, `portfolio_review`, `ticker_events`, `holding`, `recommendation_outcome`, broker item state). No prose generation.

### 5.3 Chips

Three to five small chips appear below the headline body, drawn from the underlying decision engine output and item context. Per item-type chip set:

| Item type | Chip set |
|---|---|
| `concentration_breach` | `TQ {score}` · `conc {pct}%` · `consensus {ratio}` · `next event T-{days}d` |
| `stale_recommendation` | `stale {days}d` · `{moveSinceRec}` · `consensus {ratio}` · `event T-{days}d` (if applicable) |
| `catalyst_prep` | `T-{days}d` · `IV-rank {pct}` · `prior reaction {pct}` · `position {pct}%` |
| `outcome_action_mark` | `outcome {pct}` · `{outcomeVerdict}` · `original {verdict}` |
| `cash_idle` | `${cashAmount}` · `{daysIdle}d idle` · `{numCandidates} candidates` |
| `broker_reauth` | `{brokerName}` · `last sync {daysAgo}d ago` |

Chips are rendered by a new `<LayeredChipRow>` component. They are read-only on the headline; they become tooltips with definitions on hover.

### 5.4 Actions

Three buttons below the chip row:

- **Open thesis** — primary CTA. Deep-links to the appropriate existing surface (research view for `concentration_breach`/`stale_recommendation`/`catalyst_prep`, history for `outcome_action_mark`, portfolio for `cash_idle`, settings for `broker_reauth`).
- **Snooze 1d** — hides the item from the queue and the headline for 24h. Item resurfaces at next 6am cron.
- **Dismiss** — opens a small reason picker (Already handled / I disagree / Not applicable / Other). Item is hidden permanently for the user. Dismiss reason is stored for future heuristics.

### 5.5 Refresh cadence

A daily cron at **11:00 UTC (6am ET)** rebuilds the headline cache for every user with active session activity in the last 7 days. The cached headline is served on every `/app` load until either:

- The next 6am refresh, or
- The user takes action on the current headline (open / snooze / dismiss / mark done) — at which point the headline is immediately re-picked from the next-highest queue item.

The cache lives in a new column on the existing `user_profile` table: `headline_cache JSONB`. No separate table needed.

---

## 6. Decision Queue

### 6.1 Item types (Phase 1)

Six conceptual item types ship in Phase 1. They are split into nine fine-grained variants so the urgency engine can rank severity (severe vs moderate breach) and scope (held vs watched) without duplicating template text. The §5.2 templates serve all variants of a given conceptual type.

| Item type | Source (existing) | Default horizon | Static impact weight |
|---|---|---|---|
| `broker_reauth` | SnapTrade `item_status='reauth_required'`, Plaid `item.error.error_code` | TODAY | 100 |
| `concentration_breach_severe` | `portfolio_review` output, position weight > 2× user cap | TODAY | 90 |
| `concentration_breach_moderate` | `portfolio_review` output, position weight 1.5–2× user cap | THIS_WEEK | 70 |
| `catalyst_prep_imminent` | `ticker_events`, earnings ≤7d on held ticker | TODAY/WEEK | 80 |
| `catalyst_prep_upcoming` | `ticker_events`, earnings 8–30d on held ticker | THIS_MONTH | 50 |
| `stale_rec_held` | `recommendation` table, held ticker, `createdAt > 30d ago`, no newer rec | THIS_WEEK | 60 |
| `stale_rec_watched` | `recommendation` table, non-held ticker, `createdAt > 30d ago` | THIS_MONTH | 30 |
| `outcome_action_mark` | `recommendation_outcome`, evaluated, no `userAction` recorded | THIS_WEEK | 40 |
| `cash_idle` | SnapTrade/Plaid balance > $500, `idleDays > 14`, `portfolio_review` has BUY candidates | THIS_MONTH | 50 |

User cap (concentration ceiling) for Phase 1 is a **static default of 5%** with override stored on `user_profile.concentration_cap_pct`. Phase 3 will personalize this.

### 6.2 Composition

`queue-builder.ts` is a pure function called on every `/app` load:

```
buildQueue(userId): QueueItem[]
  → reads from existing tables (no AI calls)
  → enumerates all 9 item types
  → joins with `decision_queue_state` to filter snoozed/dismissed/done
  → returns items sorted by urgency_score DESC
```

No separate sync cron. The queue is computed lazily at request time. Cache opportunistically using the existing in-memory route cache pattern (15s TTL).

### 6.3 State persistence

One new table, one new migration. The table tracks both user actions (snooze/dismiss/done) AND `firstSurfacedAt` per item, so the urgency engine can compute `freshness_decay` consistently across rebuilds:

```sql
CREATE TABLE decision_queue_state (
  id                  SERIAL PRIMARY KEY,
  "userId"            TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  item_key            TEXT NOT NULL,         -- "concentration_breach_severe:NVDA", "stale_rec_held:AMD", "outcome_action_mark:rec_abc123"
  status              TEXT,                  -- NULL = active/never acted on; or 'snoozed' | 'dismissed' | 'done'
  "firstSurfacedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "snoozeUntil"       TIMESTAMPTZ,
  dismiss_reason      TEXT,                  -- one of: 'already_handled' | 'disagree' | 'not_applicable' | 'other'
  surface_count       INTEGER NOT NULL DEFAULT 1,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("userId", item_key)
);
CREATE INDEX idx_dqs_user_status ON decision_queue_state("userId", status);
CREATE INDEX idx_dqs_snooze_expiry ON decision_queue_state("snoozeUntil") WHERE status = 'snoozed';
```

`item_key` is a deterministic string derived from item-type variant and primary identifier. `queue-builder.ts` upserts a row with `status=NULL` on every render where an item is generated; if a row already exists, `firstSurfacedAt` is preserved and `surface_count` is incremented. If the user later acts (snooze/dismiss/done), `status` is set accordingly. This single table covers both the action state and the freshness-tracking timestamp without a second table.

### 6.4 Display

The queue card shows up to 6 items by default, ranked by `urgency_score`. A row of horizon-count badges (`2 TODAY · 2 WEEK · 1 MONTH`) sits above the items. Below the visible items, an expand control reveals snoozed and dismissed items separately.

Per-item layout:

- Left border in horizon-color (`TODAY` red, `WEEK` rust, `MONTH` gold, `YEAR` green).
- Title bold, body small/grey, chip row beneath.
- Right-side horizon badge.
- Inline action buttons matching the headline's pattern (Open / Snooze / Dismiss).

Empty queue state: positive headline ("Nothing's urgent. Browse research candidates →") with CTA, not a blank slot.

---

## 7. Urgency Engine

A pure-function service, ~80 lines of TypeScript, located at `src/lib/dashboard/urgency.ts`. No AI, no database state of its own.

```
urgency_score = item_impact × time_decay × freshness_decay
```

| Component | Formula | Range |
|---|---|---|
| `item_impact` | Static weight from §6.1 table | 30–100 |
| `time_decay` | `1.0` if event ≤24h · `0.7` if 1–7d · `0.4` if 7–30d · `0.2` if 30–365d · `0.1` if no time component | 0.1–1.0 |
| `freshness_decay` | `1.0` if first surfaced today · `0.85` if 1–3d ago · `0.6` if 4–7d ago · `0.3` if older | 0.3–1.0 |

`firstSurfacedAt` is read from `decision_queue_state` (see §6.3). The first time `queue-builder` produces an item for a user, it upserts a row with `status=NULL`, capturing `firstSurfacedAt = NOW()`. On subsequent rebuilds, the existing `firstSurfacedAt` is preserved. This is independent of source-data timestamps so the freshness signal reflects when the *user* first saw the item, not when the underlying data was generated.

Top item by `urgency_score` becomes the Daily Headline. Tiebreaker: most recently surfaced wins (newer information first).

---

## 8. Horizon Tag Taxonomy

Tags are derived from `time_decay`, not stored:

| Tag | Trigger | Color |
|---|---|---|
| `TODAY` | event ≤24h, OR impact ≥90, OR broker auth blocking | `--sell` (deep wine) |
| `THIS_WEEK` | event 1–7d, OR stale rec on held position, OR outcome ask | `--decisive` (burnished rust) |
| `THIS_MONTH` | event 7–30d, OR cash deploy, OR rebalance drift | `--hold` (burnished gold) |
| `THIS_YEAR` | strategic items only (rebalance season, tax window, year-pace review) | `--buy` (forest green) |

`THIS_YEAR` is largely a stub in Phase 1 — most year-strategic items unlock in Phase 2 (goal glidepath, tax harvest). Phase 1 ships one Year-tagged item: `year_pace_review` showing portfolio MTD/YTD performance vs SPY benchmark, with impact 30 (low priority but always present).

A new `<HorizonChip>` component renders each badge with the appropriate color and label.

---

## 9. Layered Chips

The always-on metric row that serves the informed investor on the same surface as the average investor.

`<LayeredChipRow>` is a presentational component. Inputs: an array of `{ label: string, value: string, tooltip?: string }`. Renders as a flex row of small pills with the existing border/foreground tokens.

Tooltip definitions live in a static map at `src/lib/dashboard/chip-definitions.ts`:

```ts
export const CHIP_DEFINITIONS: Record<string, string> = {
  'TQ': 'Trade Quality score (0–100). Composite of Business Quality, Valuation, Technical Trend, Growth, Sentiment, Macro Fit, Insider/Events, weighted and penalized for missing data.',
  'conc': 'Concentration — this position as a percent of total portfolio value.',
  'consensus': 'How many of the three AI lenses (Value/Growth/Macro) agreed on the verdict.',
  // ...
};
```

This makes chips a teaching surface: average users hover and graduate into informed users without flipping a switch.

Chip taxonomy is **versioned** so Phase 2 can add new chips (`F-Score 7/9`, `Sharpe 1.4`, `12-1 mom +8%`, `regime CONTANGO`) without rewriting the rendering layer.

---

## 10. Reuse vs. New

| Capability | Reused | New in Phase 1 |
|---|---|---|
| Decision engine output (TQ, position sizing, verdict) | ✓ | — |
| Multi-model AI consensus | ✓ | — |
| Outcome evaluation cron (7d/30d/90d/365d) | ✓ | — |
| Portfolio Review "Next Move" output | ✓ — feeds queue | — |
| Risk Radar logic (concentration, regime) | ✓ — its outputs feed queue items | — |
| Risk Radar tile (visual on `/app`) | — | **Replaced** by queue items + macro context tile |
| `ticker_events` (earnings dates) | ✓ — feeds catalyst items | — |
| News/sentiment ingestion | ✓ — drill view | — |
| App shell, sidebar, nav | ✓ | — |
| Research view (verdict + lenses + supervisor) | ✓ — deep-link target | — |
| History / journal / pattern cards | ✓ | — |
| Disclaimer modal + banner | ✓ | — |
| `/app` homepage composition | — | **Replaced** |
| `<DailyHeadline>` component | — | **New** |
| `<DecisionQueue>` component | — | **New** |
| `<HorizonChip>` component | — | **New** |
| `<LayeredChipRow>` component | — | **New** |
| `decision_queue_state` table | — | **New (one migration)** |
| `urgency.ts` scoring service | — | **New (~80 lines)** |
| `queue-builder.ts` composer | — | **New (~250 lines)** |
| `headline-template.ts` template engine | — | **New (~150 lines)** |
| `headline_cache` column on `user_profile` | — | **New (additive migration)** |
| Daily 6am ET cron for headline rebuild | — | **New cron entry** |

Net new code: ~5 React components, 3 services, 2 small migrations, 1 cron. Everything else reused as-is.

---

## 11. Acceptance Criteria

1. `/app` p95 load <500ms with Daily Headline + Decision Queue + context tiles fully rendered, with broker data already cached.
2. Any user with ≥1 holding sees ≥3 queue items within 10s of broker sync completing for the first time.
3. Empty-broker user sees a research-driven headline + queue (sourced from their `recommendation` history). No awkward blank.
4. Brand-new user (no broker, no recommendations, no history) sees a positive empty-state headline with a "Run your first research →" CTA, not a blank panel.
5. Snooze and Dismiss actions persist across sessions; snoozed items resurface at next 6am cron after `snoozeUntil`; dismissed items are visible in the "Show dismissed" expand.
6. Each queue item's primary action deep-links to the existing surface for that item type (research / history / portfolio / settings).
7. Daily Headline body text contains zero LLM-generated prose. Every body string is template-rendered from structured data.
8. Demo user (`demo@clearpathinvest.app`) shows a meaningful Daily Headline + ≥3 queue items immediately on sign-in, without any manual seeding.
9. Mobile responsive: no horizontal scroll at 375px; queue cards stack cleanly; chips wrap.
10. Disclaimer banner ("informational only, not investment advice") visible on `/app`.
11. Existing `/app/r/[id]`, `/app/history`, `/app/portfolio`, `/app/research`, `/app/settings` routes unchanged.
12. Headline cache rebuild cron runs successfully against the production user base in <60s p95.

---

## 12. Open questions for implementation plan

These are scoped questions for the implementation plan, not the spec:

1. **Cache invalidation granularity** — when a user accepts a new disclaimer, marks an action, or runs new research, do we eagerly invalidate the headline cache or wait for the 6am rebuild? Recommended: eager invalidate on the user actions that change queue state.
2. **`item_key` collision strategy** — what if a user has two open `concentration_breach:NVDA` items separated by a snooze cycle? Recommended: re-use the same `item_key` but bump a `surfaceCount` counter for analytics.
3. **Chip rendering perf** — should `<LayeredChipRow>` memoize? At Phase 1 volumes (≤6 items × ≤5 chips), almost certainly no.
4. **Empty-state copy A/B** — do we want to ship two variants of the empty state and measure conversion to first research? Defer to Phase 2.
5. **Year-tag stub** — confirm we ship `year_pace_review` as the Phase 1 Year stub or leave Year tags entirely empty until Phase 2. Recommended: ship the stub — it makes the four-horizon framing visible from day one.

---

## 13. Phase 2 Appendix — Science Layer (forward-compatibility)

Phase 1 is designed to plug Phase 2 in without rework. The 14 algorithms approved during this brainstorm:

| # | Algorithm | Plug-in surface |
|---|-----------|-----------------|
| 1 | Fractional Kelly Position Sizing | New chip `Kelly ¼ = 3.2%`; modulates position-size guidance in research view |
| 2 | Piotroski F-Score | New chip `F 7/9` on Quality Card; new item type `quality_decline` if score drops |
| 3 | Sharpe / Sortino / Max Drawdown / Beta | New context tile in row 3 + drill view |
| 4 | 12-1 Momentum (Jegadeesh-Titman) | New chip `mom +8%`; component in decision engine |
| 5 | Tax-Loss Harvest + Wash-Sale | New item type `tax_harvest_window`; Year-tagged |
| 6 | VIX Term Structure Regime | New context tile (regime label) |
| 7 | Beneish M-Score | Bundled into Quality Card chip; gate on extreme values |
| 8 | Post-Earnings Drift (PEAD) | New item type `pead_setup` for mid-caps; Week-tagged |
| 9 | Goal Glidepath + Allocation Drift | New item type `rebalance_drift`; depends on Phase 3 goal inputs |
| 10 | Altman Z-Score | Bundled into Quality Card; hard "do not recommend" gate when Z<1.81 |
| 11 | Sloan Accruals | Bundled into Quality Card; comparative with Beneish |
| 12 | Market Regime Composite (VIX + put/call + FOMC + gamma) | Replaces #6 as standalone tile; modulates Kelly globally |
| 13 | CAPE / Buffett Indicator | New chip on macro context tile; Year-horizon valuation |
| 14 | Portfolio VaR / CVaR | New context tile; per-position drill |

**Build order:** #3 → #2/7/10/11 (Quality Card bundle) → #4 → #1 → #6/12 (Regime) → #13 → #14 → #5 → (later) #8 #9.

**v2 candidates (deferred, blocked):**
- Black-Litterman with AI views — blocked on (a) calibrated AI confidence intervals and (b) covariance matrix from Phase 2 #3.
- Risk Parity — Advisor-tier feature, blocked on multi-asset (bond/commodity) warehouse.

---

## 14. Phase 3 Appendix — Personal Layer (forward-compatibility)

Personalization unlocks once Phase 2 ships:

- **Goals onboarding** — target wealth, target date, risk tolerance dial → drives `concentration_cap_pct`, `glidepath_allocation`, `tax_horizon`.
- **Year-outlook surface** — full Year-horizon dashboard (currently a stub via `year_pace_review`).
- **Tax-window prompts** — long-term cap gains thresholds, wash-sale calendar, year-end harvest reminders.
- **Per-user chip preferences** — informed users can pin chips they care about; average users get a curated default set.

Phase 1 acceptance criteria #1–#12 should still hold after Phase 3 lands.

---

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Headline feels prescriptive, raising RIA-registration risk | Keep "informational only, not investment advice" banner. Templates use suggestion language ("Trim by ~2pp before…") not directives ("Sell X today"). Legal review of templates in §5.2 before ship. |
| Queue is empty for new users → looks broken | Positive empty-state copy (§6.4) with CTA. Onboarding hook surfaces "Run your first research" item as the headline for true new users. |
| Snooze infinity — user snoozes everything, queue is always empty | Snooze max is 1d in Phase 1. No "snooze 1 week" option in v1. Track `surfaceCount` per `item_key` for analytics. |
| Headline staleness — user opens app at 9pm, sees a headline picked at 6am that's already obsolete | Eager cache invalidation on user actions that change queue state (mark done, new research, broker reauth). Manual "refresh" button on the headline card as a backstop. |
| Demo user has no fresh queue items | Seed demo user with synthetic concentration_breach + stale_rec + outcome_action_mark items via a one-time data backfill in the migration. |
| Mobile chip overflow at 375px | Chips wrap; the `<LayeredChipRow>` truncates at 5 chips and shows a `+2 more` overflow chip with a tap-to-expand. |

---

## 16. Implementation outline (for the plan stage)

The implementation plan will sequence:

1. **Migration** — `decision_queue_state` table + `user_profile.headline_cache` and `user_profile.concentration_cap_pct` columns.
2. **Services layer** — `urgency.ts`, `queue-builder.ts`, `headline-template.ts`, `chip-definitions.ts`. Pure functions, fully unit-testable, zero AI calls.
3. **Components layer** — `<HorizonChip>`, `<LayeredChipRow>`, `<DailyHeadline>`, `<DecisionQueue>`. Storybook-style stories validate each in isolation.
4. **Page composition** — new `/app/page.tsx` composing the three sections + context tiles row.
5. **API routes** — `POST /api/queue/snooze`, `POST /api/queue/dismiss`, `POST /api/queue/done`, `POST /api/queue/headline-refresh`.
6. **Cron** — `/api/cron/headline-rebuild` daily 11:00 UTC.
7. **Demo data** — one-time seed for `demo@clearpathinvest.app` to ensure the homepage demo is meaningful.
8. **Acceptance pass** — verify each AC #1–#12 manually + add an `e2e-smoke` category for the homepage.

---

**End of Phase 1 design.**
