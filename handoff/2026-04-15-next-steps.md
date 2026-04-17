# ClearPath Invest — Next Steps

**Created:** 2026-04-15
**Purpose:** Prioritized execution plan for the work remaining after the initial build. Read `2026-04-15-state-of-app.md` first for full context.
**Intent:** Work through this top-to-bottom in a local Claude Code session. Each item has file paths, approach, and acceptance criteria.

---

## Ground rules for the next session

1. **Never use `echo` to set Vercel env vars.** It appends `\n`. Use `printf "VALUE"`.
2. **Never wrap meaningful content in a motion.div with `initial: opacity: 0`.** Animate color, scale, or transform instead. Two bugs in this repo came from this pattern.
3. **`generateObject` from the `ai` package is still valid** in v6.0.162 — hook warnings claiming otherwise are wrong.
4. **Don't touch `proxy.ts` matcher without re-testing CSS loading.** The matcher must exclude `_next/static`.
5. **Direct provider keys, not AI Gateway.** Don't migrate back.
6. **Motion-library wrappers are banned around content.** Decorative animation only.
7. **Demo user is `demo@clearpathinvest.app` / `DemoPass2026!`** — use it for all Plaid/brokerage testing. Don't delete.

---

## Priority 1 — Protect the wallet (do FIRST)

Before onboarding anyone — including beta testers or the demo user running live AI queries — these must exist or you'll get a nasty Anthropic/OpenAI bill.

### 1.1 Rate limiting on `/api/research` and `/api/strategy`

**Why:** 3 model calls per research query, ~$0.03–0.10 each. Without limits one bot can burn $50 in minutes.

**Approach:**
- Provision an Upstash Redis via the Vercel Marketplace (one-click, free tier covers this case).
- `npm install @upstash/ratelimit @upstash/redis`
- Create `src/lib/rate-limit.ts` with a sliding-window limiter: 20 requests per user per hour, 5 per anon IP per hour.
- Call it at the top of `/api/research/route.ts` and `/api/strategy/route.ts`. On limit hit, return `429` with `Retry-After` header.

**Accept when:** running the same ticker 25 times in a row from one account returns 429 on calls 21+.

### 1.2 Per-user monthly cost cap

**Why:** Even within rate limits, a user on the Beta tier could rack up $50/mo in model spend.

**Approach:**
- Add `monthlyUsage` column to `user` table on Neon: `monthlyTokens INT DEFAULT 0`, `monthlyTokensResetAt TIMESTAMP`.
- After each `generateObject` call in `consensus.ts`, increment the user's counter by `result.usage.totalTokens`.
- Before kicking off a research run, check counter against tier cap (Beta: 500k tokens/mo ≈ 100 queries).
- On cap hit, return structured error `{ error: "monthly_limit", resetAt: "..." }` — UI shows friendly message.

**Accept when:** the cap is enforced server-side and visible to the user in the UI.

### 1.3 Error logging

**Why:** right now, a failed Claude call returns generic 500 and you have no idea why.

**Approach (pick one):**
- **Easiest:** install Sentry via Vercel integration. `npm install @sentry/nextjs`, run `npx @sentry/wizard@latest -i nextjs`.
- **Minimal:** just wrap `console.error` in structured JSON and let Vercel's built-in logs collect them. Add a `logError(context, err)` helper in `src/lib/log.ts` and use it in every catch block in `api/` and `lib/ai/consensus.ts`.

**Accept when:** intentionally breaking Claude by overriding the env var to garbage, you can see a structured error in Vercel's logs within 5 seconds.

---

## Priority 2 — Ship the "wow" moment (Plaid / brokerage)

The `/app/portfolio` view has a "Connect Brokerage" button that goes nowhere. That's the single biggest "why is this product real" moment. Wire it.

### 2.1 Plaid Link integration

**Why:** Read-only brokerage sync is what makes ClearPath useful beyond "type a ticker and see an analysis."

