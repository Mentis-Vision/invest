# App Flow + Journal Redesign — Design Spec

**Date:** 2026-04-19
**Status:** Approved in brainstorming, ready for implementation plan
**Problem:** The five-tab app lacks a narrative. Users (starting with the
founder) can't tell how the screens connect — Research verdicts differ from
History rows on the same ticker with no explanation, Track Record shows
recommendations on stocks the user doesn't own, and Strategy is a separate
tab instead of a daily landing surface.

## 1. Core purpose

ClearPath's daily surface is a **professional morning briefing with
immediate action** (the A+B pattern from brainstorming). Every time a user
opens the app, they should see:

- What changed overnight in their portfolio and the market.
- The single next move we think is worth considering.
- Enough context to decide without navigating elsewhere.

Everything else in the IA supports this primary loop.

## 2. Information architecture

### Tabs: 5 → 4

| Tab | User question | Primary surface |
|---|---|---|
| **Dashboard** | "What changed + what should I do?" | Next Move hero, portfolio summary, alerts, news, events, top movers |
| **Portfolio** | "What do I own?" | Grouped holdings (institution, account type, sector) with drill panel |
| **Research** | "Should I buy/sell ticker X?" | Ticker input + live verdict; "Your past calls on this ticker" strip at top; "Recent searches" strip |
| **Journal** | "What did I do and how did it turn out?" | Rows of actions taken; notes; outcomes; counterfactual comparisons |

**Strategy tab is deprecated.** Its full multi-lens content moves inline on
the Dashboard under a "See the full brief ↓" toggle on the Next Move hero.
No content is lost; the tab itself goes away to consolidate the morning
landing into one surface.

**History → Journal rename.** The page now shows only rows where the user
recorded an action (took / partial / ignored / opposed / ad hoc). Un-acted
Research queries move to the Research page's "Recent searches" strip.

### Cross-linking rules

- Dashboard Next Move → Full brief expands inline (no navigation).
- Dashboard compact counterfactual strip → scrolls to Journal row.
- Research result header → "Your past calls on this ticker" strip with
  dates + verdicts + a "Run fresh" button on stale rows.
- Journal row → "Open full recommendation →" link to source rec.
- Alerts on Dashboard → click drills directly to Research prefilled with
  the flagged ticker.

## 3. Dashboard Next Move card

The single most important surface in the app. Answers "what should I do?"
in one glance.

**Structure, top to bottom:**

1. Header strip: `⚡ NEXT MOVE · TODAY` + priority badge (HIGH · MEDIUM · CONSIDER).
2. Action title — the sentence ("↘ Reduce LINK to 25% of portfolio").
3. Rationale — one-line why, with a nod to which lens (or lenses) agreed.
4. **Pre-populated quick-scan strip** (zero click, zero AI cost):
   - Ticker · name · current price · day % change · `Full research →`.
   - Five-column grid: 52w range · your avg · unrealized P&L · 30d move · RSI(14).
   - One-line latest headline from the press feed.
5. **Action chips:** `✓ I did this` · `~ I did some` · `⏰ Snooze today` · `× Dismiss`.
6. **See the full brief ↓** — inline expansion of the old Strategy content:
   Portfolio health · Where lenses agreed · Red flags · Other actions · Per-lens panels.

**State transitions:**

- **Done:** hero flips to a compact "Done ✓ · trimmed 15%" confirmation tile with Undo.
- **Snoozed:** hero collapses to a thin strip; re-appears on tomorrow's row.
- **Dismissed:** hero hides for the rest of the day.
- **Empty state (no action needed):** shows "Steady as you are" card — no chips.

**Fallbacks:**

- Non-ticker-specific Next Moves (e.g. "rebalance sector exposure") hide
  the quick-scan strip but keep rationale + chips.
- Data-strip read errors fail silently — show the rest of the hero.

## 4. Action modal flow

Clicking any action chip except Snooze opens a modal. Notes are **always
optional but always offered** — the modal opens with a blank note field
and "Save" accepts an empty note.

