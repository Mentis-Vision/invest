# Phase 2 Science Layer + Phase 3 Personal Layer — Master Plan

> **For agentic workers:** Execute one batch at a time. After each batch: run full vitest + tsc + build, fix until clean, push branch, merge to main from parent repo (`git merge --no-ff worktree-phase2-science-layer`), push main. Branch stays alive across batches.

**Spec:** `docs/superpowers/specs/2026-05-02-actionable-dashboard-phase-1-design.md` §13 (Phase 2 appendix) and §14 (Phase 3 appendix)

**Goal:** Deliver the 14-algorithm Phase 2 scientific edge plus Phase 3 personal layer (goals, tax windows, year outlook). Each algorithm becomes a chip / queue item / context tile that plugs into the Phase 1 scaffold without rework.

**Tech stack:** Same as Phase 1 — Next.js 16.2.4, React 19.2, TypeScript 5, Vitest 4.1, Neon Postgres, BetterAuth, Tailwind v4 + Base UI shadcn.

**Hard constraints:** All AGENTS.md hard rules from Phase 1 still apply. No new algorithms in template prose (templates stay deterministic). Warehouse rules #8-#12 enforced. No motion `initial:opacity:0`.

---

## Batch order (8 batches)

### Phase 2 (Science Layer)

| Batch | Scope | Files (rough) | Tests target |
|---|---|---|---|
| **A** | Risk math (Sharpe / Sortino / Max Drawdown / β) | `src/lib/dashboard/metrics/risk.ts` + tests · `<RiskTile>` component · queue-builder enrichment | +12 tests |
| **B** | Quality Card bundle (Piotroski + Altman + Beneish + Sloan) | `src/lib/dashboard/metrics/quality.ts` + tests · `<QualityCard>` component · new chip types · queue-builder hook | +20 tests |
| **C** | 12-1 Momentum + Fractional Kelly position sizing | `src/lib/dashboard/metrics/momentum.ts` + tests · `src/lib/dashboard/metrics/kelly.ts` + tests · chip emissions in queue items | +12 tests |
| **D** | Market Regime composite (VIX term structure + put/call + FOMC + gamma) + CAPE/Buffett valuation chip | `src/lib/dashboard/metrics/regime.ts` + tests · `<MarketRegimeTile>` component | +10 tests |
| **E** | Portfolio VaR / CVaR | `src/lib/dashboard/metrics/var.ts` + tests · risk headline tile | +8 tests |

### Phase 3 (Personal Layer)

| Batch | Scope | Files | Tests target |
|---|---|---|---|
| **F** | Goals onboarding + storage (target wealth, target date, risk tolerance, sector excludes already exist) | DB migration: `user_goal` table · `<GoalsForm>` component · `/api/goals` route · queue-builder uses goals | +6 tests |
| **G** | Year outlook surface — full Year horizon dashboard at `/app?view=year-outlook` | `src/app/app/year-outlook/page.tsx` (or `?view=year-outlook` branch) · `<YearOutlook>` component · pacing calculation | +8 tests |
| **H** | Tax-loss harvest + wash-sale detector + chip prefs | `src/lib/dashboard/metrics/tax.ts` + tests · `<TaxHarvestCard>` · `user_profile.chip_prefs JSONB` · per-user chip preference loader | +14 tests |

---

## Discipline (per batch)

1. **Implementer subagent** per batch with full task text from the relevant section below.
2. After implementation: `npm test`, `npx tsc --noEmit`, `npm run build`. **All three must pass.** If any fails: dispatch fix subagent with the exact error output and the failing files.
3. Iterate fix→retest until **clean** (0 errors).
4. **Commit final batch state** in the worktree branch.
5. **Merge to main** from parent repo with `git merge --no-ff worktree-phase2-science-layer -m "..."`.
6. **Push origin/main**.
7. Move to next batch.

---

## Batch A — Risk math (Sharpe / Sortino / MaxDD / β)

**Scope:** Compute realized portfolio risk metrics from holdings + price history. Surface as a context tile + chips on existing items.

### Files

**Create:**
- `src/lib/dashboard/metrics/risk.ts` — pure math (Sharpe, Sortino, max drawdown, beta vs SPY)
- `src/lib/dashboard/metrics/risk.test.ts` — vitest with synthetic return series
- `src/lib/dashboard/metrics/risk-loader.ts` — loads daily returns for user's holdings + SPY benchmark from `ticker_market_daily`, computes the metrics
- `src/components/dashboard/risk-tile.tsx` — server component, renders Sharpe/Sortino/MaxDD/β as a 4-cell tile

