# ClearPath Invest — Deferred Decisions & Open Items

**Last updated:** 2026-04-16

Running list of everything that was tabled during the P1–P5 implementation push. Each item notes why it was deferred, what triggers unblocking it, and the rough effort needed to close.

---

## Deferred by dependency (blocked on external account / key)

### SnapTrade verification (P2.1 live wiring)
- **Status:** Code + UI + DB schema all in place. The flow is: sign in → Portfolio → "Connect Brokerage" opens SnapTrade login portal in a popup → holdings sync on close.
- **Blocked on:** User's SnapTrade sandbox account finishing verification. Once verified, add to Vercel prod:
  - `SNAPTRADE_CLIENT_ID`
  - `SNAPTRADE_CONSUMER_KEY`
- **Already set:** `SNAPTRADE_ENCRYPTION_KEY` (32-byte random, production).
- **When unblocked:** E2E test — link a Sandbox brokerage (use Vanguard sandbox), confirm holdings populate in `/app?view=portfolio`, confirm trade sync populates `trade` table, run `/api/portfolio-review` on the real holdings.

### Resend (P4.3 / P4.4 email wiring)
- **Status:** `sendResetPassword` and `sendVerificationEmail` hooks wired into BetterAuth. Password reset and forgot-password pages built. `/lib/email.ts` ready.
- **Decision:** Use Vercel Marketplace → Resend (free 3k/mo tier) rather than Gmail SMTP. Cleaner DKIM/SPF, no risk to Mentis Google Workspace deliverability, zero marginal cost.
- **Blocked on:** Provisioning Resend via Vercel Marketplace:
  1. Vercel dashboard → project `invest` → Integrations → Resend → Add
  2. Verify `clearpath-invest.com` (or interim alias) as a sending domain
  3. Add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (e.g. `ClearPath Invest <no-reply@clearpath-invest.com>`) to Vercel prod env
  4. Set `REQUIRE_EMAIL_VERIFICATION=true` in production env
- **Note:** Today `REQUIRE_EMAIL_VERIFICATION` is intentionally **off** — turning it on without Resend locks everyone out. The demo user has `emailVerified = true` in the DB so sign-in works once verification is re-enabled.

### Sentry (P1.3 upgrade path)
- **Chose:** Minimal structured JSON logging to Vercel's native runtime logs (`src/lib/log.ts`). Zero accounts, zero vendor lock-in, greppable.
- **Sentry via Vercel Marketplace is explicitly rejected** — it bills on the Vercel invoice at a markup. We do not need to pay Vercel for observability.
- **Alternate route (in preference order):**
  1. **Stay with Vercel runtime logs + `log.error` JSON** for beta. Vercel's log UI is grep-friendly and already captures every error. No external account needed. Add a weekly cron that `SELECT`s error-frequency from logs via Vercel's Logs API into a summary email once Resend is live.
  2. **Axiom (free tier, 500MB/mo ingestion, Vercel-native log drain)** — when volume grows past what Vercel's log UI handles comfortably. Ships through the Vercel log-drain feature; SDK is `@axiomhq/nextjs`. Free forever for our scale, no Vercel markup.
  3. **Better Stack Logtail (free 1GB/mo)** — similar model to Axiom, slightly nicer alerting. Fine alternative if we prefer their UI.
  4. **Sentry direct (NOT via Vercel Marketplace)** — signing up at sentry.io gives a 5k-errors/mo free tier with the same SDK. Add `SENTRY_DSN` via `vercel env add` manually. Only reason to pick this over Axiom/Logtail is if we want structured exception grouping / issue tracking out of the box.
  5. **Self-hosted GlitchTip** (Sentry-compatible, open-source) — last resort. Needs its own hosting and DB. Not worth the maintenance at our scale.
- **Trigger to upgrade from (1):** first real user hits a silent 500, OR sustained >50 errors/day, OR the Vercel log UI becomes slow to filter. Whichever comes first.
- **Effort to migrate to Axiom later:** ~30min (Vercel Marketplace → Axiom integration → flip log drain → keep our `log.ts` unchanged).

---

## Compliance / legal — flagged for counsel review

### Terms of Service, Privacy Policy, Disclosures
- **Status:** Comprehensive drafts live at `/terms`, `/privacy`, `/disclosures`. Each is banner-marked *"Draft for attorney review"*.
- **Must do before first paying customer:**
  - Engage securities / fintech counsel in the operating jurisdiction.
  - Confirm the arbitration + class-action waiver language is enforceable in target states (California has specific requirements).
  - Confirm the "not a registered investment advisor" posture is correct — if we ever add personalized recommendations or fee-for-advice tiers, we may cross into SEC registration territory.
  - Confirm GDPR / CCPA posture. We currently say "Service not targeted to EEA/UK" — if that changes, full DPA + consent workflows need to be added.
  - Confirm state-by-state notification obligations in the event of a data breach.