| Chip | Modal fields | Save produces |
|---|---|---|
| `✓ I did this` | `Why / what you did · (optional)` textarea | `userAction=took`, `userNote`, `actionAt=now` |
| `~ I did some` | `How much did you actually do?` one-line; `Why that amount? · (optional)` textarea | `userAction=partial`, `userAmount`, `userNote` |
| `× Dismiss` | `Why? · (helps your pattern insights)` textarea | `userAction=ignored`, `userNote` |
| `⏰ Snooze today` | **No modal** | No journal entry; state-only flip |

On save: toast `Added to Journal →` bottom-right; hero flips to confirmed
state with an `Undo` link that deletes the journal row and reverts state.

### Unified action data model

Today we have two disconnected action systems — `portfolio_review_daily.nextMoveState`
for Strategy chips and `recommendation.userAction/Note` for Research recs.
This design **unifies them**: every acted-on recommendation (Strategy or
Research origin) produces a row the Journal reads. Implementation approach
(a vs b below is a plan-phase decision; design doesn't mandate):

- **Approach a:** add `source` (`strategy` | `research`) and
  `sourcePortfolioReviewDate` columns to `recommendation`; Strategy
  actions write new rows there.
- **Approach b:** create a `journal_entry` table that references either
  `recommendation` or `portfolio_review_daily` via a nullable FK pair.

Either works. Plan should pick based on query patterns.

## 5. Journal page

Appears in the nav as **Journal** (renamed from Track Record / History).

**Page sections, top to bottom:**

1. **Title + stat card** (30-day): Recommendations · BUY/HOLD/SELL mix · Hit rate · You acted on · Your follow-through %.
2. **Behavioral patterns** (90-day rolling): Missed opportunities · Over-reach · BUY follow-through rate. Threshold-gated empty state for sparse journals.
3. **Action-outcome crosstab**: 2×2 "You acted + won/lost" / "You skipped + won/lost" with follow-through + skip-accuracy rates.
4. **Notes revisited** (reflection): pulls 21–45-day-old notes with current outcome. Renders nothing when no eligible rows.
5. **Filter bar + CSV export**: All · Wins · Losses · You acted · Not marked · + ticker search. Export button top-right.
6. **Journal rows** — one per acted recommendation. Row chip shows action type; expand reveals:
   - Full recommendation text + price at rec.
   - User's note.
   - **Counterfactual three-bar visualization** (§7).
   - Reconciliation state chip (§6).
   - `Open full recommendation →` link.

**What changes from today:**

- Un-acted Research queries are no longer rendered.
- Strategy Next Move actions start rendering.
- Counterfactual widget appears on expanded rows.
- Page title swaps to "Journal."

## 6. Reconciliation: self-report vs actual + orphan trades

Three sources of truth:

- **Recommendation** (what we said).
- **Self-report** (what the user said they did via the modal).
- **Actual trade** (what the broker shows — SnapTrade + Plaid synced overnight).

### Reconciliation algorithm

Runs as a nightly cron step after broker syncs complete. For each new
trade in the last 48 hours on a ticker with an active recommendation:

1. Find the matching journal entry by `(userId, ticker, direction, within rec date window)`.
2. Compare `selfReportedAmount` vs `actualAmount` (as % of position changed).
3. Bucket into one of five states:

| State | Trigger | UI |
|---|---|---|
| `verified` | Within ±10% of self-reported | Green ✓ badge |
| `mismatch_more` | Actual > self-reported by >10% | Amber ⚠ "You actually did more" |
| `mismatch_less` | Actual < self-reported by >10% | Amber ⚠ "You actually did less" |
| `self_reported_only` | No matching trade yet | Grey clock 🕐 "Awaiting broker confirmation" |
| `actual_only` | Broker trade with no self-report | Auto-creates an `ad_hoc` journal row |

Thresholds (±10%, 48-hour match window) are **first-pass**. Revisit once
real data flows.

### Reconciliation UI on a journal row

- Amber-state row: click the warning → mini modal *"Your broker shows you
  sold 25% of LINK, but you reported 15%. Update the journal?"* — `Update` or `Keep as is; extra trade is different`.
- Accepting `Update` replaces `selfReportedAmount` with the actual value
  and recomputes the counterfactual.

### Orphan / ad-hoc trades

Broker syncs also create auto-rows for trades that don't match any open
recommendation. Example: user sells 50 NVDA + buys 40 MSFT with no prior
recommendation.

Ad-hoc rows:

- Carry an "Ad hoc" chip — distinct from took/partial/ignored.
- Get an **optional note** field the user can fill in after the fact.
- Show no counterfactual bar chart (nothing to compare against).
- Still affect OTHER recommendations' counterfactuals — they change
  position + cash, which propagates through the portfolio-value math.

## 7. Counterfactual visualization

**Three paths of portfolio value from rec date through today:**

| Path | Definition | Computation |
|---|---|---|
| If you ignored | Pre-rec position held unchanged | Starting shares × daily close, per day |
| Your actual path | Position after the actual trade(s) | Pre-rec minus trades + cash from sells, valued daily |
| If you'd fully followed | Position if recommendation executed in full | Pre-rec adjusted to recommended target, valued daily |

**Data sources (all free, already in the warehouse):**

- Daily closes: `ticker_market_daily`.
- Position before rec: `portfolio_snapshot` on the rec date.
- Actual trades: `trade` (SnapTrade) + `plaid_transaction` (Plaid).

**Simplifying assumptions, surfaced as a fidelity tag on every card:**

> *Directional only. Does not account for taxes, fees, or where you
> redeployed the proceeds.*

- Cash from sells sits in cash (not redeployed into the "following" scenario).
- No tax drag (short-term vs long-term cap gains) modeled.
- No broker fees modeled.
- Crypto: daily close; ignores intraday volatility.
- Options: not supported in v1 (too many parameters). Counterfactual
  hidden for option trades.

**Rendering:**

- **Dashboard (compact):** single line under the Next Move hero once an
  action is logged — *"You trimmed LINK 4 days ago → +$180 vs doing nothing · Full review →"*. Link scrolls to the Journal row.
- **Journal (full):** three horizontal bars with $ or % delta at the end
  of each. Time selector: `7d · 30d · 90d · since action`. Default: `since action`.

**Edge cases:**

- < 2 daily closes since rec: hide chart, show placeholder ("Counterfactual ready tomorrow").
- Non-ticker-specific recs: hide the counterfactual (no single-ticker baseline).
- Ad-hoc orphan trades: no counterfactual.
- Option trades: hidden in v1.

## 8. Data model changes

The implementation plan will enumerate migrations, but these are the
known changes:

- **Unified journal** — either extend `recommendation` with `source` and
  `sourcePortfolioReviewDate` OR introduce `journal_entry` table.
  Plan-phase decision.
- **Journal entry additions**: `selfReportedAmount` (text), `actualAmount`
  (numeric), `reconciliationStatus` (enum), `reconciledAt` (timestamp),
  `isAdHoc` (bool).
- **Ad-hoc auto-creation** logic in the nightly cron.
- **Counterfactual computation** uses existing tables (`ticker_market_daily`,
  `portfolio_snapshot`, `trade`, `plaid_transaction`) — no new schema required.

## 9. Deprecations

- **`/app?view=strategy` route:** removed from nav. The page-level component
  may remain temporarily as the inline "full brief" panel source, but the
  tab and direct URL go away.
- **`portfolio_review_daily.nextMoveState`** is migrated into the unified
  journal; column can be removed after the migration lands and data is
  backfilled.
- **History page title** renames to Journal; any external docs that
  reference "Track Record" should be updated.

## 10. Out of scope / parked

- Full multi-time-horizon counterfactual charts (only 3-bar for v1).
- Tax-aware counterfactual adjustments.
- Options support in counterfactual.
- "What if I'd bought instead" counterfactuals on ad-hoc trades.
- Notifications when a mismatch reconciliation becomes stale (7+ days unreviewed).
- Public-shareable journal summaries (future social proof feature).

These are tracked here so the implementation plan stays focused on v1.

## 11. Success criteria

After shipping, a user should be able to:

1. Open the app and see one clear next move with enough data to decide.
2. Act (or not act) and have that action persist as a journal entry.
3. See the IMPACT of their action visualized against counterfactuals.
4. Discover mismatches between self-report and actual trades automatically.
5. See every portfolio change — whether recommended or ad-hoc — in one journal.
6. Never be confused about why Research and Journal show different verdicts
   on the same ticker (explicit point-in-time labeling + "Run fresh" link).

The founder's three original concerns (Research ≠ History, recs on
non-held stocks, flow doesn't make sense) are all resolved by this
design.