**Modify:**
- `src/app/app/page.tsx` — replace one of the placeholder context tiles with `<RiskTile>`
- `src/lib/dashboard/queue-sources.ts` — populate `portfolioYtdPct` and `spyYtdPct` from the same risk-loader (eliminating the deferred placeholder from Phase 1)

### Math (pure functions)

```ts
// src/lib/dashboard/metrics/risk.ts

export function meanReturn(returns: number[]): number {
  if (returns.length === 0) return 0;
  return returns.reduce((s, r) => s + r, 0) / returns.length;
}

export function stdDev(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mu = meanReturn(returns);
  const sumSq = returns.reduce((s, r) => s + (r - mu) ** 2, 0);
  return Math.sqrt(sumSq / (returns.length - 1));
}

export function downsideDeviation(returns: number[], minAcceptable = 0): number {
  if (returns.length < 2) return 0;
  const downside = returns.map((r) => Math.min(0, r - minAcceptable));
  const sumSq = downside.reduce((s, r) => s + r * r, 0);
  return Math.sqrt(sumSq / (returns.length - 1));
}

export function annualize(periodicReturn: number, periodsPerYear = 252): number {
  return periodicReturn * periodsPerYear;
}

export function annualizedVol(periodicVol: number, periodsPerYear = 252): number {
  return periodicVol * Math.sqrt(periodsPerYear);
}

// Sharpe = (annualized excess return) / (annualized vol). riskFreeAnnual default 4% (10Y treasury approx).
export function sharpeRatio(dailyReturns: number[], riskFreeAnnual = 0.04): number {
  if (dailyReturns.length < 2) return 0;
  const mu = annualize(meanReturn(dailyReturns));
  const sigma = annualizedVol(stdDev(dailyReturns));
  if (sigma === 0) return 0;
  return (mu - riskFreeAnnual) / sigma;
}

// Sortino = (annualized excess return) / (annualized downside dev). Penalizes only negative deviations.
export function sortinoRatio(dailyReturns: number[], riskFreeAnnual = 0.04): number {
  if (dailyReturns.length < 2) return 0;
  const mu = annualize(meanReturn(dailyReturns));
  const dvol = annualizedVol(downsideDeviation(dailyReturns));
  if (dvol === 0) return 0;
  return (mu - riskFreeAnnual) / dvol;
}

// Max drawdown over the cumulative return series. Returns negative number, e.g. -0.18 = -18%.
export function maxDrawdown(dailyReturns: number[]): number {
  if (dailyReturns.length === 0) return 0;
  let peak = 1;
  let cumulative = 1;
  let maxDd = 0;
  for (const r of dailyReturns) {
    cumulative *= 1 + r;
    if (cumulative > peak) peak = cumulative;
    const dd = (cumulative - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

// Beta vs benchmark. Both arrays must be the same length and aligned by date.
export function beta(portfolioReturns: number[], benchmarkReturns: number[]): number {
  if (portfolioReturns.length < 2 || portfolioReturns.length !== benchmarkReturns.length) return 0;
  const muP = meanReturn(portfolioReturns);
  const muB = meanReturn(benchmarkReturns);
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < portfolioReturns.length; i++) {
    cov += (portfolioReturns[i] - muP) * (benchmarkReturns[i] - muB);
    varB += (benchmarkReturns[i] - muB) ** 2;
  }
  if (varB === 0) return 0;
  return cov / varB;
}

// Convenience aggregator
export interface PortfolioRisk {
  sharpe: number;
  sortino: number;
  maxDrawdownPct: number; // 0 to -1
  beta: number;
  ytdPct: number;
  benchYtdPct: number;
  sampleSize: number; // days of data
}

export function computePortfolioRisk(
  portfolioDaily: number[],
  benchmarkDaily: number[],
): PortfolioRisk {
  return {
    sharpe: sharpeRatio(portfolioDaily),
    sortino: sortinoRatio(portfolioDaily),
    maxDrawdownPct: maxDrawdown(portfolioDaily),
    beta: beta(portfolioDaily, benchmarkDaily),
    ytdPct: portfolioDaily.reduce((cum, r) => cum * (1 + r), 1) - 1,
    benchYtdPct: benchmarkDaily.reduce((cum, r) => cum * (1 + r), 1) - 1,
    sampleSize: portfolioDaily.length,
  };
}
```