**Approach:**
1. Create Plaid developer account → get `PLAID_CLIENT_ID`, `PLAID_SECRET`, and use the `Sandbox` environment first.
2. `npm install plaid react-plaid-link`
3. Add env vars to Vercel: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox`.
4. Server route `src/app/api/plaid/link-token/route.ts`: creates a Link token for the current user using their BetterAuth userId as `client_user_id`.
5. Server route `src/app/api/plaid/exchange/route.ts`: exchanges `public_token` for `access_token`, stores it encrypted in a new Neon table `plaid_item` (user_id, access_token_encrypted, item_id, institution_name, status, createdAt).
6. Server route `src/app/api/plaid/holdings/route.ts`: calls Plaid `/investments/holdings/get`, returns normalized holdings array.
7. Client: rewrite `src/components/views/portfolio.tsx` to use `usePlaidLink` hook. On success, call `/exchange`, then fetch `/holdings` and render the real holdings table.

**Security:** encrypt `access_token` at rest — use a symmetric key from env (`PLAID_ENCRYPTION_KEY`, 32 bytes). Don't store unencrypted.

**Accept when:** signing in as `demo@clearpathinvest.app`, clicking "Connect Brokerage," choosing a Plaid Sandbox brokerage, completing the flow, and seeing the holdings table populated with real sandbox data.

### 2.2 Portfolio-level analysis

**Why:** Once holdings sync, the user wants "am I overweight tech?" / "where are my risks?" — not just per-ticker.

**Approach:**
- New endpoint `src/app/api/portfolio-review/route.ts` — fetches user's holdings + macro snapshot, feeds both into the same `runAnalystPanel` + `runSupervisor` pipeline, but with a different system prompt focused on concentration risk, sector balance, and macro alignment.
- Extend `AnalystOutputSchema` (or make a new `PortfolioAnalystSchema`) with fields: `concentrationRisks`, `sectorImbalances`, `macroAlignment`, `rebalancingSuggestions`.
- Wire `src/components/views/strategy.tsx` to this endpoint.

**Accept when:** the Strategy tab produces a real portfolio review citing actual holdings from Plaid.

---

## Priority 3 — Strengthen the AI agent

### 3.1 Give each model a distinct analyst persona

**Why:** right now all 3 models get the same system prompt and tend to converge on the same answer. "Unanimous consensus" is an artifact of prompt uniformity, not independent reasoning.

**Approach:**
Modify `runAnalystPanel` in `src/lib/ai/consensus.ts` to send different system prompts per model:
- **Claude (value investor):** "You are a disciplined value investor in the Graham-Dodd tradition. Prioritize margin of safety, valuation relative to intrinsic value, and long-term cash flow durability."
- **GPT (growth investor):** "You are a growth-focused analyst. Prioritize revenue trajectory, TAM expansion, competitive moats, and reinvestment quality over near-term valuation."
- **Gemini (macro skeptic):** "You are a macro-aware contrarian. Prioritize regime risk (rates, liquidity, geopolitical), crowded positioning, and downside scenarios. Assume consensus is wrong."

Keep the ZERO HALLUCINATION rules identical — only the analytical lens differs. Disagreement now *means something*.

**Accept when:** running the same ticker produces materially different theses across the three models more often than not.

### 3.2 Rotate the supervisor across model families

**Why:** right now Claude is both analyst #1 and supervisor — same-family bias.

**Approach:**
In `runSupervisor`, round-robin the supervisor model by day-of-year or query count. Or always use Haiku (`claude-haiku-4-5`) — deliberately smaller and cheaper, reduces the "supervisor over-defers to analyst Claude" risk.

**Accept when:** supervisor assignment is visible in the response payload and rotates.

### 3.3 Tool-calling for source data (big one — defer to a focused session)

**Why:** models currently see a pre-formatted text block. They can't say "per page 42 of the 10-Q filed 2026-01-15, R&D spending rose 34% YoY." They can only see what we pre-digested.

**Approach:**
- Convert `consensus.ts` from `generateObject` to `generateText` with tools.
- Define tools: `getRecentFilings(ticker, form)`, `getFilingText(accession)`, `getFredSeriesHistory(seriesId, months)`, `getAnalystRatings(ticker)`.
- Models make dynamic tool calls during analysis; each tool returns a structured response that becomes part of the evidence chain.
- Still enforce: any numeric claim in the final output must quote verbatim from a tool response.

**This is a full day of work** — don't attempt while tired.

### 3.4 Historical macro trends, not just snapshots

**Why:** "Fed funds at 5.33%" is less useful than "Fed funds rose from 0.25% to 5.33% over 18 months."

**Approach:**
Extend `src/lib/data/fred.ts`: `getSeriesHistory(seriesId, months)` returning last N monthly observations. Feed into the data block as a trend line, e.g., `DGS10 (12mo): 3.8% → 4.4% (+0.6pp)`.

**Accept when:** models reference trend direction in their analyses.

---

## Priority 4 — Legal + trust essentials (before first paying customer)

Without these, charging money is legally risky for a finance product.

### 4.1 Terms of Service + Privacy Policy

**Location:** `/terms`, `/privacy`
**Content:** use a reputable template (Termly, iubenda, or a plain-English version modeled on Wealthfront's). Key clauses:
- Explicit "not investment advice" language.
- No fiduciary duty.
- Arbitration clause.
- Data handling — specifically: we don't sell, don't train models on user data, don't share with third parties.
- Plaid/brokerage permissions are read-only.

Link from footer.

### 4.2 Stronger investment-advice disclaimer

**Why:** "Informational purposes only" in a footer is weak for a finance product.

**Approach:**
- Every verdict card in `/app/research` should render a dismissable banner at the top: "For informational purposes only. Not investment advice. Consult a licensed advisor."
- The first time a user runs a research query, require a one-click "I understand" affirmation stored in `user.disclaimerAcceptedAt`. Don't re-prompt after.

### 4.3 Email verification on sign-up

**Why:** right now anyone can sign up as `warren.buffett@berkshire.com`. That's a fraud and impersonation risk.

**Approach:**
- Install Resend via Vercel Marketplace (free 3k/mo).
- Configure BetterAuth's `emailAndPassword.requireEmailVerification = true`.
- Create `src/lib/email/verification.ts` that calls Resend to send a verification link via BetterAuth's hook.
- New users land on a "check your email" screen until they click the link.

**Accept when:** signing up returns a "verify your email" screen and you can't sign in until you click the link.

### 4.4 Password reset flow

**Why:** right now if a user forgets, they're stuck.

**Approach:**
- BetterAuth has built-in `forgotPassword` — enable it, wire it to the same Resend integration.
- Add `/forgot-password` and `/reset-password/[token]` pages matching the Editorial Warm theme.

---

## Priority 5 — Polish and brand

### 5.1 Real logo + favicon

Right now it's a placeholder SVG line chart. Not awful but forgettable.

**Approach:**
- Design (or commission) a proper wordmark. Constraints: monochrome, works at favicon size, reads "financial publication" not "tech startup."
- Replace `src/app/favicon.ico` with properly generated favicon set (favicon.ico + apple-touch-icon.png + icon-*.png).
- Replace all `<svg>` usages of the line-chart placeholder across `MarketingNav`, `MarketingFooter`, `AuthLayout`, sign-in/sign-up pages.

### 5.2 Custom domain ✅ (shipped 2026-04-16)

Custom domain `clearpathinvest.app` is live (also `www.clearpathinvest.app`). Old `clearpath-invest.vercel.app` alias is no longer bound to this project. `BETTER_AUTH_URL` env var updated; sitemap / robots / OG image / in-code fallbacks all updated. Reminder: GCP OAuth authorized-redirect-URI must point at `https://clearpathinvest.app/api/auth/callback/google` — verify in Google Cloud Console.

