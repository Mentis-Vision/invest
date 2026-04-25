# Handoff

## State
Big session. Shipped: marketing rework (4 phases), `/alternatives` matrix, `/stocks/[ticker]` programmatic SEO, `/embed/[ticker]`, `/track-record`, weekly bull-vs-bear automation (cron + page + RSS at `/research`), auto-email cron, brief outcome retrospective, settings ToggleListCard refactor (ESG moved to "Investment values"), E2E smoke suite (25 tests, all green). All deployed prod. New tables via Neon MCP: `public_weekly_brief`, `public_weekly_brief_outcome` + `weeklyBriefOptOut`/`SentAt` columns on user+waitlist. NVDA brief live at `/research/nvda-2026-04-20` with outcomes scheduled.

## Next
1. **Mon 2026-04-27** — raise E2E thresholds in `src/lib/e2e-smoke.ts` (sitemap URLs 5→100, warehouse rows 5→100) after the seed-universe warehouse refresh runs. Tracked in `handoff/DEFERRED.md` "Scheduled follow-ups" section.
2. **Off-keyboard launch kit** — `handoff/launch-kit/` has Show HN draft, 25-directory submission kit, Daily Upside outreach. Execute when ready.
3. **~2026-05-25** — decide on paid SEO instrumentation (Lighthouse + SerpAPI) per DEFERRED.md.

## Context
- Crons added today: `weekly-bull-bear` (Mon 10:00 UTC), `email-weekly-brief` (Mon 11:00 UTC), `e2e-smoke` (Sun 12:00 UTC). All Bearer-CRON_SECRET-gated. Manual trigger pattern: `vercel env pull` → grep CRON_SECRET → curl with Bearer. Always `rm` the env file after.
- Neon project ID: `broad-sun-50424626`. Migrations are hand-run SQL (AGENTS.md). Postgres reserved word `window` must be double-quoted.
- Vercel hooks throw false positives on JSON-LD script injection (canonical Next.js pattern, content is server-side static) and on "no observability instrumentation" (codebase uses `src/lib/log.ts`, not Sentry/OTel). Both safe to ignore.
- Comprehensive recap in `handoff/2026-04-24-marketing-visibility.md`.