### Tests (TDD)

`src/lib/dashboard/metrics/risk.test.ts`:

- meanReturn / stdDev / downsideDeviation against known synthetic series (e.g., `[0.01, -0.005, 0.003]`)
- sharpeRatio: positive returns + low vol → positive. Equal-amplitude up/down with mean = 0 → returns negative-ish (risk-free drag).
- sortinoRatio: same as above but only downside deviation in denominator.
- maxDrawdown: rising series → 0. Down then up → captures the trough. Always-down → -1 asymptote.
- beta: identical series → 1.0. Inverse series → -1.0. Independent series → near 0.
- computePortfolioRisk: returns object with all 7 fields populated.

### Loader

`src/lib/dashboard/metrics/risk-loader.ts`:

```ts
import { pool } from "../../db";
import { log } from "../../log";
import { computePortfolioRisk, type PortfolioRisk } from "./risk";

const BENCH_TICKER = "SPY";
const LOOKBACK_DAYS = 365; // 1y window

export async function loadPortfolioDailyReturns(userId: string): Promise<{
  portfolio: number[];
  benchmark: number[];
}> {
  // 1. Read user's current holdings + their tickers
  const holdings = await pool.query<{ ticker: string; weight: number }>(
    `WITH totals AS (
       SELECT SUM("lastValue") AS total
       FROM holding
       WHERE "userId" = $1 AND ticker NOT IN ('CASH', 'USD')
     )
     SELECT h.ticker, (h."lastValue" / NULLIF(t.total, 0))::float AS weight
     FROM holding h, totals t
     WHERE h."userId" = $1 AND h.ticker NOT IN ('CASH', 'USD') AND h."lastValue" > 0`,
    [userId],
  );
  if (holdings.rows.length === 0) return { portfolio: [], benchmark: [] };

  const tickers = holdings.rows.map((r) => r.ticker);
  const weightMap = new Map(holdings.rows.map((r) => [r.ticker, r.weight]));

  // 2. Read aligned daily prices for these tickers + benchmark
  const allTickers = [...tickers, BENCH_TICKER];
  const prices = await pool.query<{ ticker: string; date: string; close: number }>(
    `SELECT ticker, date, close
     FROM ticker_market_daily
     WHERE ticker = ANY($1::text[])
       AND date >= CURRENT_DATE - $2::int
     ORDER BY date ASC`,
    [allTickers, LOOKBACK_DAYS],
  );

  // 3. Pivot into a date-keyed map
  const byDate = new Map<string, Map<string, number>>();
  for (const row of prices.rows) {
    if (!byDate.has(row.date)) byDate.set(row.date, new Map());
    byDate.get(row.date)!.set(row.ticker, row.close);
  }

  // 4. For each consecutive pair of dates, compute weighted-portfolio return + benchmark return
  const dates = Array.from(byDate.keys()).sort();
  const portfolio: number[] = [];
  const benchmark: number[] = [];

  for (let i = 1; i < dates.length; i++) {
    const prevPrices = byDate.get(dates[i - 1])!;
    const curPrices = byDate.get(dates[i])!;

    let pRet = 0;
    let totalWeight = 0;
    for (const t of tickers) {
      const prev = prevPrices.get(t);
      const cur = curPrices.get(t);
      if (prev && cur && prev > 0) {
        const w = weightMap.get(t)!;
        pRet += w * ((cur - prev) / prev);
        totalWeight += w;
      }
    }
    if (totalWeight === 0) continue;

    const bPrev = prevPrices.get(BENCH_TICKER);
    const bCur = curPrices.get(BENCH_TICKER);
    if (!bPrev || !bCur || bPrev <= 0) continue;
    const bRet = (bCur - bPrev) / bPrev;

    portfolio.push(pRet / totalWeight);
    benchmark.push(bRet);
  }

  log.info("dashboard.risk", "loadPortfolioDailyReturns", {
    userId,
    holdingsCount: holdings.rows.length,
    samples: portfolio.length,
  });

  return { portfolio, benchmark };
}

export async function getPortfolioRisk(userId: string): Promise<PortfolioRisk | null> {
  const { portfolio, benchmark } = await loadPortfolioDailyReturns(userId);
  if (portfolio.length < 20) return null; // not enough data for stable metrics
  return computePortfolioRisk(portfolio, benchmark);
}
```