- **Effort after counsel input:** 2–3 hours to fold redlines back in.

### SEC registration trigger
- **Watch item.** If ClearPath ever:
  - Takes custody of any client funds,
  - Charges a fee for personalized investment advice,
  - Publishes recommendations tied to a specific user's holdings without disclaimers,
  — we likely cross into Investment Adviser registration. The current positioning (research tool, generic analyses, informational only) is designed to stay outside that scope, but counsel should confirm as we add features like the portfolio review.

---

## Known bugs / regressions flagged during the session

### Production env bug: `GOOGLE_VERTEX_PROJECT` had literal `\n`
- **Fixed:** re-set via `printf`. Root cause: someone used `echo` earlier.
- **Prevention:** captured in `AGENTS.md` Rule #1 — "NEVER use `echo` for Vercel env vars."

### Local-only: `ANTHROPIC_BASE_URL` shell var overrides SDK default
- **Claude for Desktop sets `ANTHROPIC_BASE_URL=https://api.anthropic.com` in shell env** (no `/v1`). The `@ai-sdk/anthropic` SDK reads this and the base URL is wrong, causing `404 Not Found` on all Claude calls **during local development only**.
- **Fix for local runs:** `env -u ANTHROPIC_BASE_URL npm run dev` — or add `unset ANTHROPIC_BASE_URL` to `~/.zshrc` override.
- **Does not affect Vercel production** (env var not set there).

### `yahoo-finance2` v3 requires instantiation
- **Fixed:** `new YahooFinanceCtor({ suppressNotices: [...] })` at module scope. Previous code used the default export directly, which v3 no longer supports. Error message: "Call `const yahooFinance = new YahooFinance()` first."

### Schema constraint incompatibility across providers
- **Fixed:** removed `.min(N > 1)` and `.max(N)` from Zod schemas; guidance moved to `.describe()`. Claude's tool-use schema doesn't support `minItems > 1` and Gemini is strict about multi-item mins.

### npm audit — remaining vulnerabilities
- 4 moderate + 3 high, all in `@better-auth/cli` transitive dev deps (`drizzle-orm <0.45.2`, `lodash`, `chevrotain`, `@mrleebo/prisma-ast`).
- **Scope:** dev-tooling only. Does not affect runtime / prod bundle.
- **Fix path:** `npm audit fix --force` downgrades `@better-auth/cli` to 0.0.1 which is a breaking change to its CLI surface. Deferred until we have a clean upgrade path or the upstream ships a patched version.
- **Also pinned:** `axios@1.15.0` as a top-level dep to neutralize the critical `snaptrade-typescript-sdk`→axios<1.15 vulnerability. Re-evaluate after each `snaptrade-typescript-sdk` upgrade.

---

## Features intentionally deferred (P3.3 and beyond)

### Tool-calling for source data (P3.3, ~1 full day)
- Models currently get a pre-formatted text block. Upgrading to `generateText` + tool calls would let them quote, e.g., "per page 42 of the 10-Q filed 2026-01-15, R&D spending rose 34% YoY."
- Effort is significant because we need to:
  - Write tools: `getRecentFilings`, `getFilingText`, `getFredSeriesHistory`, `getAnalystRatings`.
  - Reconcile structured output with tool calling (the AI SDK supports both together in v6).
  - Update supervisor to review tool outputs too.
  - Re-do the cost accounting (streaming + multi-step usage).
- **Tackle in a focused session, not at the end of a long one.**

### Custom domain (`clearpathinvest.com`)
- **Status:** `clearpath-invest.vercel.app` works fine for beta.
- **Action:** User to check availability and purchase. Once owned, `vercel domains add clearpath-invest.com --scope mentisvision` and point DNS.
- **Effort:** 15 min once domain is owned.

### Real logo + favicon
- Placeholder SVG (line chart) reads as "tech startup," not "trusted publication." Brief a designer or generate with v0.
- Replace `favicon.ico`, generate the `icon-*.png` set, replace all inline `<svg>` usages (`MarketingNav`, `MarketingFooter`, `AuthLayout`, sign-in/sign-up).
- **Effort:** 2h after assets land.

### Waitlist notification webhook
- Signups accumulate silently in `waitlist` table. Add a Discord/Slack webhook POST (fire-and-forget) on new insert, or a daily cron that emails a digest via Resend.
- **Effort:** 30 min once Resend or webhook URL is available.

### "Copy link to analysis" on research results
- The recommendation is persisted with `recommendationId`, so a shareable route like `/app/r/:id` (owner-only view) is trivial. Would also satisfy the "refresh loses analysis" complaint.
- **Effort:** 1–2h.

