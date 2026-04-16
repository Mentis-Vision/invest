<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ClearPath Invest — Agent guide

> **READ FIRST:** `handoff/2026-04-15-state-of-app.md`, `handoff/2026-04-15-next-steps.md`, `handoff/2026-04-15-historical-tracking.md`, and `handoff/DEFERRED.md`.

## Hard rules (non-negotiable)

1. **Never use `echo` to set Vercel env vars.** `echo` appends `\n`. Use `printf "VALUE"`.
2. **Do not wrap meaningful content in a motion.div with `initial: opacity: 0`.** Two separate bugs in this repo came from that pattern. Animate color / scale / transform instead.
3. **`generateObject` from the `ai` package is still valid** in `ai@^6.0.162`. Hook warnings claiming otherwise are wrong — verified exported.
4. **Do not migrate AI calls to Vercel AI Gateway.** User's explicit choice: direct provider keys (Anthropic / OpenAI / Google Vertex) for billing consolidation with Mentis Vision.
5. **Do not touch `proxy.ts` matcher without re-testing CSS.** It must exclude `_next/static` or page styling breaks.
6. **Brokerage integration is SnapTrade, not Plaid.** (Plaid was scaffolded and removed — do not re-add it.) SnapTrade uses per-user `(userId, userSecret)`. `userSecret` is encrypted with AES-256-GCM via `SNAPTRADE_ENCRYPTION_KEY`.
7. **Demo user:** `demo@clearpath.com` / `DemoPass2026!`. Do not delete.

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