### RiskTile component

`src/components/dashboard/risk-tile.tsx` (server component):

```tsx
import { getPortfolioRisk } from "@/lib/dashboard/metrics/risk-loader";

function fmtRatio(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(2);
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export async function RiskTile({ userId }: { userId: string }) {
  const risk = await getPortfolioRisk(userId);
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded p-3">
      <div className="text-[10px] tracking-widest uppercase text-[var(--muted-foreground)] mb-2">
        Portfolio Risk · {risk?.sampleSize ?? 0}d
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div className="text-center">
          <div className="text-[10px] text-[var(--muted-foreground)]">Sharpe</div>
          <div className="font-bold">{risk ? fmtRatio(risk.sharpe) : "—"}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-[var(--muted-foreground)]">Sortino</div>
          <div className="font-bold">{risk ? fmtRatio(risk.sortino) : "—"}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-[var(--muted-foreground)]">Max DD</div>
          <div className="font-bold text-[var(--sell)]">{risk ? fmtPct(risk.maxDrawdownPct) : "—"}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-[var(--muted-foreground)]">β vs SPY</div>
          <div className="font-bold">{risk ? fmtRatio(risk.beta) : "—"}</div>
        </div>
      </div>
    </div>
  );
}
```

### Page integration

In `src/app/app/page.tsx`, replace the placeholder `Portfolio MTD` tile with `<RiskTile userId={userId} />`. Keep the other two tiles as stubs for Batch D (regime) and Batch G (year outlook).

### queue-sources enrichment

Update `getReviewSummary()` in `src/lib/dashboard/queue-sources.ts`: replace the deferred `portfolioYtdPct: undefined` / `spyYtdPct: undefined` with values pulled from `getPortfolioRisk(userId)` (specifically `risk.ytdPct` and `risk.benchYtdPct`). Cache opportunistically (the loader is somewhat heavy).

### Commit messages (use exactly):

1. `feat(dashboard): risk math primitives (Sharpe/Sortino/MaxDD/β)`
2. `feat(dashboard): risk-loader + SPY benchmark from warehouse`
3. `feat(dashboard): RiskTile + page integration + queue-sources YTD wiring`

---

## Batch B — Quality Card (Piotroski + Altman + Beneish + Sloan)

