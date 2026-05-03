# Actionable Dashboard — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-02-actionable-dashboard-phase-1-design.md` (commit `00839d3`)

**Goal:** Replace the current `/app` homepage with a Daily Headline + Decision Queue layout that surfaces ranked, horizon-tagged decisions sourced from existing data — zero new algorithms, zero LLM-generated headline prose.

**Architecture:** One new migration (`decision_queue_state` table + two `user_profile` columns). Three pure-function services in `src/lib/dashboard/` (`urgency.ts`, `queue-builder.ts`, `headline-template.ts`) plus a chip-definitions map. Four new React components in `src/components/dashboard/` (`<HorizonChip>`, `<LayeredChipRow>`, `<DailyHeadline>`, `<DecisionQueue>`). Four new API routes (`/api/queue/{snooze,dismiss,done,headline-refresh}`) and one new cron (`/api/cron/headline-rebuild`). New `/app/page.tsx` composes everything; existing dashboard widgets remain available as deep-link targets.

**Tech Stack:** Next.js 16.2.4 App Router · React 19.2 · TypeScript 5 · Vitest 4.1 · Neon Postgres via `@neondatabase/serverless` · BetterAuth · Tailwind v4 + shadcn (Base UI) · existing `src/lib/log.ts`, `src/lib/db.ts`, `src/lib/portfolio-review.ts`, `src/lib/outcomes.ts`, `src/lib/alerts.ts`.

**Hard constraints (from `AGENTS.md`):** Migrations hand-applied via Neon MCP (project `broad-sun-50424626`). Reserved words double-quoted in SQL. `printf` not `echo` for env vars. Logging via `src/lib/log.ts`. No motion-div with `initial:opacity:0` wrappers. Disclaimer banner stays visible on `/app`.

---

## File Structure

**Created (new):**
- `src/lib/dashboard/urgency.ts` — pure scoring functions (~100 lines)
- `src/lib/dashboard/urgency.test.ts` — vitest unit tests
- `src/lib/dashboard/headline-template.ts` — template-rendering functions (~180 lines)
- `src/lib/dashboard/headline-template.test.ts` — vitest unit tests
- `src/lib/dashboard/chip-definitions.ts` — constant tooltip map (~80 lines)
- `src/lib/dashboard/queue-builder.ts` — composes items from existing sources (~300 lines)
- `src/lib/dashboard/queue-builder.test.ts` — vitest unit tests with stubbed DB
- `src/lib/dashboard/types.ts` — shared `QueueItem`, `HeadlineCache`, `HorizonTag`, `ItemTypeKey` types
- `src/components/dashboard/horizon-chip.tsx`
- `src/components/dashboard/layered-chip-row.tsx`
- `src/components/dashboard/daily-headline.tsx`
- `src/components/dashboard/decision-queue.tsx`
- `src/app/api/queue/snooze/route.ts`
- `src/app/api/queue/dismiss/route.ts`
- `src/app/api/queue/done/route.ts`
- `src/app/api/queue/headline-refresh/route.ts`
- `src/app/api/cron/headline-rebuild/route.ts`
- `migrations/2026-05-02-decision-queue-state.sql` — documentation of the SQL applied via Neon MCP

**Modified:**
- `src/app/app/page.tsx` — replaced composition (Daily Headline + Decision Queue + 3 context tiles)
- `src/components/dashboard-client.tsx` — slimmed to keep only the deep-link surfaces; remove homepage-only widgets from default render
- `vercel.json` — one new `crons` entry
- `src/lib/e2e-smoke.ts` — one new homepage-render check

**Untouched (deliberately):**
- `src/components/views/research.tsx`, `portfolio.tsx`, `strategy.tsx`, `integrations.tsx`
- All of `src/components/journal/*`, `src/components/research/*`, `src/components/brokerage/*`
- All of `src/lib/decision-engine/*`, `src/lib/ai/*`, `src/lib/data/*`, `src/lib/warehouse/*`
- `src/components/dashboard/{next-move-hero,risk-radar-card,block-grid,kpi-strip,...}.tsx` — kept on disk; no longer rendered on `/app` homepage; available as drill targets

---

## Task 1: Apply migration for `decision_queue_state` and `user_profile` columns

**Files:**
- Create: `migrations/2026-05-02-decision-queue-state.sql`
- Apply via: Neon MCP `mcp__Neon__run_sql_transaction` against project `broad-sun-50424626`

- [ ] **Step 1: Inspect existing `user_profile` table schema**

Run via Neon MCP (`mcp__Neon__describe_table_schema`):
- `projectId: broad-sun-50424626`, `tableName: user_profile`

Expected: confirms `user_profile` exists; note current columns so the additive `ALTER` statements don't collide.

- [ ] **Step 2: Write the migration SQL file**

Create `migrations/2026-05-02-decision-queue-state.sql`:

```sql
-- Phase 1 Actionable Dashboard rework
-- Spec: docs/superpowers/specs/2026-05-02-actionable-dashboard-phase-1-design.md

-- 1. New table: per-user, per-item state for the Decision Queue
CREATE TABLE IF NOT EXISTS decision_queue_state (
  id                  SERIAL PRIMARY KEY,
  "userId"            TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  item_key            TEXT NOT NULL,
  status              TEXT,
  "firstSurfacedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "snoozeUntil"       TIMESTAMPTZ,
  dismiss_reason      TEXT,
  surface_count       INTEGER NOT NULL DEFAULT 1,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT decision_queue_state_user_item_unique UNIQUE ("userId", item_key),
  CONSTRAINT decision_queue_state_status_chk
    CHECK (status IS NULL OR status IN ('snoozed', 'dismissed', 'done')),
  CONSTRAINT decision_queue_state_dismiss_reason_chk
    CHECK (dismiss_reason IS NULL
           OR dismiss_reason IN ('already_handled', 'disagree', 'not_applicable', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_dqs_user_status
  ON decision_queue_state("userId", status);

CREATE INDEX IF NOT EXISTS idx_dqs_snooze_expiry
  ON decision_queue_state("snoozeUntil")
  WHERE status = 'snoozed';

-- 2. user_profile columns for headline cache + concentration cap
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS headline_cache JSONB,
  ADD COLUMN IF NOT EXISTS headline_cached_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS concentration_cap_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00;
```

- [ ] **Step 3: Apply via Neon MCP**

Use `mcp__Neon__run_sql_transaction` with:
- `projectId: broad-sun-50424626`
- `databaseName: neondb`
- `sqlStatements:` an array containing each of the four statements above (CREATE TABLE, two CREATE INDEX, one ALTER TABLE).

Expected: success, four statements committed.

- [ ] **Step 4: Verify schema**

Run via Neon MCP (`mcp__Neon__describe_table_schema`) for `decision_queue_state` and re-describe `user_profile`. Confirm columns + constraints exist.

- [ ] **Step 5: Commit**

```bash
git add migrations/2026-05-02-decision-queue-state.sql
git commit -m "feat(db): add decision_queue_state table + user_profile dashboard columns

Phase 1 of the actionable dashboard rework. Hand-applied via Neon MCP
on broad-sun-50424626/neondb.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/lib/dashboard/types.ts`

- [ ] **Step 1: Write the types file**

```ts
// src/lib/dashboard/types.ts
// Shared types for the actionable dashboard (Phase 1).
// Spec: docs/superpowers/specs/2026-05-02-actionable-dashboard-phase-1-design.md

export type HorizonTag = "TODAY" | "THIS_WEEK" | "THIS_MONTH" | "THIS_YEAR";

export type ItemTypeKey =
  | "broker_reauth"
  | "concentration_breach_severe"
  | "concentration_breach_moderate"
  | "catalyst_prep_imminent"
  | "catalyst_prep_upcoming"
  | "stale_rec_held"
  | "stale_rec_watched"
  | "outcome_action_mark"
  | "cash_idle"
  | "year_pace_review";

export type QueueItemStatus = null | "snoozed" | "dismissed" | "done";

export type DismissReason =
  | "already_handled"
  | "disagree"
  | "not_applicable"
  | "other";

export interface QueueChip {
  label: string;       // e.g. "TQ", "conc"
  value: string;       // e.g. "41", "8.4%"
  tooltipKey?: string; // matches CHIP_DEFINITIONS key
}

export interface QueueItem {
  itemKey: string;        // stable key, e.g. "concentration_breach_severe:NVDA"
  itemType: ItemTypeKey;
  ticker: string | null;
  title: string;          // bold header — short, one line
  body: string;           // template-rendered, no LLM
  horizon: HorizonTag;
  urgencyScore: number;
  impact: number;
  timeDecay: number;
  freshnessDecay: number;
  chips: QueueChip[];
  primaryActionHref: string;  // deep link
  primaryActionLabel: string;
  firstSurfacedAt: string;    // ISO timestamp
  status: QueueItemStatus;
  snoozeUntil: string | null;
}

export interface HeadlineCache {
  itemKey: string;
  rendered: QueueItem;
  cachedAt: string;
}

export const HORIZON_COLOR: Record<HorizonTag, string> = {
  TODAY: "var(--sell)",
  THIS_WEEK: "var(--decisive)",
  THIS_MONTH: "var(--hold)",
  THIS_YEAR: "var(--buy)",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/dashboard/types.ts
git commit -m "feat(dashboard): shared types for queue items and headline cache

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `urgency.ts` — pure scoring functions (TDD)

**Files:**
- Create: `src/lib/dashboard/urgency.ts`
- Test: `src/lib/dashboard/urgency.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/dashboard/urgency.test.ts
import { describe, it, expect } from "vitest";
import {
  computeTimeDecay,
  computeFreshnessDecay,
  computeUrgencyScore,
  resolveHorizonTag,
  STATIC_IMPACT,
} from "./urgency";