### Dark-mode toggle in the app sidebar
- `next-themes` is already configured (`attribute="class"`). Need a toggle button in `AppShell` that calls `setTheme("dark"|"light"|"system")`.
- **Effort:** 30 min.

### News + sentiment ingestion per ticker (Finnhub / NewsAPI)
- Adds a real-time signal not in the SEC/FRED/Yahoo blocks. Needs rate limiting of its own and a per-ticker cache.
- **Effort:** half a day.

### Insider transactions (Form 4)
- SEC EDGAR has the data. High signal for conviction trades.
- **Effort:** half a day.

### Options flow / unusual activity
- Requires premium data (Polygon, CBOE). Post-launch at best.
- **Effort:** multi-day + vendor spend.

### Earnings call transcripts
- Free via Motley Fool, paid via Capital IQ. Would be a strong "qualitative edge" signal.
- **Effort:** 1 day integration + prompt engineering.

### User memory (risk tolerance, goals, sector preferences)
- `user_profile` table already exists (from the historical tracking migration). Need a preferences UI and prompt injection.
- **Effort:** 1 day.

### Sector data on holdings
- `snaptrade holdings` returns positions but not sectors. Portfolio review currently tells the models "sector data is not included" — noted in the prompt. For a real sector breakdown, look up sectors per ticker via Yahoo quoteSummary (already have the API wired) and cache in `holding.sector`.
- **Effort:** 1–2h.

---

## Known rough edges (low priority)

- **Dashboard `/app/misses` page.** Currently the track-record widget on `/app` links to `/app/history?filter=losses`, but the history page doesn't yet honor `?filter=losses`. Either wire the filter in `HistoryClient` (read `useSearchParams()` and default the `filter` textbox to the losses subset) or build a dedicated `/app/misses` page. Effort: 30 min.
- **Duplicate holdings fetch.** `PortfolioView` and `DashboardView` both call `/api/snaptrade/holdings` on mount. Cache for 60s at the route level with `revalidate` or hoist state. Effort: 30 min.
- **Mock macro + portfolio stats on dashboard.** Now live via `/api/track-record` and `/api/macro`. Old placeholder data is removed.
- **Dashboard view state persisted via `?view=`** — good, but dashboard tab nav doesn't update on back/forward navigation. Low priority — reload works.
- **Research result not persisted in URL.** Refresh loses the analysis. See "Copy link to analysis" above.
- **No risk-adjusted metrics in portfolio review.** Just concentration percentages. Models have macro context but no per-position beta or volatility. Intentional for v1 — add Sharpe/beta in a future pass.
- **No audit log of auth events.** BetterAuth sessions are stored but there's no dedicated log of sign-in attempts, password resets, OAuth grants. Helpful for security review. Effort: 1h.
- **No 2FA.** Low priority for beta; high priority before paid tiers launch.
- **FRED CPI is raw index.** The 12-month delta label computes YoY percent correctly, but the raw value in the snapshot isn't user-friendly. Add YoY-as-value rendering for index-type series in a future polish pass.

---

## Operational follow-ups (after launch)

- **Monitor daily cron runs.** `/api/cron/evaluate-outcomes` runs at 14:00 UTC. First signal of problems will appear in Vercel function logs under `cron.*` scope. Alert us (Slack webhook) on non-zero failure count.
- **Track Anthropic / OpenAI / Google API cost monthly.** We estimate in cents per call; reconcile against the actual invoices at month-end. If the cap is undershooting, tighten; overshooting, loosen.
- **Backups.** Neon's free tier has point-in-time recovery for 7 days. If that becomes a concern, upgrade to paid tier for longer retention — especially once real user data (recommendations, trades) accumulates.
- **Rate-limit volume.** If sustained qps on `/api/research` rises above ~20/min across the app, migrate the Postgres-backed rate limiter in `src/lib/rate-limit.ts` to Upstash Redis. Effort: 2h once the Upstash integration is provisioned.

---

## Decisions that are locked and should not be revisited without a reason

- Direct provider SDKs (Anthropic / OpenAI / Vertex), **not** Vercel AI Gateway. Rationale: billing consolidation with Mentis Vision, no ~5% Gateway markup.
- Brokerage integration: SnapTrade. We tried Plaid first — the code is written but was removed in favor of SnapTrade's lower per-user cost.
- Hosting: Vercel (not Sliplane). Sliplane hosts Mentis Vision production; ClearPath is deliberately isolated to avoid noisy-neighbor CPU.
- DB: Neon (via `@neondatabase/serverless`). No Drizzle migrations flow yet — all migrations are hand-applied via Neon MCP.
- Auth: BetterAuth. Social providers: Google only (for now). Email verification gated behind env flag.
- Legal posture: informational tool, not an RIA. First-run disclaimer acknowledgment persisted. Every verdict surface shows "not investment advice" banner. Track-record surfaces show "past performance" disclaimer.
