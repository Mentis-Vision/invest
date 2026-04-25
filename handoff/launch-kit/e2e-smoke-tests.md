# E2E smoke test suite

Production health check that runs Sundays 12:00 UTC and emails Sang on any failure.

## What it tests

25 tests across 7 categories. Tests are production-observable surfaces — not implementation internals.

| Category | What it covers |
|---|---|
| **marketing** (9) | All public landing pages return 2xx — `/`, `/how-it-works`, `/manifesto`, `/pricing`, `/alternatives`, `/track-record`, `/stocks`, `/research`, plus `/terms`, `/privacy`, `/disclosures` |
| **seo** (4) | Sitemap returns valid XML with reasonable URL count, robots.txt exists with Sitemap line + /api disallow, OpenGraph image renders as image/, favicon.ico exists |
| **programmatic** (2) | `/stocks/SPY` and `/embed/SPY` render — picks SPY because the ETF is always primed |
| **research** (2) | RSS feed has valid `<rss>`/`<channel>` structure with item count, latest published brief slug renders 200 |
| **auth** (4) | App routes redirect, cron endpoints all 401 unauthenticated, self-authenticated APIs return 401, proxy-gated APIs redirect to /sign-in |
| **schema** (3) | All 10 critical tables exist, all 5 notification opt-out columns exist on `user` + `waitlist`, every published brief has scheduled outcome rows |
| **warehouse** (1) | At least 5 fresh market rows in `ticker_market_daily` (transitional floor — raise to 100 after seed-universe stabilises) |

## Where the code lives

- **Test catalogue**: `src/lib/e2e-smoke.ts` — framework-free, each test is `() => Promise<string | void>` that throws on failure
- **Cron route**: `src/app/api/cron/e2e-smoke/route.ts` — Bearer-CRON_SECRET-gated
- **Schedule**: `vercel.json` — `0 12 * * 0` (Sundays 12:00 UTC, 8am ET)
- **Email destination**: `E2E_ALERT_EMAIL` env var (defaults to `sang@clearpathinvest.app`)

## Behaviour

- **All pass**: logs success, returns HTTP 200 with full report JSON, **no email**
- **Any fail**: logs each failure, returns HTTP 500 with full report JSON, emails the alert address with a `<pre>`-formatted plaintext report
- **Runner crashes**: emails an "[E2E] runner crashed" alert (best-effort) and returns HTTP 500

## Manual trigger / ops

```bash
# Pull production secret
vercel env pull /tmp/env.production --environment=production --scope mentisvision --yes
CRON_SECRET=$(grep '^CRON_SECRET=' /tmp/env.production | cut -d= -f2- | tr -d '"' | tr -d "'")

# Run dry (no email even on failure) — for manual investigation
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://clearpathinvest.app/api/cron/e2e-smoke?dry=1" | jq

# Run for real (emails on failure)
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://clearpathinvest.app/api/cron/e2e-smoke" | jq

# Force email even on success — useful when validating the email path
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://clearpathinvest.app/api/cron/e2e-smoke?email=1" | jq

# Test against a preview deployment
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://clearpathinvest.app/api/cron/e2e-smoke?baseUrl=https://invest-PREVIEW.vercel.app&dry=1" | jq

# Cleanup
rm /tmp/env.production
```

## Adding a new test

In `src/lib/e2e-smoke.ts`, append to the `TESTS` array:

```ts
{
  name: "Description of what's being checked",
  category: "marketing", // or seo, programmatic, research, auth, schema, warehouse
  async run({ baseUrl }) {
    await fetchOk(`${baseUrl}/some/path`);
    // Throw on failure. Return optional string for the report detail column.
  },
},
```

Helpers in scope:
- `fetchOk(url, init?)` — throws on non-2xx
- `fetchStatus(url, expected)` — throws if status doesn't match
- `assert(cond, msg)` — throws msg if cond is falsy
- `dbTableExists(name)`, `dbColumnExists(table, col)` — DB existence checks

Categories are free-form; the runner sorts them in declaration order. Don't add framework dependencies — runner stays vanilla so dev / CI / production are identical.

## Tuning thresholds

Two tests have explicit thresholds that should be revisited:

- **Sitemap URL count** (currently `>5`) — once seed-universe is fully primed, raise to `>100`. File: `src/lib/e2e-smoke.ts` "Sitemap returns valid XML" test.
- **Fresh market rows** (currently `>=5`) — once seed-universe is fully primed, raise to `>=100`. File: same.

Both have inline comments noting the intended escalation path.

## What this suite deliberately does NOT test

- **AI pipeline** — too expensive to run weekly. The cron-auth surface is exercised but the actual `/api/research` panel is never invoked.
- **Email delivery** — sending a test email weekly would noise up the inbox. The alert path validates by triggering on failures (and `?email=1`).
- **Data correctness** — checks tables/columns exist, not that values are right. That's a different category of test.
- **Browser behaviour** — no Playwright, no Chromium, no JavaScript execution. We test the SSR HTML. If JS-driven UX breaks, this won't catch it.
- **Per-user flows** — would require a synthetic test user + auth flow. Separate scope, deferred.

## Followups

- After the next 2 warehouse refresh cycles (next 48h), raise the warehouse threshold from 5 → 100
- Consider adding a "core lighthouse score" test using Vercel's Speed Insights API or a simple Lighthouse run
- Add per-tier visibility tests once SEO ranking matters (track keyword positions via a SerpAPI integration)