### 5.3 OG image for link previews

When someone shares a ClearPath link, it currently shows the generic Vercel OG image.

**Approach:**
- Next.js App Router supports `opengraph-image.tsx` per route.
- Create `src/app/opengraph-image.tsx` using `ImageResponse` from `next/og` — render the Fraunces headline "Know what to do with your money" over the warm ivory background. Size: 1200x630.

### 5.4 CLAUDE.md / AGENTS.md polish for the repo

These exist but are minimal. Update them with:
- The bug patterns to avoid (motion opacity, proxy matcher, `echo` vs `printf`)
- Demo user creds
- "Read handoff/2026-04-15-state-of-app.md first"

---

## Priority 6 — New features (once core is hardened)

These are "nice to have" after P1–P5. Don't start before the basics are solid.

- **News + sentiment ingestion** — per-ticker news feed (Finnhub or NewsAPI) with sentiment analysis as an additional signal.
- **Insider transactions (Form 4)** — SEC EDGAR has these; relevant for conviction.
- **Options flow / unusual activity** — premium data sources (CBOE, Polygon).
- **Earnings call transcripts** — summarize in real-time via AI; available free via Motley Fool or paid via Capital IQ.
- **User memory** — remember risk tolerance, investment goals, sector preferences. Inject into system prompts. Store on `user` row.
- **Daily portfolio digest email** — cron job → summarize overnight changes → Resend email.
- **Mobile app (later)** — Next.js → React Native via Expo, or skip to a separate codebase.

