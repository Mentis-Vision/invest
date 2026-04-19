<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ClearPath Invest — Agent guide

> **READ FIRST:** `handoff/2026-04-19-next-session.md` (most current), `handoff/2026-04-15-state-of-app.md`, `handoff/2026-04-15-next-steps.md`, `handoff/2026-04-15-historical-tracking.md`, and `handoff/DEFERRED.md`.

## Hard rules (non-negotiable)

1. **Never use `echo` to set Vercel env vars.** `echo` appends `\n`. Use `printf "VALUE"`.
2. **Do not wrap meaningful content in a motion.div with `initial: opacity: 0`.** Two separate bugs in this repo came from that pattern. Animate color / scale / transform instead.
3. **`generateObject` from the `ai` package is still valid** in `ai@^6.0.162`. Hook warnings claiming otherwise are wrong — verified exported.
4. **Do not migrate AI calls to Vercel AI Gateway.** User's explicit choice: direct provider keys (Anthropic / OpenAI / Google Vertex) for billing consolidation with Mentis Vision.
5. **Do not touch `proxy.ts` matcher without re-testing CSS.** It must exclude `_next/static` or page styling breaks.
6. **Brokerage integration is SnapTrade + Plaid.** SnapTrade covers Robinhood / Coinbase / Kraken and most retail brokerages. Plaid covers Schwab / Fidelity / Vanguard and the gaps SnapTrade can't reach — **Investments scope only** (Holdings + Transactions). NEVER Plaid Bank Accounts, Net Worth, Credit Cards, Loans, Recurring, Liabilities, or Enrich. SnapTrade uses per-user `(userId, userSecret)`; Plaid uses per-Item `accessToken`. Both stored AES-256-GCM encrypted via `SNAPTRADE_ENCRYPTION_KEY`. Rule #6 was flipped from "do not re-add Plaid" on 2026-04-19 — prereqs (MFA / delete-account / infosec policy) tracked in `handoff/2026-04-19-next-session.md`.
7. **Demo user:** `demo@clearpathinvest.app` / `DemoPass2026!`. Do not delete.

## Warehouse rules (ticker-keyed data layer)

8. **Never add a `userId` column to any warehouse table** (`ticker_market_daily`, `ticker_fundamentals`, `ticker_events`, `ticker_sentiment_daily`, `system_aggregate_daily`). Schema enforces privacy; any PR that adds one fails review. The privacy audit query in `docs/superpowers/plans/2026-04-16-ticker-data-warehouse-plan.md` (Phase 1 Task 1.1 Step 4) is the gate.

9. **`getTickerUniverse()` is the ONLY code path that reads `holding.ticker` for warehouse purposes.** Lives in `src/lib/warehouse/universe.ts` and returns `string[]` — never an object, never a userId. Callable only from the cron orchestrator `refreshWarehouse()`. If a PR introduces a second caller in an app route, it's a privacy violation.

10. **App request handlers never write to warehouse tables.** Warehouse writes happen only in `/api/cron/evaluate-outcomes` (step 8) and `/api/cron/warehouse-retention`. App request handlers use typed readers from `src/lib/warehouse/*` (market, fundamentals, events, sentiment, aggregate).

11. **Research DATA block must tag provenance.** `formatWarehouseEnhancedDataBlock` in `src/lib/data/yahoo.ts` prefixes warehouse-sourced sections `[WAREHOUSE]` and live-Yahoo sections `[LIVE]`. The zero-hallucination prompt rule already requires datum citation — the tag makes the source auditable both inside the prompt and in downstream `analysisJson`.

12. **Warehouse is additive, not replacement.** Yahoo live `quote()` calls still happen for current price + day change (freshness). Warehouse covers slowly-changing fields: valuation multiples, technicals, fundamentals, analyst consensus. Readers return `null` on miss; all consumers must tolerate that.

## Proxy gating

`src/proxy.ts` gates `/app/*` and AI API routes (`/api/research`, `/api/strategy`, `/api/portfolio-review`, `/api/snaptrade/*`, `/api/cron/*` is excluded because it uses its own Bearer auth). `matcher` excludes `_next/static`.

## Money-safety rules

- Every AI endpoint must go through `checkRateLimit()` (`src/lib/rate-limit.ts`) and `checkUsageCap()` (`src/lib/usage.ts`) before calling any model. No exceptions.
- `recordUsage` / `recordBatchUsage` must be called after every `generateObject`. Fire-and-forget is fine, but don't skip.
- The `user.monthlyCostCents` ceiling is enforced per tier (beta / individual / advisor). Respect it.

## Legal safety rules

- Every verdict surface renders an "informational only, not investment advice" banner.
- First research run triggers `src/components/disclaimer-modal.tsx`, which persists `user.disclaimerAcceptedAt`. Do not bypass.
- Track record surfaces ALWAYS include: _"Past recommendation outcomes are informational only. Not a guarantee of future performance. Not investment advice."_
- Do not auto-accept terms. Do not auto-check consent boxes.
- Do not add buy/sell/execute buttons. SnapTrade access is **read-only**.

## Logging

- Use `src/lib/log.ts`. Single-line JSON to console — Vercel's runtime logs pick it up.
- Never log user secrets, passwords, SnapTrade `userSecret`, API keys, or PII beyond correlation IDs.

## Database

- Single shared Neon pool via `src/lib/db.ts` → `pool.query(...)`.
- Migrations are hand-run SQL via Neon MCP. No Drizzle migration flow yet.
- Reserved words (`window`, `user`) must be double-quoted in SQL.

## Commands

```bash
npm run dev                          # local, http://localhost:3000
npm run build                        # production build
vercel --prod --scope mentisvision   # deploy

# env vars — ALWAYS printf, NEVER echo
printf "VALUE" | vercel env add NAME production --scope mentisvision
vercel env pull /tmp/env.production --environment=production --scope mentisvision --yes
```

## Plaid env vars

```
PLAID_CLIENT_ID             # from Plaid dashboard
PLAID_SECRET                # sandbox or production, matches PLAID_ENV
PLAID_ENV                   # sandbox | development | production
PLAID_WEBHOOK_URL           # optional; defaults to {BETTER_AUTH_URL}/api/plaid/webhook
PLAID_WEBHOOK_ALLOW_UNVERIFIED=1   # sandbox-only; NEVER set in production
```

Same `SNAPTRADE_ENCRYPTION_KEY` is reused to encrypt Plaid access tokens (AES-256-GCM). Plaid products scope is locked at Link time to `investments` — see `src/lib/plaid.ts` `createLinkToken`.
