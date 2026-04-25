# Session wrap — 2026-04-21

Picks up after `handoff/2026-04-19-next-session.md`. This session shipped
the full Plaid-approval trust audit (Tier 1 + Tier 2), two product rounds
(History deeper features + Research page improvements), and finished
the encryption-key-rotation infrastructure.

Everything below that's not marked **TODO** or **ACTION** is done and
deployed to production.

---

## 1. Plaid — where we landed

**Production approval:** granted. `PLAID_ENV=production`, real client_id
(`69e0a233acaf82000daa7af9`) and secret set on Vercel Production.

**Integration verified:**
- `/api/plaid/link-token` returns a live production token (confirmed via
  the now-deleted `/api/plaid/diagnose` endpoint earlier this session).
- `redirect_uri` is `https://clearpathinvest.app/plaid-oauth`, registered
  in Plaid Dashboard → Developers → API → Allowed redirect URIs.
- `webhook_url` is `https://clearpathinvest.app/api/plaid/webhook`.
- OAuth return page at `src/app/plaid-oauth/page.tsx` resumes Plaid
  Link via `receivedRedirectUri` and persists the link_token in
  `localStorage` across the OAuth hop.

**ACTION required (Plaid-side, not ours):** institution-level
enablement for Fidelity, Charles Schwab, Vanguard, Robinhood, E*TRADE,
Merrill Edge. Sang has a support ticket template ready (in the session
transcript). Check `https://dashboard.plaid.com/activity/status/oauth-institutions`
— some institutions auto-activate within 24h of production approval;
Schwab typically requires a separate partner registration.

**Daily heartbeat:** `/api/cron/plaid-status-check` runs at 09:00 UTC
(5am ET) and emails `sang@mentisvision.com` a daily ops digest with
- `linkTokenCreate` health check result
- Fleet rollup (active items, needs-reauth, sync-failed, stale webhooks)
- Verify-failure count last 24h
- Direct link to the institution status page

First run: tomorrow morning. If you don't get the email, trigger it
manually via Vercel Dashboard → Settings → Cron Jobs → Run Now.

---

## 2. Trust audit — fully closed

All 11 Tier 2 items shipped today. For anyone looking at `/admin/health`:

**Signals you'd act on:**
- **Stuck users** — red if >0. Users who linked a brokerage >30min ago
  with zero holdings. Each one would email support. List shows email,
  institution, status, time since link.
- **Webhook silence** — red banner if any items are stuck `>14d since
  last webhook` AND older than 14d. Indicates our JWT verify rejecting
  legit webhooks or Plaid's retries giving up.
- **Verify failure rate (24h / 7d)** — from the `plaid_webhook_event`
  table. Red above 5%. Distinguishes "spike in rejections" from the
  heuristic "items haven't been touched" signal.
- **Sync lag** — items with last holdings sync >24h. Amber threshold.

New DB table from this session (Neon): `plaid_webhook_event`. Retention
30 days via `warehouse-retention` cron.

**Encryption key rotation** — infrastructure shipped. Format:
`v2:iv:tag:ct` for new writes; legacy `iv:tag:ct` still decrypts as v1.
When you need to rotate: set `SNAPTRADE_ENCRYPTION_KEY_V2` in Vercel →
deploy → run re-encryption cron (build when needed) → retire V1.
Playbook documented inline in `src/lib/snaptrade.ts`.

---

## 3. Security questionnaire — state check

Per earlier in this session:

- Q2 / Q3 / Q11 — upload `docs/security/info-sec-policy.md` (now
  restored to full content, SnapTrade-as-fallback framing).
- Q4 / Q5 — **ACTION:** capture MFA screenshots if you still need
  to submit these. `/app/settings` shows the TOTP section at the top
  now (moved this session).
- Q9 — link to `https://clearpathinvest.app/privacy`. Draft-banner
  removed earlier in the session.

If the questionnaire is already submitted, disregard. If not, the
source material is all current.

---

## 4. Product work shipped today