---

## Quick wins you can knock out in 15 minutes each

- [ ] Replace "Contact us" `mailto:hello@clearpath-invest.com` with a real inbox you control. Right now the footer link is a dead letter box.
- [ ] Add `robots.txt` and `sitemap.xml` at `src/app/robots.ts` and `src/app/sitemap.ts` (Next.js 16 App Router file conventions).
- [ ] Add `next-sitemap` or a handwritten sitemap listing the four public pages.
- [ ] Empty state for `/app/portfolio` — current placeholder is okay but could link directly to Plaid Link modal on click.
- [ ] "Copy link" button on research results — shareable snapshot with ticker + recommendation.
- [ ] Dark mode toggle in the app sidebar (theme provider is already set up).
- [ ] 404 page — currently default Next.js; create `src/app/not-found.tsx` with editorial styling.
- [ ] Add meta descriptions + Open Graph tags on every marketing page.

---

## How to test the full loop

1. Sign in at `/sign-in` as `demo@clearpathinvest.app` / `DemoPass2026!`.
2. Click Research → enter `NVDA` → click Analyze.
3. Expect ~20–30s for the triple-model + supervisor pipeline.
4. Verify the verdict card shows rec/confidence/consensus.
5. Verify all 3 model cards rendered (if one says "FAILED" check its env var).
6. Verify Agreed Points / Disagreements / Red Flags sections render correctly.
7. Sign out from the user dropdown.
8. Check `/` renders marketing page with waitlist form.
9. Submit a waitlist email — should see "You're on the list" confirmation.
10. Query Neon: `SELECT * FROM waitlist ORDER BY "createdAt" DESC LIMIT 5;` — your email should be there.

---

## Known rough edges (not blockers, but flag for future)

- **FRED snapshot is point-in-time, no history** — fixed in P3.4 above.
- **Dashboard view state doesn't persist in URL** — navigating directly to `/app#research` doesn't work. Minor.
- **Google OAuth button on sign-up page is missing** — only sign-in has it. Add for consistency.
- **No email for waitlist signups** — right now they go into a table with no notification to you. Add a webhook to Discord/Slack or a daily digest.
- **Research result isn't persisted** — refreshing the page loses the analysis. Consider storing the most recent N analyses per user for history.
- **All models use the same temperature/params** — tune per provider if you want different personality in outputs.

---

## Rough effort estimates (for planning)

| Priority | Item | Effort |
|---|---|---|
| P1.1 | Rate limiting | 2h |
| P1.2 | Per-user cost cap | 3h |
| P1.3 | Error logging (Sentry) | 1h |
| P2.1 | Plaid integration | 1 day |
| P2.2 | Portfolio review endpoint | 4h |
| P3.1 | Analyst personas | 1h |
| P3.2 | Supervisor rotation | 30min |
| P3.3 | Tool-calling | 1 day |
| P3.4 | FRED history | 1h |
| P4.1 | Terms + Privacy | 2h (using template) |
| P4.2 | Stronger disclaimers | 2h |
| P4.3 | Email verification | 3h |
| P4.4 | Password reset | 2h |
| P5 total | Polish and brand | 1 day |

**Total to "ship-ready paid product":** ~1 week of focused work.

---

## If you get stuck

- **Build fails:** clear `.next/` and `node_modules/`, then `npm install`. The SSD has been flaky during this build.
- **Auth redirect loops:** check `BETTER_AUTH_URL` for trailing whitespace. Use `vercel env pull` and `od -c` to inspect.
- **CSS gone / page unstyled:** verify `proxy.ts` matcher excludes `_next/static`.
- **Invisible content:** grep for `motion.div` and check for `initial: opacity: 0`.
- **Vertex/Gemini failures:** `GOOGLE_VERTEX_PROJECT` and `GOOGLE_VERTEX_LOCATION` must be set; the API key env var is accepted as either `GOOGLE_VERTEX_API_KEY` or `VERTEX_SERVICE_KEY` in `src/lib/ai/models.ts`.

Good luck. Start with P1. Don't let anyone (including the demo user) hit the AI endpoints at scale without rate limiting in place.