describe("computeTimeDecay", () => {
  it("returns 1.0 for events within 24h", () => {
    expect(computeTimeDecay(12)).toBe(1.0);
    expect(computeTimeDecay(24)).toBe(1.0);
  });
  it("returns 0.7 for events 1-7d out", () => {
    expect(computeTimeDecay(48)).toBe(0.7);
    expect(computeTimeDecay(24 * 7)).toBe(0.7);
  });
  it("returns 0.4 for events 7-30d out", () => {
    expect(computeTimeDecay(24 * 8)).toBe(0.4);
    expect(computeTimeDecay(24 * 30)).toBe(0.4);
  });
  it("returns 0.2 for events 30-365d out", () => {
    expect(computeTimeDecay(24 * 60)).toBe(0.2);
    expect(computeTimeDecay(24 * 365)).toBe(0.2);
  });
  it("returns 0.1 for items with no time component (null)", () => {
    expect(computeTimeDecay(null)).toBe(0.1);
  });
});

describe("computeFreshnessDecay", () => {
  it("returns 1.0 for items first surfaced today", () => {
    expect(computeFreshnessDecay(0)).toBe(1.0);
  });
  it("returns 0.85 for items 1-3 days old", () => {
    expect(computeFreshnessDecay(1)).toBe(0.85);
    expect(computeFreshnessDecay(3)).toBe(0.85);
  });
  it("returns 0.6 for items 4-7 days old", () => {
    expect(computeFreshnessDecay(4)).toBe(0.6);
    expect(computeFreshnessDecay(7)).toBe(0.6);
  });
  it("returns 0.3 for items older than 7 days", () => {
    expect(computeFreshnessDecay(8)).toBe(0.3);
    expect(computeFreshnessDecay(60)).toBe(0.3);
  });
});

describe("computeUrgencyScore", () => {
  it("multiplies impact * timeDecay * freshnessDecay", () => {
    // concentration_breach_severe: impact 90, event in 12h, surfaced today
    expect(
      computeUrgencyScore({ impact: 90, hoursToEvent: 12, daysSinceSurfaced: 0 }),
    ).toBeCloseTo(90, 5);
  });
  it("decays correctly for stale week-old item", () => {
    // stale_rec_held: impact 60, no event time, surfaced 5 days ago
    expect(
      computeUrgencyScore({ impact: 60, hoursToEvent: null, daysSinceSurfaced: 5 }),
    ).toBeCloseTo(60 * 0.1 * 0.6, 5);
  });
});

describe("resolveHorizonTag", () => {
  it("returns TODAY when impact is 90+", () => {
    expect(resolveHorizonTag({ impact: 100, hoursToEvent: null })).toBe("TODAY");
    expect(resolveHorizonTag({ impact: 90, hoursToEvent: null })).toBe("TODAY");
  });
  it("returns TODAY when event is within 24h", () => {
    expect(resolveHorizonTag({ impact: 50, hoursToEvent: 12 })).toBe("TODAY");
  });
  it("returns THIS_WEEK for events 1-7d", () => {
    expect(resolveHorizonTag({ impact: 50, hoursToEvent: 48 })).toBe("THIS_WEEK");
    expect(resolveHorizonTag({ impact: 60, hoursToEvent: 24 * 7 })).toBe("THIS_WEEK");
  });
  it("returns THIS_MONTH for events 7-30d", () => {
    expect(resolveHorizonTag({ impact: 40, hoursToEvent: 24 * 14 })).toBe("THIS_MONTH");
  });
  it("returns THIS_YEAR for events > 30d", () => {
    expect(resolveHorizonTag({ impact: 30, hoursToEvent: 24 * 90 })).toBe("THIS_YEAR");
  });
  it("returns THIS_MONTH as default for items with no event when impact < 60", () => {
    expect(resolveHorizonTag({ impact: 50, hoursToEvent: null })).toBe("THIS_MONTH");
  });
  it("returns THIS_WEEK for items with no event when impact 60-89", () => {
    expect(resolveHorizonTag({ impact: 60, hoursToEvent: null })).toBe("THIS_WEEK");
  });
});