- **History view** — 3-lane Action × Outcome card (took / ignored /
  opposed each with wins/losses/pending + contextual rate); new
  sector-aware pattern ranker (picks the most statistically
  significant sector × action × rec cell in the last 90 days,
  renders 1 insight at a time, min-5 sample, explicit comparison
  lane); softened prescriptive copy in PatternCard.
- **Research view** — `DossierHero` at the top (zero-AI editorial
  brief on the most notable holding or a trending fallback);
  `SectorRail` below Events/WorthReading (11 Select Sector SPDR
  ETFs, click-to-research).
- **Picker** — unified search with 30+ institutions (institutions.ts
  is the routing table), Plaid-first routing, "Secured by Plaid and
  SnapTrade" trust copy.
- **Settings layout** — 2FA section now at the top (was buried
  below preferences and notifications).
- **Footer** — "A Mentis Vision product" attribution on marketing
  surfaces + `/security` page clarifier explaining the GitHub URL.

---

## 5. Pending items (for a future session)

### [DEFERRED] Dashboard mobile-responsive pass — 3-4h
Browse `/app` on a phone and fix layout issues. Known weak spots:
- Block grid (`block-shell.tsx`) uses `useDesktopGridSpan` which
  falls back to 1 col on mobile — should be fine, but verify.
- Next Move hero chips may wrap awkwardly at narrow widths.
- Portfolio view's group headers with 4 metrics (count · value ·
  weight · day-change) compete for space.
- Admin dashboard (`/admin/health`) KPI row is `grid-cols-2
  md:grid-cols-4` — hasn't been tested on phone.

### [LATER] Onboarding first-run flow — 6-8h
For a user who just signed up, the current app drops them on a
mostly-empty dashboard. A first-run checklist (connect brokerage →
accept disclaimer → run first research → mark first action)
would pay off as real users start arriving.

### Plaid-specific, pending external approvals
- Watch the `/activity/status/oauth-institutions` page for state
  flips. Once an institution goes Active, end-to-end test linking
  with a real brokerage account.
- Re-test OAuth specifically on Schwab/Fidelity/Vanguard — confirms
  the `/plaid-oauth` resume flow works against a real institution.

### User actions that aren't code
- Re-enroll 2FA for `sang@lippertohana.com` (account was rebuilt
  this session; TOTP secret was destroyed in cascade).
- Submit security questionnaire if still pending.
- Tomorrow morning — verify the daily Plaid status email arrives
  from the cron.
- First production Plaid link end-to-end once Plaid approves at
  least one institution.

---

## 6. What NOT to do in the next session

- Don't touch `getTickerUniverse()` beyond `refreshWarehouse()`.
  Warehouse rule #9 still stands. Every new warehouse-adjacent
  feature should go through typed readers.
- Don't rotate `SNAPTRADE_ENCRYPTION_KEY` without first setting
  `SNAPTRADE_ENCRYPTION_KEY_V2` AND running a re-encryption cron.
  The current v2-tagged ciphertexts use v1's key material — swapping
  V1 blind will break everything.
- Don't remove `plaid_webhook_event` retention from the warehouse
  cron. It's the only thing bounding that table.

---

## 7. Neon DB state

New table this session: `plaid_webhook_event` (broad-sun-50424626,
neondb). 3 indexes. Inserts fire-and-forget via `waitUntil` from
`/api/plaid/webhook`. Admin view reads from it.

No schema changes needed for Tier 2 features beyond this one table.

---

## 8. Vercel state

Latest production deploy: `invest-kcqyqpwd0-mentisvision.vercel.app`
(2026-04-21, ~00:50 UTC). Aliased to `clearpathinvest.app`.

Crons registered:
```
0 14 * * *  /api/cron/evaluate-outcomes      (daily 2pm UTC)
0 3  * * 0  /api/cron/warehouse-retention    (Sun 3am UTC)
0 14 * * 1  /api/cron/weekly-digest          (Mon 2pm UTC)
0 9  * * *  /api/cron/plaid-status-check     (daily 9am UTC) — NEW
```

Env vars added this session:
- None required. `SNAPTRADE_ENCRYPTION_KEY_V2` is optional and only
  gets set when you rotate.
