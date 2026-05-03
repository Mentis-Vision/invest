# Phase 4 — Credibility Layer + Deferral Closures

> **Continues from Phase 3 (merged at d929001).** Goal: close every realistic deferral and add 11 institutional-grade indicators that meaningfully shift the app from "smart retail tool" to "this team has read the literature."

## 3 batches

### Batch I — Deferral closures

| Item | Action |
|---|---|
| **CAPE / Shiller PE** | Subsumed by Batch J #3 (Damodaran integration) — skip here. |
| **Quality scores nulling** (Piotroski/Altman/Beneish/Sloan need total_assets, retained_earnings, etc.) | Extend `src/lib/warehouse/refresh/fundamentals.ts` to pull missing fields from SEC Company Facts XBRL via `getCompanyFacts(ticker)`. Adds: total_assets, total_liabilities, total_equity, retained_earnings (NEW column), current_assets (NEW), current_liabilities (NEW), accounts_receivable (NEW), depreciation (NEW), sga (NEW), capex (existing). |
| **Glidepath bonds/cash modeled** | Add static asset-class enricher: `src/lib/dashboard/asset-class.ts` mapping known bond ETF tickers (TLT, AGG, BND, IEF, SHY, GOVT, LQD, HYG, MUB, TIP) → "bond" and commodity ETFs (GLD, IAU, SLV, USO, DBC, COMT) → "commodity". Used by glidepath visualizer to refine actual ring. |
| **Tax-harvest cost basis** | Inspect `holding` table schema. If cost-basis column exists, wire `tax-loader.ts` to use it. If not, document the gap and leave the math + UI in place (already merged in Batch H). |
| **Decision-engine Kelly integration** | Defer to v2 — the spec already deferred this and the existing decision engine has its own test surface. Don't touch in Batch I. Document as still-deferred. |

### Batch J — Top-5 credibility additions

1. **Fama-French 3/5 factor exposure card** — rolling 36-month regression vs. Mkt/SMB/HML (and RMW/CMA for 5-factor). Output: factor betas + R² + textual interpretation. Free data from Kenneth French Library.
2. **Monte Carlo retirement probability** — 10,000-path simulation against goal/glidepath; output single % + fan chart. Uses bootstrap from realized SPY returns.
3. **Damodaran implied cost-of-capital** — per-stock implied COE vs. NYU Stern monthly S&P ERP. Closes CAPE deferral.
4. **Analyst Revision Breadth (REV6)** — % of analysts up vs. down over trailing 6 months from Finnhub.
5. **Audit-Your-AI track record card** — public-facing card showing recent BUY-verdict accuracy + per-model attribution from outcomes data.

### Batch K — Secondary credibility additions

6. **Form 4 cluster signal** — detect 3+ insiders buying within 14 days, $100k+ each, non-10b5-1.
7. **CBOE SKEW + TIPS + FOMC dot-plot triad** — three macro tiles using Yahoo `^SKEW`, FRED DGS10/DFII10/T10YIE, and CME FedWatch.
8. **FINRA short-interest velocity** — bi-weekly delta + days-to-cover on the user's holdings.
9. **Behavioral self-audit card** — home bias + concentration drift + recency-chase counter.
10. **2008/2020/+100bps stress-test scenarios** — apply factor shocks via Fama-French betas.

## Discipline (per batch)

1. Implementer subagent with full task text
2. Run `npm test`, `npx tsc --noEmit`, `npm run build` — all clean
3. Iterate fix→retest until clean
4. Commit batch state in worktree branch
5. Push branch + merge `--no-ff` to main + push main
6. Move to next batch
7. Final cleanup: delete branch, remove worktree

## End-state target

- ~280-310 vitest tests
- 4 new top-tier credibility tiles + ~6 secondary
- All Phase 1-3 deferrals either closed or explicitly documented as v2