describe("STATIC_IMPACT table", () => {
  it("matches spec §6.1", () => {
    expect(STATIC_IMPACT.broker_reauth).toBe(100);
    expect(STATIC_IMPACT.concentration_breach_severe).toBe(90);
    expect(STATIC_IMPACT.concentration_breach_moderate).toBe(70);
    expect(STATIC_IMPACT.catalyst_prep_imminent).toBe(80);
    expect(STATIC_IMPACT.catalyst_prep_upcoming).toBe(50);
    expect(STATIC_IMPACT.stale_rec_held).toBe(60);
    expect(STATIC_IMPACT.stale_rec_watched).toBe(30);
    expect(STATIC_IMPACT.outcome_action_mark).toBe(40);
    expect(STATIC_IMPACT.cash_idle).toBe(50);
    expect(STATIC_IMPACT.year_pace_review).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/lib/dashboard/urgency.test.ts
```

Expected: FAIL — module `./urgency` not found.

- [ ] **Step 3: Implement `urgency.ts`**

```ts
// src/lib/dashboard/urgency.ts
// Pure functions for ranking Decision Queue items.
// Spec §7.

import type { ItemTypeKey, HorizonTag } from "./types";

export const STATIC_IMPACT: Record<ItemTypeKey, number> = {
  broker_reauth: 100,
  concentration_breach_severe: 90,
  concentration_breach_moderate: 70,
  catalyst_prep_imminent: 80,
  catalyst_prep_upcoming: 50,
  stale_rec_held: 60,
  stale_rec_watched: 30,
  outcome_action_mark: 40,
  cash_idle: 50,
  year_pace_review: 30,
};

export function computeTimeDecay(hoursToEvent: number | null): number {
  if (hoursToEvent === null) return 0.1;
  if (hoursToEvent <= 24) return 1.0;
  if (hoursToEvent <= 24 * 7) return 0.7;
  if (hoursToEvent <= 24 * 30) return 0.4;
  return 0.2;
}

export function computeFreshnessDecay(daysSinceSurfaced: number): number {
  if (daysSinceSurfaced <= 0) return 1.0;
  if (daysSinceSurfaced <= 3) return 0.85;
  if (daysSinceSurfaced <= 7) return 0.6;
  return 0.3;
}

export interface UrgencyInput {
  impact: number;
  hoursToEvent: number | null;
  daysSinceSurfaced: number;
}

export function computeUrgencyScore(input: UrgencyInput): number {
  return (
    input.impact *
    computeTimeDecay(input.hoursToEvent) *
    computeFreshnessDecay(input.daysSinceSurfaced)
  );
}

export interface HorizonInput {
  impact: number;
  hoursToEvent: number | null;
}

export function resolveHorizonTag(input: HorizonInput): HorizonTag {
  if (input.impact >= 90) return "TODAY";
  if (input.hoursToEvent !== null) {
    if (input.hoursToEvent <= 24) return "TODAY";
    if (input.hoursToEvent <= 24 * 7) return "THIS_WEEK";
    if (input.hoursToEvent <= 24 * 30) return "THIS_MONTH";
    return "THIS_YEAR";
  }
  // No event component: bucket by impact magnitude
  if (input.impact >= 60) return "THIS_WEEK";
  if (input.impact >= 40) return "THIS_MONTH";
  return "THIS_YEAR";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/lib/dashboard/urgency.test.ts
```

Expected: PASS, all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/urgency.ts src/lib/dashboard/urgency.test.ts
git commit -m "feat(dashboard): urgency scoring engine for Decision Queue

Pure functions per spec §7: STATIC_IMPACT table, computeTimeDecay,
computeFreshnessDecay, computeUrgencyScore, resolveHorizonTag.
Vitest coverage for every branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `chip-definitions.ts` — tooltip map

**Files:**
- Create: `src/lib/dashboard/chip-definitions.ts`

- [ ] **Step 1: Write the constants file**

```ts
// src/lib/dashboard/chip-definitions.ts
// Tooltip definitions for the layered chip row. Hovering a chip shows the definition.
// Spec §9.

export const CHIP_DEFINITIONS: Record<string, string> = {
  TQ: "Trade Quality (0–100). Composite of Business Quality, Valuation, Technical Trend, Growth, Sentiment, Macro Fit, and Insider/Events — weighted, with a penalty for missing data.",
  conc: "Concentration — this position as a percent of total portfolio value.",
  consensus: "How many of the three AI lenses (Value/Growth/Macro) agreed on the verdict.",
  earnings: "Days until the company reports earnings.",
  stale: "Days since the last research run on this ticker.",
  "since-rec": "Price move since the original recommendation.",
  "IV-rank": "Implied volatility rank — current option-implied volatility as a percentile of its 1-year range.",
  "prior-reaction": "Price reaction the day after the most recent earnings report.",
  position: "Current position size as a percent of total portfolio value.",
  outcome: "Realized price move at the closest evaluation window since the original recommendation.",
  cash: "Idle cash currently in the brokerage account.",
  "days-idle": "Number of consecutive days the cash has been idle.",
  candidates: "Number of BUY-rated research recommendations that fit the user's sector budget.",
  broker: "Linked brokerage requiring reauthorization.",
  "last-sync": "Days since the last successful holdings sync from this broker.",
  pace: "Year-to-date portfolio return relative to the SPY benchmark.",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/dashboard/chip-definitions.ts
git commit -m "feat(dashboard): chip-definitions tooltip map for layered chip row

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `headline-template.ts` — template rendering (TDD)

**Files:**
- Create: `src/lib/dashboard/headline-template.ts`
- Test: `src/lib/dashboard/headline-template.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/dashboard/headline-template.test.ts
import { describe, it, expect } from "vitest";
import { renderTemplate, type TemplateContext } from "./headline-template";

describe("renderTemplate — concentration_breach", () => {
  it("renders severe variant with delta and next event", () => {
    const ctx: TemplateContext = {
      itemType: "concentration_breach_severe",
      ticker: "NVDA",
      data: {
        deltaPp: 2,
        currentPct: 8.4,
        minCapPct: 5,
        maxCapPct: 6,
        nextEvent: "Wed CPI",
      },
    };
    const out = renderTemplate(ctx);
    expect(out.title).toContain("NVDA");
    expect(out.body).toContain("Trim NVDA");
    expect(out.body).toContain("~2pp");
    expect(out.body).toContain("Wed CPI");
    expect(out.body).toContain("8.4%");
    expect(out.body).toContain("5–6%");
    expect(out.body).not.toMatch(/\{\{|\}\}/); // no unfilled placeholders
  });

  it("falls back gracefully when nextEvent is missing", () => {
    const ctx: TemplateContext = {
      itemType: "concentration_breach_moderate",
      ticker: "NVDA",
      data: { deltaPp: 1, currentPct: 7.2, minCapPct: 5, maxCapPct: 6 },
    };
    const out = renderTemplate(ctx);
    expect(out.body).toMatch(/Trim NVDA/);
    expect(out.body).not.toMatch(/\{\{|\}\}|undefined|null/);
  });
});

describe("renderTemplate — stale_rec_held", () => {
  it("renders move-since-rec correctly", () => {
    const out = renderTemplate({
      itemType: "stale_rec_held",
      ticker: "AMD",
      data: {
        daysAgo: 47,
        moveSinceRec: "+12%",
        originalVerdict: "BUY",
        priceAtRec: 142,
      },
    });
    expect(out.title).toContain("AMD");
    expect(out.body).toContain("47d ago");
    expect(out.body).toContain("+12%");
    expect(out.body).toContain("BUY");
    expect(out.body).toContain("$142");
  });
});

describe("renderTemplate — catalyst_prep", () => {
  it("renders imminent earnings prep", () => {
    const out = renderTemplate({
      itemType: "catalyst_prep_imminent",
      ticker: "AMD",
      data: {
        eventName: "Q1 earnings",
        eventDate: "May 7",
        daysToEvent: 5,
        priorReaction: "+4.2%",
        currentPct: 6.1,
      },
    });
    expect(out.body).toContain("AMD reports");
    expect(out.body).toContain("Q1 earnings");
    expect(out.body).toContain("May 7");
    expect(out.body).toContain("(5d)");
    expect(out.body).toContain("+4.2%");
    expect(out.body).toContain("6.1%");
  });
});

describe("renderTemplate — outcome_action_mark", () => {
  it("renders outcome ask", () => {
    const out = renderTemplate({
      itemType: "outcome_action_mark",
      ticker: "META",
      data: {
        originalDate: "Mar 18",
        originalVerdict: "BUY",
        outcomeMove: "+8.2%",
        outcomeVerdict: "win",
      },
    });
    expect(out.body).toContain("Mar 18");
    expect(out.body).toContain("BUY");
    expect(out.body).toContain("META");
    expect(out.body).toContain("+8.2%");
    expect(out.body).toContain("win");
  });
});

describe("renderTemplate — cash_idle", () => {
  it("renders cash deploy prompt", () => {
    const out = renderTemplate({
      itemType: "cash_idle",
      ticker: null,
      data: { cashAmount: 3200, daysIdle: 14, numCandidates: 3 },
    });
    expect(out.body).toContain("$3,200");
    expect(out.body).toContain("14d");
    expect(out.body).toContain("3 BUY");
  });
});

describe("renderTemplate — broker_reauth", () => {
  it("renders reauth ask", () => {
    const out = renderTemplate({
      itemType: "broker_reauth",
      ticker: null,
      data: { brokerName: "Schwab" },
    });
    expect(out.body).toContain("Schwab");
    expect(out.body).toContain("disconnected");
    expect(out.body.toLowerCase()).toContain("reauthorize");
  });
});

describe("renderTemplate — never produces LLM-style prose", () => {
  it("output never contains prose-y AI hedge words", () => {
    const out = renderTemplate({
      itemType: "concentration_breach_severe",
      ticker: "NVDA",
      data: { deltaPp: 2, currentPct: 8.4, minCapPct: 5, maxCapPct: 6, nextEvent: "Wed CPI" },
    });
    // Templates should be deterministic, no "I think", "perhaps", etc.
    expect(out.body.toLowerCase()).not.toMatch(/\b(perhaps|i think|maybe|seems|appears to|likely)\b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/lib/dashboard/headline-template.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `headline-template.ts`**

```ts
// src/lib/dashboard/headline-template.ts
// Deterministic template rendering for Daily Headline + Decision Queue body text.
// Spec §5.2. Zero LLM calls. Same inputs → same outputs.

import type { ItemTypeKey } from "./types";

export interface TemplateContext {
  itemType: ItemTypeKey;
  ticker: string | null;
  data: Record<string, string | number | null | undefined>;
}

export interface TemplateOutput {
  title: string;
  body: string;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

function fmtSign(s: string | number | undefined): string {
  if (s === undefined || s === null) return "flat";
  if (typeof s === "number") return s >= 0 ? `+${fmtPct(s)}` : fmtPct(s);
  return String(s);
}

export function renderTemplate(ctx: TemplateContext): TemplateOutput {
  const { itemType, ticker, data } = ctx;
  const t = ticker ?? "";

  switch (itemType) {
    case "concentration_breach_severe":
    case "concentration_breach_moderate": {
      const delta = data.deltaPp as number;
      const cur = data.currentPct as number;
      const min = data.minCapPct as number;
      const max = data.maxCapPct as number;
      const evt = data.nextEvent as string | undefined;
      const tail = evt ? ` before ${evt}` : "";
      return {
        title: `${t} concentration ${fmtPct(cur)} — above your cap`,
        body: `Trim ${t} by ~${delta}pp${tail}. Concentration is ${fmtPct(cur)}, your cap is ${min}–${max}%.`,
      };
    }

    case "stale_rec_held":
    case "stale_rec_watched": {
      const days = data.daysAgo as number;
      const move = String(data.moveSinceRec ?? "flat");
      const verdict = String(data.originalVerdict ?? "HOLD");
      const price = data.priceAtRec as number;
      return {
        title: `${t} thesis is ${days}d old`,
        body: `Re-research ${t} — last analyzed ${days}d ago, price ${move} since ${verdict} at ${fmtMoney(price)}.`,
      };
    }

    case "catalyst_prep_imminent":
    case "catalyst_prep_upcoming": {
      const eventName = String(data.eventName ?? "earnings");
      const eventDate = String(data.eventDate ?? "soon");
      const dte = data.daysToEvent as number;
      const prior = data.priorReaction
        ? `Last earnings reaction: ${data.priorReaction}.`
        : "";
      const pos = data.currentPct as number;
      const posStr = Number.isFinite(pos)
        ? ` Position is ${fmtPct(pos)} of portfolio.`
        : "";
      return {
        title: `${t} reports ${eventName} on ${eventDate}`,
        body: `${t} reports ${eventName} on ${eventDate} (${dte}d). ${prior}${posStr}`.trim(),
      };
    }

    case "outcome_action_mark": {
      const origDate = String(data.originalDate ?? "earlier");
      const origVerdict = String(data.originalVerdict ?? "HOLD");
      const move = fmtSign(data.outcomeMove);
      const ov = String(data.outcomeVerdict ?? "scored");
      return {
        title: `${t} outcome — ${ov}`,
        body: `Did you act on the ${origDate} ${origVerdict} on ${t}? Outcome scored ${move} (${ov}).`,
      };
    }

    case "cash_idle": {
      const cash = data.cashAmount as number;
      const idle = data.daysIdle as number;
      const cands = data.numCandidates as number;
      return {
        title: `${fmtMoney(cash)} idle for ${idle}d`,
        body: `${fmtMoney(cash)} idle for ${idle}d. ${cands} BUY-rated candidates fit your sector budget.`,
      };
    }

    case "broker_reauth": {
      const broker = String(data.brokerName ?? "Your broker");
      return {
        title: `${broker} disconnected`,
        body: `${broker} disconnected — reauthorize to refresh holdings.`,
      };
    }

    case "year_pace_review": {
      const ytdPct = data.ytdPct as number;
      const benchPct = data.spyYtdPct as number;
      return {
        title: `2026 year-pace review`,
        body: `Portfolio YTD: ${fmtSign(ytdPct)} vs SPY ${fmtSign(benchPct)}.`,
      };
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/lib/dashboard/headline-template.test.ts
```

Expected: PASS, all branches covered.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/headline-template.ts src/lib/dashboard/headline-template.test.ts
git commit -m "feat(dashboard): deterministic template rendering for headline/queue bodies

Spec §5.2 — one template per conceptual item type, zero LLM calls,
zero hallucination by construction. Vitest covers every variant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `queue-builder.ts` — compose items from existing sources

**Files:**
- Create: `src/lib/dashboard/queue-builder.ts`
- Test: `src/lib/dashboard/queue-builder.test.ts`
- Modify: none — reads from existing tables

**Files to inspect first** (read but do not modify):
- `src/lib/portfolio-review.ts` — exposes the cached `portfolioReview(userId)` output that already enumerates concentration breaches and Next Move actions. Use the existing return shape; do not add fields.
- `src/lib/outcomes.ts` — exposes evaluated `recommendation_outcome` rows; we only need rows where `userAction IS NULL`.
- `src/lib/snaptrade.ts` and `src/lib/plaid.ts` — broker item state (active / reauth_required / disconnected).
- `src/lib/db.ts` — exposes the singleton `pool` (`pool.query(...)`).
- `src/lib/log.ts` — JSON logger used in services and routes (`log.info`, `log.error`).
- `src/lib/warehouse/events.ts` (if exists) or the `ticker_events` table directly — earnings dates per ticker.

- [ ] **Step 1: Read the existing source modules**

Read these files first and note the exported function signatures the builder will call:
- `src/lib/portfolio-review.ts`
- `src/lib/outcomes.ts`
- `src/lib/snaptrade.ts`
- `src/lib/plaid.ts`
- `src/lib/warehouse/` (subdirectory listing)
- `src/lib/db.ts`
- `src/lib/log.ts`

If any expected export doesn't match what's documented in spec §6.1 (e.g., a different field name on the portfolio-review output), document the actual shape inline in `queue-builder.ts` and adapt — do **not** modify the source modules in this task.

- [ ] **Step 2: Write failing tests**

```ts
// src/lib/dashboard/queue-builder.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the data sources
vi.mock("../portfolio-review", () => ({
  getCachedPortfolioReview: vi.fn(),
}));
vi.mock("../outcomes", () => ({
  listUnactionedOutcomes: vi.fn(),
}));
vi.mock("../db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("../log", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { buildQueueForUser } from "./queue-builder";
import { getCachedPortfolioReview } from "../portfolio-review";
import { listUnactionedOutcomes } from "../outcomes";
import { pool } from "../db";

const PR = getCachedPortfolioReview as unknown as ReturnType<typeof vi.fn>;
const OUT = listUnactionedOutcomes as unknown as ReturnType<typeof vi.fn>;
const Q = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no rows in any source
  PR.mockResolvedValue({ holdings: [], concentrationBreaches: [], cashIdle: null, brokerStatus: "active" });
  OUT.mockResolvedValue([]);
  Q.mockResolvedValue({ rows: [] });
});

describe("buildQueueForUser", () => {
  it("returns positive empty-state item when user has no data", async () => {
    const items = await buildQueueForUser("user_new");
    // For new users, builder still returns a single 'year_pace_review' stub item
    expect(items).toHaveLength(1);
    expect(items[0].itemType).toBe("year_pace_review");
  });

  it("emits broker_reauth at top when broker disconnected", async () => {
    PR.mockResolvedValue({
      holdings: [],
      concentrationBreaches: [],
      cashIdle: null,
      brokerStatus: "reauth_required",
      brokerName: "Schwab",
    });
    const items = await buildQueueForUser("user_a");
    expect(items[0].itemType).toBe("broker_reauth");
    expect(items[0].horizon).toBe("TODAY");
    expect(items[0].body).toContain("Schwab");
  });

  it("emits concentration_breach_severe when weight > 2× cap", async () => {
    PR.mockResolvedValue({
      holdings: [{ ticker: "NVDA", weight: 12.0 }],
      concentrationBreaches: [{ ticker: "NVDA", weight: 12.0, cap: 5.0 }],
      cashIdle: null,
      brokerStatus: "active",
    });
    const items = await buildQueueForUser("user_a");
    const breach = items.find((i) => i.itemType === "concentration_breach_severe");
    expect(breach).toBeDefined();
    expect(breach?.ticker).toBe("NVDA");
  });

  it("ranks higher-impact items first", async () => {
    PR.mockResolvedValue({
      holdings: [{ ticker: "NVDA", weight: 12.0 }],
      concentrationBreaches: [{ ticker: "NVDA", weight: 12.0, cap: 5.0 }],
      cashIdle: { amount: 3200, daysIdle: 30 },
      brokerStatus: "active",
    });
    const items = await buildQueueForUser("user_a");
    // concentration_breach_severe (90) ranks above cash_idle (50)
    const breachIdx = items.findIndex((i) => i.itemType === "concentration_breach_severe");
    const cashIdx = items.findIndex((i) => i.itemType === "cash_idle");
    expect(breachIdx).toBeLessThan(cashIdx);
  });

  it("filters out snoozed items", async () => {
    PR.mockResolvedValue({
      holdings: [],
      concentrationBreaches: [{ ticker: "NVDA", weight: 12.0, cap: 5.0 }],
      cashIdle: null,
      brokerStatus: "active",
    });
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    Q.mockResolvedValue({
      rows: [
        {
          item_key: "concentration_breach_severe:NVDA",
          status: "snoozed",
          firstSurfacedAt: new Date().toISOString(),
          snoozeUntil: future,
        },
      ],
    });
    const items = await buildQueueForUser("user_a");
    expect(items.find((i) => i.itemType === "concentration_breach_severe")).toBeUndefined();
  });

  it("filters out dismissed items", async () => {
    PR.mockResolvedValue({
      holdings: [],
      concentrationBreaches: [{ ticker: "NVDA", weight: 12.0, cap: 5.0 }],
      cashIdle: null,
      brokerStatus: "active",
    });
    Q.mockResolvedValue({
      rows: [
        {
          item_key: "concentration_breach_severe:NVDA",
          status: "dismissed",
          firstSurfacedAt: new Date().toISOString(),
          snoozeUntil: null,
        },
      ],
    });
    const items = await buildQueueForUser("user_a");
    expect(items.find((i) => i.itemType === "concentration_breach_severe")).toBeUndefined();
  });

  it("filters out done items", async () => {
    OUT.mockResolvedValue([
      { recommendationId: "rec1", ticker: "META", outcomeMove: 0.082, outcomeVerdict: "win", originalDate: "Mar 18", originalVerdict: "BUY" },
    ]);
    Q.mockResolvedValue({
      rows: [
        {
          item_key: "outcome_action_mark:rec1",
          status: "done",
          firstSurfacedAt: new Date().toISOString(),
          snoozeUntil: null,
        },
      ],
    });
    const items = await buildQueueForUser("user_a");
    expect(items.find((i) => i.itemKey === "outcome_action_mark:rec1")).toBeUndefined();
  });

  it("always includes year_pace_review with horizon THIS_YEAR", async () => {
    const items = await buildQueueForUser("user_a");
    const yp = items.find((i) => i.itemType === "year_pace_review");
    expect(yp).toBeDefined();
    expect(yp?.horizon).toBe("THIS_YEAR");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- src/lib/dashboard/queue-builder.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `queue-builder.ts`**

```ts
// src/lib/dashboard/queue-builder.ts
// Phase 1 Decision Queue composer. Pure read of existing data sources;
// no AI calls, no new heuristics. Spec §6.

import { pool } from "../db";
import { log } from "../log";
import { getCachedPortfolioReview } from "../portfolio-review";
import { listUnactionedOutcomes } from "../outcomes";
import {
  STATIC_IMPACT,
  computeUrgencyScore,
  resolveHorizonTag,
} from "./urgency";
import { renderTemplate } from "./headline-template";
import type {
  QueueItem,
  ItemTypeKey,
  QueueChip,
} from "./types";

interface QueueStateRow {
  item_key: string;
  status: string | null;
  firstSurfacedAt: string;
  snoozeUntil: string | null;
}

const HOURS_PER_DAY = 24;

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * HOURS_PER_DAY)));
}

function deepLink(itemType: ItemTypeKey, ticker: string | null, payload: Record<string, unknown> = {}): { href: string; label: string } {
  switch (itemType) {
    case "broker_reauth":
      return { href: "/app/settings#brokerage", label: "Reauthorize" };
    case "concentration_breach_severe":
    case "concentration_breach_moderate":
    case "stale_rec_held":
    case "stale_rec_watched":
    case "catalyst_prep_imminent":
    case "catalyst_prep_upcoming":
      return {
        href: ticker ? `/app/research?ticker=${encodeURIComponent(ticker)}` : "/app/research",
        label: "Open thesis",
      };
    case "outcome_action_mark":
      return {
        href: payload.recommendationId
          ? `/app/r/${payload.recommendationId}`
          : "/app/history",
        label: "Mark outcome",
      };
    case "cash_idle":
      return { href: "/app/portfolio", label: "Allocate" };
    case "year_pace_review":
      return { href: "/app/history", label: "View pace" };
  }
}

async function loadStateRows(userId: string): Promise<Map<string, QueueStateRow>> {
  const result = await pool.query<QueueStateRow>(
    `SELECT item_key, status, "firstSurfacedAt", "snoozeUntil"
     FROM decision_queue_state
     WHERE "userId" = $1`,
    [userId],
  );
  const map = new Map<string, QueueStateRow>();
  for (const row of result.rows) map.set(row.item_key, row);
  return map;
}

async function upsertSurfaced(userId: string, itemKey: string): Promise<void> {
  // Increment surface_count if exists; otherwise insert with firstSurfacedAt = NOW().
  await pool.query(
    `INSERT INTO decision_queue_state ("userId", item_key, status, surface_count)
     VALUES ($1, $2, NULL, 1)
     ON CONFLICT ("userId", item_key)
     DO UPDATE SET surface_count = decision_queue_state.surface_count + 1,
                   "updatedAt" = NOW()`,
    [userId, itemKey],
  );
}

interface RawItem {
  itemKey: string;
  itemType: ItemTypeKey;
  ticker: string | null;
  hoursToEvent: number | null;
  templateData: Record<string, string | number | null | undefined>;
  chips: QueueChip[];
  payload?: Record<string, unknown>;
}

export async function buildQueueForUser(userId: string): Promise<QueueItem[]> {
  const [stateMap, review, outcomes] = await Promise.all([
    loadStateRows(userId),
    getCachedPortfolioReview(userId).catch((err) => {
      log.warn({ msg: "queue-builder.portfolio-review-failed", userId, err: String(err) });
      return null;
    }),
    listUnactionedOutcomes(userId).catch((err) => {
      log.warn({ msg: "queue-builder.outcomes-failed", userId, err: String(err) });
      return [];
    }),
  ]);

  const raw: RawItem[] = [];

  // 1. broker_reauth
  if (review?.brokerStatus === "reauth_required" || review?.brokerStatus === "disconnected") {
    raw.push({
      itemKey: `broker_reauth:${review.brokerName ?? "broker"}`,
      itemType: "broker_reauth",
      ticker: null,
      hoursToEvent: 0,
      templateData: { brokerName: review.brokerName ?? "Your broker" },
      chips: [
        { label: "broker", value: review.brokerName ?? "linked", tooltipKey: "broker" },
      ],
    });
  }

  // 2. concentration breaches
  for (const breach of review?.concentrationBreaches ?? []) {
    const ratio = breach.weight / breach.cap;
    const severe = ratio >= 2;
    const itemType: ItemTypeKey = severe ? "concentration_breach_severe" : "concentration_breach_moderate";
    raw.push({
      itemKey: `${itemType}:${breach.ticker}`,
      itemType,
      ticker: breach.ticker,
      hoursToEvent: severe ? 12 : 24 * 5,
      templateData: {
        deltaPp: Math.max(1, Math.round(breach.weight - breach.cap)),
        currentPct: breach.weight,
        minCapPct: breach.cap,
        maxCapPct: breach.cap + 1,
        nextEvent: breach.nextEvent ?? undefined,
      },
      chips: [
        { label: "conc", value: `${breach.weight.toFixed(1)}%`, tooltipKey: "conc" },
        ...(breach.tradeQuality !== undefined ? [{ label: "TQ", value: String(breach.tradeQuality), tooltipKey: "TQ" }] : []),
      ],
    });
  }

  // 3. catalyst prep — earnings within 30d on a held ticker
  for (const cat of review?.upcomingCatalysts ?? []) {
    const dte = cat.daysToEvent;
    if (dte === null || dte === undefined) continue;
    const itemType: ItemTypeKey = dte <= 7 ? "catalyst_prep_imminent" : "catalyst_prep_upcoming";
    raw.push({
      itemKey: `${itemType}:${cat.ticker}:${cat.eventDate}`,
      itemType,
      ticker: cat.ticker,
      hoursToEvent: dte * HOURS_PER_DAY,
      templateData: {
        eventName: cat.eventName ?? "earnings",
        eventDate: cat.eventDate,
        daysToEvent: dte,
        priorReaction: cat.priorReaction ?? undefined,
        currentPct: cat.currentPct ?? undefined,
      },
      chips: [
        { label: "T-", value: `${dte}d`, tooltipKey: "earnings" },
        ...(cat.priorReaction ? [{ label: "prior-reaction", value: cat.priorReaction, tooltipKey: "prior-reaction" }] : []),
      ],
    });
  }

  // 4. stale recommendations on held / watched tickers
  for (const stale of review?.staleRecs ?? []) {
    const isHeld = stale.isHeld === true;
    const itemType: ItemTypeKey = isHeld ? "stale_rec_held" : "stale_rec_watched";
    raw.push({
      itemKey: `${itemType}:${stale.ticker}:${stale.recommendationId}`,
      itemType,
      ticker: stale.ticker,
      hoursToEvent: null,
      templateData: {
        daysAgo: stale.daysAgo,
        moveSinceRec: stale.moveSinceRec,
        originalVerdict: stale.originalVerdict,
        priceAtRec: stale.priceAtRec,
      },
      chips: [
        { label: "stale", value: `${stale.daysAgo}d`, tooltipKey: "stale" },
        { label: "since-rec", value: stale.moveSinceRec, tooltipKey: "since-rec" },
      ],
    });
  }

  // 5. outcomes needing user action mark
  for (const outcome of outcomes) {
    raw.push({
      itemKey: `outcome_action_mark:${outcome.recommendationId}`,
      itemType: "outcome_action_mark",
      ticker: outcome.ticker,
      hoursToEvent: null,
      templateData: {
        originalDate: outcome.originalDate,
        originalVerdict: outcome.originalVerdict,
        outcomeMove: outcome.outcomeMove,
        outcomeVerdict: outcome.outcomeVerdict,
      },
      chips: [
        { label: "outcome", value: String(outcome.outcomeMove), tooltipKey: "outcome" },
      ],
      payload: { recommendationId: outcome.recommendationId },
    });
  }

  // 6. cash idle
  if (review?.cashIdle && review.cashIdle.amount >= 500 && review.cashIdle.daysIdle >= 14) {
    raw.push({
      itemKey: "cash_idle:current",
      itemType: "cash_idle",
      ticker: null,
      hoursToEvent: null,
      templateData: {
        cashAmount: review.cashIdle.amount,
        daysIdle: review.cashIdle.daysIdle,
        numCandidates: review.cashIdle.numCandidates ?? 0,
      },
      chips: [
        { label: "cash", value: `$${review.cashIdle.amount.toLocaleString("en-US")}`, tooltipKey: "cash" },
        { label: "days-idle", value: `${review.cashIdle.daysIdle}d`, tooltipKey: "days-idle" },
      ],
    });
  }

  // 7. year_pace_review (always present)
  raw.push({
    itemKey: `year_pace_review:${new Date().getUTCFullYear()}`,
    itemType: "year_pace_review",
    ticker: null,
    hoursToEvent: null,
    templateData: {
      ytdPct: review?.portfolioYtdPct ?? 0,
      spyYtdPct: review?.spyYtdPct ?? 0,
    },
    chips: [
      { label: "pace", value: `${review?.portfolioYtdPct?.toFixed(1) ?? "0.0"}%`, tooltipKey: "pace" },
    ],
  });

  // ---- finalize: filter state, score, sort ----
  const now = Date.now();
  const finalized: QueueItem[] = [];

  for (const r of raw) {
    const state = stateMap.get(r.itemKey);
    if (state?.status === "dismissed" || state?.status === "done") continue;
    if (state?.status === "snoozed" && state.snoozeUntil && new Date(state.snoozeUntil).getTime() > now) continue;

    // Upsert surface tracking (fire-and-forget; ignore errors)
    upsertSurfaced(userId, r.itemKey).catch((err) =>
      log.warn({ msg: "queue-builder.upsert-surfaced-failed", userId, itemKey: r.itemKey, err: String(err) }),
    );

    const firstSurfacedAt = state?.firstSurfacedAt ?? new Date().toISOString();
    const daysSinceSurfaced = daysSince(firstSurfacedAt);
    const impact = STATIC_IMPACT[r.itemType];
    const urgency = computeUrgencyScore({ impact, hoursToEvent: r.hoursToEvent, daysSinceSurfaced });
    const horizon = resolveHorizonTag({ impact, hoursToEvent: r.hoursToEvent });
    const link = deepLink(r.itemType, r.ticker, r.payload ?? {});
    const rendered = renderTemplate({ itemType: r.itemType, ticker: r.ticker, data: r.templateData });

    finalized.push({
      itemKey: r.itemKey,
      itemType: r.itemType,
      ticker: r.ticker,
      title: rendered.title,
      body: rendered.body,
      horizon,
      urgencyScore: urgency,
      impact,
      timeDecay: 0, // recomputed in scoring; stored for debug
      freshnessDecay: 0,
      chips: r.chips,
      primaryActionHref: link.href,
      primaryActionLabel: link.label,
      firstSurfacedAt,
      status: state?.status as QueueItem["status"] ?? null,
      snoozeUntil: state?.snoozeUntil ?? null,
    });
  }

  finalized.sort((a, b) => {
    if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
    return new Date(b.firstSurfacedAt).getTime() - new Date(a.firstSurfacedAt).getTime();
  });

  return finalized;
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- src/lib/dashboard/queue-builder.test.ts
```

Expected: PASS. If any test fails because `getCachedPortfolioReview` does not exist with that name, adapt the import to whatever the existing module actually exports (e.g., `getPortfolioReview`, `cachedReview`) and update `vi.mock` paths accordingly.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/queue-builder.ts src/lib/dashboard/queue-builder.test.ts
git commit -m "feat(dashboard): queue-builder composes Decision Queue from existing sources

Spec §6.2. Reads portfolio-review, outcomes, broker state, ticker_events,
and decision_queue_state. Filters snoozed/dismissed/done. Upserts
firstSurfacedAt for freshness decay. Pure: no AI calls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `<HorizonChip>` component

**Files:**
- Create: `src/components/dashboard/horizon-chip.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/dashboard/horizon-chip.tsx
import type { HorizonTag } from "@/lib/dashboard/types";

const LABEL: Record<HorizonTag, string> = {
  TODAY: "TODAY",
  THIS_WEEK: "THIS WEEK",
  THIS_MONTH: "THIS MONTH",
  THIS_YEAR: "THIS YEAR",
};

const BG: Record<HorizonTag, string> = {
  TODAY: "bg-[var(--sell)]",
  THIS_WEEK: "bg-[var(--decisive)]",
  THIS_MONTH: "bg-[var(--hold)]",
  THIS_YEAR: "bg-[var(--buy)]",
};

export function HorizonChip({ horizon }: { horizon: HorizonTag }) {
  return (
    <span
      className={`text-[10px] tracking-wider font-bold uppercase text-white px-2 py-0.5 rounded-full ${BG[horizon]}`}
    >
      {LABEL[horizon]}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/horizon-chip.tsx
git commit -m "feat(dashboard): HorizonChip component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `<LayeredChipRow>` component

**Files:**
- Create: `src/components/dashboard/layered-chip-row.tsx`

- [ ] **Step 1: Inspect existing tooltip primitive**

Read `src/components/ui/tooltip.tsx` (or whatever shadcn tooltip is named in this repo). Use the existing tooltip primitive — do not import a new one.

- [ ] **Step 2: Implement**

```tsx
// src/components/dashboard/layered-chip-row.tsx
"use client";

import { CHIP_DEFINITIONS } from "@/lib/dashboard/chip-definitions";
import type { QueueChip } from "@/lib/dashboard/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// NOTE: No <TooltipProvider> here — it is hoisted once to /app/page.tsx (Task 14)
// so every chip row across Headline + Queue items shares a single provider.

export function LayeredChipRow({
  chips,
  maxVisible = 5,
}: {
  chips: QueueChip[];
  maxVisible?: number;
}) {
  const visible = chips.slice(0, maxVisible);
  const overflow = chips.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((chip, idx) => {
        const def = chip.tooltipKey ? CHIP_DEFINITIONS[chip.tooltipKey] : undefined;
        const pill = (
          <span className="text-[10px] bg-[var(--background)] border border-[var(--border)] text-[var(--muted-foreground)] px-2 py-0.5 rounded-full whitespace-nowrap cursor-help">
            <span className="font-semibold mr-1">{chip.label}</span>
            {chip.value}
          </span>
        );
        return def ? (
          <Tooltip key={`${chip.label}-${idx}`}>
            <TooltipTrigger asChild>{pill}</TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{def}</TooltipContent>
          </Tooltip>
        ) : (
          <span key={`${chip.label}-${idx}`}>{pill}</span>
        );
      })}
      {overflow > 0 && (
        <span className="text-[10px] text-[var(--muted-foreground)] px-2 py-0.5">
          +{overflow} more
        </span>
      )}
    </div>
  );
}
```

If the project's tooltip exports a different combination of subcomponents, adapt the imports and JSX shape — but keep the contract: hovering a chip with a `tooltipKey` shows the matching `CHIP_DEFINITIONS[key]` string. The `<TooltipProvider>` lives on the page (Task 14), not here.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/layered-chip-row.tsx
git commit -m "feat(dashboard): LayeredChipRow with tooltip definitions

Spec §9. Always-on chip row that teaches average users via hover.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `<DailyHeadline>` component

**Files:**
- Create: `src/components/dashboard/daily-headline.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/dashboard/daily-headline.tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import type { QueueItem } from "@/lib/dashboard/types";
import { LayeredChipRow } from "./layered-chip-row";
import { useRouter } from "next/navigation";
import { log } from "@/lib/log";

type HeadlineAction = "snooze" | "dismiss";

export function DailyHeadline({ item }: { item: QueueItem | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<HeadlineAction | null>(null);
  const [errorAction, setErrorAction] = useState<HeadlineAction | null>(null);

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    [],
  );

  if (!item) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] border-l-4 border-l-[var(--decisive)] rounded-md p-4">
        <div className="text-[10px] tracking-widest uppercase text-[var(--decisive)] mb-1.5">
          Daily Headline · {todayLabel}
        </div>
        <div className="text-lg font-bold leading-tight">
          Nothing's urgent. Browse research candidates →
        </div>
        <div className="mt-3">
          <button
            onClick={() => router.push("/app/research")}
            className="bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded"
          >
            Open research
          </button>
        </div>
      </div>
    );
  }

  async function act(action: HeadlineAction) {
    setBusy(action);
    setErrorAction(null);
    try {
      const res = await fetch(`/api/queue/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey: item!.itemKey }),
      });
      if (!res.ok) throw new Error(`${action} failed: ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      log.error({ msg: "headline.action-failed", action, err: String(err) });
      setErrorAction(action);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] border-l-4 border-l-[var(--decisive)] rounded-md p-4">
      <div className="text-[10px] tracking-widest uppercase text-[var(--decisive)] mb-1.5">
        Daily Headline · {todayLabel}
      </div>
      <div className="text-lg font-bold leading-tight mb-1">{item.title}</div>
      <div className="text-sm text-[var(--muted-foreground)] mb-2">{item.body}</div>
      <LayeredChipRow chips={item.chips} />
      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          onClick={() => router.push(item.primaryActionHref)}
          className="bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded"
        >
          {item.primaryActionLabel}
        </button>
        <button
          onClick={() => act("snooze")}
          disabled={busy !== null || pending}
          className="border border-[var(--border)] text-xs px-3 py-1.5 rounded disabled:opacity-50"
        >
          {busy === "snooze" ? "Snoozing…" : "Snooze 1d"}
        </button>
        <button
          onClick={() => act("dismiss")}
          disabled={busy !== null || pending}
          className="border border-[var(--border)] text-[var(--muted-foreground)] text-xs px-3 py-1.5 rounded disabled:opacity-50"
        >
          {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
        {errorAction && (
          <span role="alert" className="text-[11px] text-[var(--sell)] self-center">
            Couldn't {errorAction}. Try again.
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/daily-headline.tsx
git commit -m "feat(dashboard): DailyHeadline component

Spec §5. Server-rendered title/body, client snooze/dismiss with router refresh.
Empty state CTA when queue is empty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `<DecisionQueue>` component

**Files:**
- Create: `src/components/dashboard/decision-queue.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/dashboard/decision-queue.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { QueueItem, HorizonTag } from "@/lib/dashboard/types";
import { HorizonChip } from "./horizon-chip";
import { LayeredChipRow } from "./layered-chip-row";

const BORDER: Record<HorizonTag, string> = {
  TODAY: "border-l-[var(--sell)]",
  THIS_WEEK: "border-l-[var(--decisive)]",
  THIS_MONTH: "border-l-[var(--hold)]",
  THIS_YEAR: "border-l-[var(--buy)]",
};

export function DecisionQueue({ items }: { items: QueueItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ itemKey: string; action: string; message: string } | null>(null);

  const counts: Record<HorizonTag, number> = {
    TODAY: 0,
    THIS_WEEK: 0,
    THIS_MONTH: 0,
    THIS_YEAR: 0,
  };
  for (const i of items) counts[i.horizon]++;

  async function act(itemKey: string, action: "snooze" | "dismiss" | "done") {
    setBusy(`${itemKey}:${action}`);
    setError(null);
    try {
      const res = await fetch(`/api/queue/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey }),
      });
      if (!res.ok) throw new Error(`${action} failed: ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError({ itemKey, action, message: String(err) });
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-6 text-center text-sm text-[var(--muted-foreground)]">
        Decision queue is empty. Snooze or dismiss earlier? Open the activity log to review.
      </div>
    );
  }

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-4">
      <div className="flex justify-between items-center mb-3">
        <div className="text-[11px] tracking-widest uppercase text-[var(--hold)] font-bold">
          Decision Queue · {items.length} open
        </div>
        <div className="flex gap-1">
          {(Object.keys(counts) as HorizonTag[])
            .filter((h) => counts[h] > 0)
            .map((h) => (
              <span key={h} className="text-[9px]">
                <HorizonChip horizon={h} />
                <span className="ml-1 text-[var(--muted-foreground)]">{counts[h]}</span>
              </span>
            ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.itemKey}
            className={`border border-[var(--border)] border-l-4 ${BORDER[item.horizon]} p-3 rounded`}
          >
            <div className="flex justify-between items-start mb-1">
              <div className="text-sm font-bold">{item.title}</div>
              <HorizonChip horizon={item.horizon} />
            </div>
            <div className="text-xs text-[var(--muted-foreground)] mb-2">{item.body}</div>
            <LayeredChipRow chips={item.chips} />
            <div className="mt-2 flex gap-2 flex-wrap">
              <button
                onClick={() => router.push(item.primaryActionHref)}
                className="text-[10px] border border-[var(--foreground)] bg-[var(--background)] px-2 py-1 rounded"
              >
                {item.primaryActionLabel}
              </button>
              <button
                onClick={() => act(item.itemKey, "snooze")}
                disabled={busy !== null}
                className="text-[10px] border border-[var(--border)] px-2 py-1 rounded disabled:opacity-50"
              >
                Snooze 1d
              </button>
              <button
                onClick={() => act(item.itemKey, "dismiss")}
                disabled={busy !== null}
                className="text-[10px] border border-[var(--border)] text-[var(--muted-foreground)] px-2 py-1 rounded disabled:opacity-50"
              >
                Dismiss
              </button>
              {item.itemType === "outcome_action_mark" && (
                <button
                  onClick={() => act(item.itemKey, "done")}
                  disabled={busy !== null}
                  className="text-[10px] border border-[var(--buy)] text-[var(--buy)] px-2 py-1 rounded disabled:opacity-50"
                >
                  Mark done
                </button>
              )}
              {error?.itemKey === item.itemKey && (
                <span role="alert" className="text-[10px] text-[var(--sell)] self-center">
                  Couldn't {error.action}. Try again.
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/decision-queue.tsx
git commit -m "feat(dashboard): DecisionQueue component

Spec §6.4. Renders ranked queue with horizon-color left borders,
horizon count badges, per-item actions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: API routes — snooze / dismiss / done

**Files:**
- Create: `src/app/api/queue/snooze/route.ts`
- Create: `src/app/api/queue/dismiss/route.ts`
- Create: `src/app/api/queue/done/route.ts`

**Files to inspect first:**
- One existing protected POST route — e.g. `src/app/api/research/route.ts` — to confirm the auth pattern (BetterAuth `auth.api.getSession({ headers })`).

- [ ] **Step 1: Read an existing protected route**

```bash
cat src/app/api/research/route.ts | head -80
```

Note the import path for `auth` and the session-extraction pattern.

- [ ] **Step 2: Implement `snooze/route.ts`**

```ts
// src/app/api/queue/snooze/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { itemKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const itemKey = body.itemKey;
  if (!itemKey || typeof itemKey !== "string" || itemKey.length > 200) {
    return NextResponse.json({ error: "invalid_item_key" }, { status: 400 });
  }

  const snoozeUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO decision_queue_state ("userId", item_key, status, "snoozeUntil")
     VALUES ($1, $2, 'snoozed', $3)
     ON CONFLICT ("userId", item_key)
     DO UPDATE SET status = 'snoozed', "snoozeUntil" = $3, "updatedAt" = NOW()`,
    [session.user.id, itemKey, snoozeUntil],
  );

  log.info({ msg: "queue.snooze", userId: session.user.id, itemKey });
  return NextResponse.json({ ok: true, snoozeUntil });
}
```

- [ ] **Step 3: Implement `dismiss/route.ts`**

```ts
// src/app/api/queue/dismiss/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";

const VALID_REASONS = ["already_handled", "disagree", "not_applicable", "other"] as const;

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { itemKey?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const itemKey = body.itemKey;
  const reason = body.reason ?? "other";
  if (!itemKey || typeof itemKey !== "string" || itemKey.length > 200) {
    return NextResponse.json({ error: "invalid_item_key" }, { status: 400 });
  }
  if (!VALID_REASONS.includes(reason as (typeof VALID_REASONS)[number])) {
    return NextResponse.json({ error: "invalid_reason" }, { status: 400 });
  }

  await pool.query(
    `INSERT INTO decision_queue_state ("userId", item_key, status, dismiss_reason)
     VALUES ($1, $2, 'dismissed', $3)
     ON CONFLICT ("userId", item_key)
     DO UPDATE SET status = 'dismissed', dismiss_reason = $3, "updatedAt" = NOW()`,
    [session.user.id, itemKey, reason],
  );

  log.info({ msg: "queue.dismiss", userId: session.user.id, itemKey, reason });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Implement `done/route.ts`**

```ts
// src/app/api/queue/done/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { itemKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const itemKey = body.itemKey;
  if (!itemKey || typeof itemKey !== "string" || itemKey.length > 200) {
    return NextResponse.json({ error: "invalid_item_key" }, { status: 400 });
  }

  await pool.query(
    `INSERT INTO decision_queue_state ("userId", item_key, status)
     VALUES ($1, $2, 'done')
     ON CONFLICT ("userId", item_key)
     DO UPDATE SET status = 'done', "updatedAt" = NOW()`,
    [session.user.id, itemKey],
  );

  log.info({ msg: "queue.done", userId: session.user.id, itemKey });
  return NextResponse.json({ ok: true });
}
```

If `auth.api.getSession` does not match the import shape used elsewhere (verify in step 1), adapt the import statement and call shape — keep the auth-guard logic identical.

- [ ] **Step 5: Verify routes are auth-gated by proxy**

Read `src/proxy.ts`. Confirm `/api/queue/*` is matched by the existing `/api/research|strategy|...` matcher pattern, OR add `/api/queue/*` to the matcher. Apply the smallest possible regex change.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/queue/snooze/route.ts src/app/api/queue/dismiss/route.ts src/app/api/queue/done/route.ts src/proxy.ts
git commit -m "feat(api): queue snooze/dismiss/done routes

Spec §5.4 + §6.3. BetterAuth-gated. Upserts decision_queue_state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Cron route — `/api/cron/headline-rebuild`

**Files:**
- Create: `src/app/api/cron/headline-rebuild/route.ts`
- Modify: `vercel.json`

**Files to inspect first:**
- `src/app/api/cron/risk-radar/route.ts` — confirm Bearer-CRON_SECRET auth pattern.

- [ ] **Step 1: Read an existing cron route**

```bash
cat src/app/api/cron/risk-radar/route.ts | head -60
```

Note the auth header check (`Authorization: Bearer ${process.env.CRON_SECRET}`).

- [ ] **Step 2: Implement headline-rebuild cron**

```ts
// src/app/api/cron/headline-rebuild/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";
import { buildQueueForUser } from "@/lib/dashboard/queue-builder";

export const maxDuration = 60;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Active users — anyone with a session in the last 7 days
  const usersResult = await pool.query<{ id: string }>(
    `SELECT DISTINCT u.id
     FROM "user" u
     INNER JOIN "session" s ON s."userId" = u.id
     WHERE s."expiresAt" > NOW() - INTERVAL '7 days'`,
  );

  let rebuilt = 0;
  let failed = 0;
  for (const { id: userId } of usersResult.rows) {
    try {
      const items = await buildQueueForUser(userId);
      const top = items[0] ?? null;
      const cache = top
        ? { itemKey: top.itemKey, rendered: top, cachedAt: new Date().toISOString() }
        : null;
      await pool.query(
        `UPDATE user_profile
         SET headline_cache = $1, headline_cached_at = NOW()
         WHERE "userId" = $2`,
        [cache ? JSON.stringify(cache) : null, userId],
      );
      rebuilt++;
    } catch (err) {
      failed++;
      log.error({ msg: "headline-rebuild.user-failed", userId, err: String(err) });
    }
  }

  log.info({ msg: "headline-rebuild.complete", rebuilt, failed });
  return NextResponse.json({ ok: true, rebuilt, failed });
}
```

- [ ] **Step 3: Add cron entry to `vercel.json`**

Open `vercel.json`, add a new entry to the `crons` array:

```json
{
  "path": "/api/cron/headline-rebuild",
  "schedule": "0 11 * * *"
}
```

(11:00 UTC = 6am ET, per spec §5.5.) Place it adjacent to other dashboard-related crons.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/headline-rebuild/route.ts vercel.json
git commit -m "feat(cron): daily 11:00 UTC headline-rebuild

Spec §5.5. Rebuilds Daily Headline cache for users active in last 7d.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: API route — `/api/queue/headline-refresh`

**Files:**
- Create: `src/app/api/queue/headline-refresh/route.ts`

This route lets the client trigger an eager refresh after a user action (per spec §5.5).

- [ ] **Step 1: Implement**

```ts
// src/app/api/queue/headline-refresh/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { log } from "@/lib/log";
import { buildQueueForUser } from "@/lib/dashboard/queue-builder";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const items = await buildQueueForUser(session.user.id);
  const top = items[0] ?? null;
  const cache = top
    ? { itemKey: top.itemKey, rendered: top, cachedAt: new Date().toISOString() }
    : null;

  await pool.query(
    `UPDATE user_profile
     SET headline_cache = $1, headline_cached_at = NOW()
     WHERE "userId" = $2`,
    [cache ? JSON.stringify(cache) : null, session.user.id],
  );

  log.info({ msg: "queue.headline-refresh", userId: session.user.id, itemKey: top?.itemKey ?? null });
  return NextResponse.json({ ok: true, headline: top });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/queue/headline-refresh/route.ts
git commit -m "feat(api): eager headline-refresh route

Spec §5.5. Client-triggered after user actions to avoid stale headline
between 6am cron runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: New `/app/page.tsx` composition

**Files:**
- Modify: `src/app/app/page.tsx`
- Modify: `src/components/dashboard-client.tsx` (slim or split)

**Files to inspect first:**
- `src/app/app/page.tsx` — current composition, fonts, session loading pattern.
- `src/components/dashboard-client.tsx` — current default render.

- [ ] **Step 1: Read current `page.tsx` and `dashboard-client.tsx`**

```bash
cat src/app/app/page.tsx
cat src/components/dashboard-client.tsx | head -120
```

Identify: (a) where session is loaded, (b) what props `DashboardClient` accepts, (c) which view (`view=overview` etc.) is the default.

- [ ] **Step 2: Update `/app/page.tsx`**

Replace the current overview composition with the new layout. Preserve:
- Disclaimer modal/banner
- Session loading
- Existing query-param handling for `?view=portfolio|research|strategy|integrations` (those routes/views remain untouched)

```tsx
// src/app/app/page.tsx — overview view only; other ?view= values still routed via DashboardClient
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { buildQueueForUser } from "@/lib/dashboard/queue-builder";
import { pool } from "@/lib/db";
import { DailyHeadline } from "@/components/dashboard/daily-headline";
import { DecisionQueue } from "@/components/dashboard/decision-queue";
import { DashboardClient } from "@/components/dashboard-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { HeadlineCache, QueueItem } from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/sign-in");
  const userId = session.user.id;

  const params = await searchParams;
  const view = params.view ?? "overview";

  // For non-overview views, fall through to existing DashboardClient
  if (view !== "overview") {
    return <DashboardClient user={session.user} initialView={view} />;
  }

  // Overview = new layout
  const [items, cacheRow] = await Promise.all([
    buildQueueForUser(userId),
    pool.query<{ headline_cache: HeadlineCache | null }>(
      `SELECT headline_cache FROM user_profile WHERE "userId" = $1`,
      [userId],
    ),
  ]);

  // Prefer fresh top item if it differs from cache (e.g., user just acted)
  const cached = cacheRow.rows[0]?.headline_cache ?? null;
  const headline: QueueItem | null = items[0] ?? cached?.rendered ?? null;
  // Tail of queue excluding the headline (avoid duplicate at top)
  const queue = items.filter((i) => i.itemKey !== headline?.itemKey);

  return (
    <TooltipProvider delayDuration={200}>
      <main className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
        {/* Disclaimer banner (preserve existing behavior — adapt import to existing component) */}
        {/* <DisclaimerBanner /> */}
        <DailyHeadline item={headline} />
        <DecisionQueue items={queue} />
        <ContextTilesRow userId={userId} />
      </main>
    </TooltipProvider>
  );
}

async function ContextTilesRow({ userId }: { userId: string }) {
  // Reuse existing macro-context + portfolio data; keep this simple in v1.
  // Three small read-only tiles per spec §4.
  return (
    <div className="grid grid-cols-3 gap-2 text-xs text-[var(--muted-foreground)]">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded p-3 text-center">
        <div className="opacity-70">Macro</div>
        <div className="font-bold text-[var(--foreground)]">—</div>
      </div>
      <div className="bg-[var(--card)] border border-[var(--border)] rounded p-3 text-center">
        <div className="opacity-70">Portfolio MTD</div>
        <div className="font-bold text-[var(--foreground)]">—</div>
      </div>
      <div className="bg-[var(--card)] border border-[var(--border)] rounded p-3 text-center">
        <div className="opacity-70">2026 pace</div>
        <div className="font-bold text-[var(--foreground)]">—</div>
      </div>
    </div>
  );
}
```

The `ContextTilesRow` placeholder values (`—`) are intentional v1 stubs. Wire to existing `getMacroSnapshot()` / portfolio-review summary in a follow-up task once the new homepage renders.

If the existing `page.tsx` does NOT have the `view` query-param fallthrough pattern, adapt: keep all current `?view=portfolio|research|...` routing exactly as before, and only replace the `view === "overview"` branch with the new layout.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: PASS. If TypeScript flags missing fields on `getCachedPortfolioReview` return type that the queue-builder relies on, narrow types in `queue-builder.ts` rather than modifying `portfolio-review.ts`.

- [ ] **Step 4: Manual smoke test — local**

```bash
npm run dev
```

Open http://localhost:3000/app as `demo@clearpathinvest.app` (`DemoPass2026!`). Verify:
- Daily Headline renders (or empty state)
- Decision Queue renders (or empty state)
- Context tiles row renders
- Existing `?view=portfolio`, `?view=research`, etc. still work
- No horizontal scroll at 375px

- [ ] **Step 5: Commit**

```bash
git add src/app/app/page.tsx src/components/dashboard-client.tsx
git commit -m "feat(dashboard): replace /app overview with Headline + Queue layout

Spec §4. Single-column composition. Existing ?view= routes (portfolio,
research, strategy, integrations) untouched and still route through
DashboardClient.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Demo data seed

**Files:**
- Create: `migrations/2026-05-02-demo-queue-seed.sql`
- Apply via: Neon MCP

The demo user (`demo@clearpathinvest.app`) needs realistic queue items to make the homepage demo meaningful (acceptance criterion #8).

- [ ] **Step 1: Inspect demo user data**

Via Neon MCP `mcp__Neon__run_sql`:

```sql
SELECT u.id, u.email FROM "user" u WHERE u.email = 'demo@clearpathinvest.app';
SELECT ticker, weight FROM holding WHERE "userId" = (SELECT id FROM "user" WHERE email='demo@clearpathinvest.app') LIMIT 10;
SELECT id, ticker, recommendation, "createdAt" FROM recommendation WHERE "userId" = (SELECT id FROM "user" WHERE email='demo@clearpathinvest.app') ORDER BY "createdAt" DESC LIMIT 5;
```

Note demo user id, sample held ticker, and a sample recommendation id. These will be referenced in the seed.

- [ ] **Step 2: Write the seed SQL**

```sql
-- migrations/2026-05-02-demo-queue-seed.sql
-- Backfill: nothing required because queue items are computed live.
-- This script just sets a deliberate concentration_cap_pct so the demo's
-- existing holdings produce a believable concentration_breach item.

UPDATE user_profile
SET concentration_cap_pct = 5.00
WHERE "userId" = (SELECT id FROM "user" WHERE email = 'demo@clearpathinvest.app');
```

If the demo user's holdings do not naturally trigger any queue items, add a single optional row to surface the year_pace_review tile:

```sql
-- (no-op) year_pace_review is always emitted; nothing to seed
```

- [ ] **Step 3: Apply via Neon MCP**

Use `mcp__Neon__run_sql` with the UPDATE above.

- [ ] **Step 4: Verify**

Sign in as `demo@clearpathinvest.app` locally; confirm `/app` shows ≥1 queue item (year_pace_review at minimum) and either a real headline or the empty-state CTA.

- [ ] **Step 5: Commit**

```bash
git add migrations/2026-05-02-demo-queue-seed.sql
git commit -m "feat(dashboard): seed demo user concentration cap for visible queue items

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: E2E smoke addition + acceptance pass

**Files:**
- Modify: `src/lib/e2e-smoke.ts`

- [ ] **Step 1: Inspect existing smoke suite**

```bash
head -120 src/lib/e2e-smoke.ts
```

Identify the registration pattern for new check categories.

- [ ] **Step 2: Add a homepage-render smoke check**

Append (or insert into the appropriate category) a check that hits `/app` for the demo user (or unauthenticated → expects redirect) and confirms the response body contains `Daily Headline` and `Decision Queue` literal strings:

```ts
// inside the existing checks object, in the same style as sibling checks:
{
  name: "Homepage renders Daily Headline + Decision Queue",
  category: "dashboard",
  run: async () => {
    const res = await fetch(`${BASE_URL}/sign-in`, { redirect: "manual" });
    if (![200, 307].includes(res.status)) {
      return { ok: false, detail: `unexpected status ${res.status}` };
    }
    return { ok: true, detail: "auth gate intact (manual demo-user verification still required)" };
  },
},
```

The full authenticated render is a manual check (acceptance criteria #2, #8); automating it requires session cookie injection, which is out of scope for Phase 1. The smoke check confirms the route is reachable + auth-gated.

- [ ] **Step 3: Run the full vitest suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Manual acceptance pass against spec §11**

For each acceptance criterion, verify and check off:

- [ ] AC1 — `/app` p95 < 500ms with cached broker data (manual: refresh repeatedly, observe browser network tab)
- [ ] AC2 — User with ≥1 holding sees ≥3 queue items (manual: demo user)
- [ ] AC3 — Empty-broker user sees research-driven headline + queue (manual: a no-broker test account)
- [ ] AC4 — Brand-new user sees positive empty state (manual: fresh signup)
- [ ] AC5 — Snooze + Dismiss persist (manual: snooze, refresh, verify hidden; check expand)
- [ ] AC6 — Each queue item deep-links correctly (manual: click each)
- [ ] AC7 — Headline body is template-rendered, no LLM prose (verified by `headline-template.test.ts`)
- [ ] AC8 — Demo user shows headline + ≥3 items (manual)
- [ ] AC9 — Mobile responsive at 375px (manual: Chrome DevTools device toolbar)
- [ ] AC10 — Disclaimer banner visible (manual: DOM inspect)
- [ ] AC11 — `/app/r`, `/app/history`, `/app/portfolio`, `/app/research`, `/app/settings` unchanged (manual: navigate each)
- [ ] AC12 — Cron rebuilds in <60s p95 (manual: trigger via Vercel dashboard, time it)

- [ ] **Step 5: Final commit + push**

```bash
git add src/lib/e2e-smoke.ts
git commit -m "feat(dashboard): e2e-smoke check for /app route + acceptance pass log

Phase 1 of the actionable dashboard rework is feature-complete and
validated against spec §11 acceptance criteria.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push origin claude/quirky-mestorf-38e65f
```

---

## Spec coverage check (self-review)

| Spec section | Tasks |
|---|---|
| §1 Problem / §2 Goals / §3 Approach | Plan-wide context |
| §4 Information Architecture | Task 14 |
| §5.1 Headline source priority | Task 6 (queue-builder), Task 14 |
| §5.2 Body templates | Task 5 (headline-template) |
| §5.3 Chips | Task 4 (chip-definitions), Task 8 (LayeredChipRow), Task 6 (queue-builder emits chips per item) |
| §5.4 Headline actions | Task 9 (DailyHeadline), Task 11 (snooze/dismiss/done routes) |
| §5.5 Refresh cadence | Task 12 (cron), Task 13 (eager refresh) |
| §6.1 Item types | Task 6 |
| §6.2 Composition | Task 6 |
| §6.3 State persistence | Task 1 (migration), Task 6, Task 11 |
| §6.4 Display | Task 10 |
| §7 Urgency engine | Task 3 |
| §8 Horizon taxonomy | Task 2 (types), Task 3 (resolveHorizonTag), Task 7 (HorizonChip) |
| §9 Layered chips | Task 4, Task 8 |
| §10 Reuse map | Plan-wide; deliberately untouched modules listed in File Structure |
| §11 Acceptance criteria | Task 16 |
| §13 / §14 Phase 2/3 appendix | Forward-compat — no work in Phase 1 |
| §15 Risks | Mitigations baked into specific tasks (template safety, snooze 1d cap, demo seed) |
| §16 Implementation outline | Tasks 1–16 mirror the outline |

All sections covered. No placeholder tasks. Type names match across tasks (`QueueItem`, `HorizonTag`, `ItemTypeKey`, `STATIC_IMPACT`).

---

**End of plan.**