**Scope:** Compute fundamental quality scores from `ticker_fundamentals` warehouse data. Surface as a per-position chip + an aggregate "Quality breach" item type (when a held position's quality decays).

### Files

**Create:**
- `src/lib/dashboard/metrics/quality.ts` — Piotroski F-Score (9 binary checks, 0-9), Altman Z-Score, Beneish M-Score, Sloan Accruals
- `src/lib/dashboard/metrics/quality.test.ts` — vitest with synthetic fundamentals
- `src/lib/dashboard/metrics/quality-loader.ts` — reads `ticker_fundamentals` for user's holdings, computes scores per ticker
- `src/components/dashboard/quality-card.tsx` — drill view: per-ticker quality breakdown
- New item type `quality_decline` in `src/lib/dashboard/types.ts` (extend `ItemTypeKey`)
- Update `STATIC_IMPACT` in `urgency.ts` to add `quality_decline: 50`
- Add quality_decline template in `headline-template.ts`
- Add chip emissions for `F-Score`, `Z`, `M`, `accruals` in chip-definitions

### Math (verbatim formulas, all 4 checks)

Piotroski F-Score (sum of 9 binary checks, range 0-9). Altman Z = `1.2*A + 1.4*B + 3.3*C + 0.6*D + 1.0*E` where A=working capital/total assets, B=retained earnings/total assets, C=EBIT/total assets, D=market value equity/total liabilities, E=sales/total assets.

Beneish M-Score = `−4.84 + 0.92·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI`. M > −1.78 → likely manipulator.

Sloan Accruals Ratio = `(NetIncome - CFO) / TotalAssets`. Lower is better; high accruals signal earnings-quality red flag.

The implementer subagent will read the actual `ticker_fundamentals` schema via Neon MCP first to confirm field names, then write the formulas with the actual column names.

### queue-builder hook

Add a new section in `queue-builder.ts` (between concentration and catalyst): for each held ticker, compute current Piotroski F-Score; if it dropped ≥ 2 points vs. the prior fiscal period, emit a `quality_decline` item.

---

## Batch C — 12-1 Momentum + Fractional Kelly

**Scope:** Position sizing recommendation chip, momentum chip on each position, Kelly modulation of HIGH_CONVICTION queue items.

### Files

**Create:**
- `src/lib/dashboard/metrics/momentum.ts` + tests — `compute12_1Momentum(prices: number[]): number` (return over 12mo minus 1mo)
- `src/lib/dashboard/metrics/kelly.ts` + tests — `fractionalKelly(winRate, winAvg, lossAvg, fraction = 0.25): number` returns optimal position size as portfolio fraction
- Loader that runs both per ticker

**Modify:**
- `queue-builder.ts` — emit `mom +X%` chip per position card · add Kelly-derived `pos size` chip on stale_rec / catalyst_prep items
- `decision-engine` integration — feed Kelly fraction back into `PositionSizing.suggested_max_pct`

---

## Batch D — Market Regime composite + CAPE/Buffett

**Scope:** Single global regime tile that modulates the queue's interpretation. CAPE/Buffett as a discreet macro chip.

### Files

**Create:**
- `src/lib/dashboard/metrics/regime.ts` — composite of: VIX9D/VIX ratio (term structure), put/call ratio, days-to-FOMC, index gamma exposure (if available). Returns `{ regime: 'RISK_ON'|'NEUTRAL'|'FRAGILE'|'STRESS', signals: [...] }`
- `src/lib/dashboard/metrics/macro-valuation.ts` — pulls Shiller CAPE from FRED (series `MULTPL/SHILLER_PE_RATIO_MONTH`) + Buffett indicator (Wilshire5000 / GDP)
- `<MarketRegimeTile>` component
- Integration: regime label appears as the third context tile (replacing the "Macro" placeholder)

---

## Batch E — Portfolio VaR / CVaR

**Scope:** Risk headline showing worst-case loss at 95% / 99% confidence + expected shortfall.

### Files

**Create:**
- `src/lib/dashboard/metrics/var.ts` — historical VaR (5th percentile loss), parametric VaR (mean - 1.65σ), CVaR (mean of returns below VaR threshold)
- `<VarTile>` component — replaces the "2026 pace" stub with risk headline (year-pace moves to Year Outlook in Batch G)

---

## Batch F (Phase 3 start) — Goals onboarding

**Scope:** New `user_goal` table. Onboarding form for first-run users. Goals feed the queue (rebalance triggers when allocation drifts from target).

### Files

**Create:**
- Migration: `migrations/2026-05-04-user-goal.sql` — `user_goal(userId, target_wealth, target_date, risk_tolerance, retirement_age, monthly_contribution)` table
- `<GoalsForm>` component
- `/api/goals` POST/GET routes
- New item type `rebalance_drift` in queue-builder (allocation vs goal-glide-path target)

---

## Batch G — Year Outlook surface

**Scope:** Full Year-horizon dashboard at `/app?view=year-outlook` showing pacing, drift, glidepath visualization.

### Files

**Create:**
- New `<YearOutlook>` component
- Pacing math: actual vs goal trajectory
- Charts via existing `recharts` dep
- Wire into `DashboardClient` `?view=year-outlook` branch

---

## Batch H — Tax-loss harvest + chip prefs

**Scope:** Surface tax-loss-harvest opportunities (per spec ~0.7-1.1%/yr alpha). Per-user chip pinning preference.

### Files

**Create:**
- Migration: extend `user_profile.chip_prefs JSONB`
- `src/lib/dashboard/metrics/tax.ts` + tests — find positions with unrealized loss, suggest replacement (correlation-mapped)
- `<TaxHarvestCard>` component (queue item type)
- Chip preference loader & UI control in settings page

---

## End-state verification

After Batch H:
- `npm test` — should be ≥ 51 + ~90 = ~141 tests passing
- `npm run build` — clean
- `npx tsc --noEmit` — clean
- `/app` shows: Daily Headline + Decision Queue + 3 fully-populated context tiles (Risk, Regime, Year-pace headline)
- New surface: `/app?view=year-outlook` for the full Year horizon
- Goals onboarding triggers on first run
- Tax-harvest items appear in queue when applicable

Then: merge final branch state to main if not already up-to-date, delete `worktree-phase2-science-layer` branch, remove worktree.

---

**End of master plan. Per-batch implementation details live in this doc and are dispatched as subagent task text.**
