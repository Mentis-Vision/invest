# Next session pickup — 2026-04-19

Running list of items still pending after the 2026-04-18 batch (logo,
hydration, Strategy redesign, History action-tracking, waitlist email,
content-width, Value/Growth/Macro rename, etc).

## 1. DNS / email deliverability (domain-owner action)

These are **DNS changes only** — no code, no deploy. Each takes 2–5
minutes at your DNS provider. Grouped here so they can be knocked out
in one sitting when convenient.

### lifecoach808.com — add DMARC at GoDaddy

Currently missing the DMARC record. Copy/paste this into GoDaddy DNS
Management for `lifecoach808.com`:

```
Type:  TXT
Host:  _dmarc
Value: v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net
TTL:   1 Hour
```

SPF already exists on this domain via EasyDMARC's SPF-flattening macro,
so just DMARC is needed.

### Optional polish — per-domain DKIM on alias domains

For the strictest inbox placement when Sang sends as
`sang@launchbiz.app` or `sang@clearpathinvest.app` from Gmail. Without
this, Google signs outbound mail with the primary domain's
(mentisvision.com) DKIM key, and DMARC still passes on `adkim=r`, so in
practice it's fine. Do this only if a recipient reports deliverability
issues.

Steps (per alias domain):
1. Google Admin Console → Apps → Google Workspace → Gmail →
   Authenticate email
2. Domain dropdown → pick `launchbiz.app` (then later `clearpathinvest.app`)
3. Generate new record → 2048-bit
4. Add the resulting TXT at `google._domainkey` to whichever DNS host
   that domain uses (Vercel for launchbiz.app, GoDaddy for
   clearpathinvest.app)
5. Back in Admin → Start authentication

### Warm-up (for domain reputation)

New sending domains always start in spam/Promotions for the first few
weeks. Acceleration:

- Send test emails to multiple personal inboxes (Gmail, Outlook, Yahoo)
- **Reply to those emails** from each inbox. Reply behavior is the
  biggest positive signal.
- Mark any that land in spam as "Not spam"
- Register at `postmaster.google.com` to see your Gmail reputation score

### Final state summary (verified via live DNS lookup 2026-04-18)

| Domain | SPF | DMARC | DKIM | Hosted at |
|---|---|---|---|---|
| clearpathinvest.app | ✅ Google via macro | ✅ | ✅ Resend | GoDaddy |
| mentisvision.com | ✅ macro | ✅ | ✅ (primary) | GoDaddy |
| dianalippert.com | ✅ | ✅ | ✅ (primary) | GoDaddy |
| lifecoach808.com | ✅ macro | ❌ **todo above** | n/a | GoDaddy |
| launchbiz.app | ✅ Google + SES | ✅ | ⚠ per-domain DKIM optional | Vercel |

---

## 2. Plaid re-integration — when you're ready

AGENTS.md rule #6 historically said "do not re-add Plaid." That policy
was flipped on 2026-04-18 after confirmation that SnapTrade doesn't
cover Schwab / Fidelity / Vanguard, which gates the most-asked-for user
accounts. Scope: **Plaid Investments only** (Holdings + Transactions,
$0.35/Item/month). No bank, net worth, credit cards, or loans.

### Prerequisites before production Plaid access (Security Questionnaire)

Ordered by blocking priority:

- [ ] **TOTP MFA via BetterAuth 2FA plugin** — ~3h. Adds an optional
  second factor to accounts. Plaid security questionnaire checks for
  this. See `node_modules/better-auth/docs/plugins/two-factor.md` for
  setup. Add an "Enable 2FA" section to `/app/settings`.
- [ ] **"Delete my account" endpoint** — ~2h. Must wipe user row +
  FK-cascade everything (snaptrade_connection, recommendation,
  dashboard_layout, user_profile, waitlist entries, notifications).
  Route: `DELETE /api/user/me`. Corresponding UI in
  `/app/settings` with double-confirm ("type DELETE to confirm").
- [ ] **3-page Information Security Policy doc** — ~2h. Template
  content: data flow diagram (what Plaid sends us → what we store →
  what we don't), encryption-at-rest claims, access control
  (BetterAuth sessions + proxy.ts gating), incident response contact,
  employee access policy. Save at `docs/security/info-sec-policy.md`
  and link from Privacy page.
- [ ] **Privacy policy update to mention Plaid** — ~15m. Page at
  `/privacy` — add a section under "Data sources we use" that
  explains Plaid Investments, what data we receive, what we don't
  (no credit card / loan / banking data), and that it's read-only.

### Plaid Phase A — Foundation (~5h)

Only after the four prereqs above ship.

- [ ] Neon migration: `plaid_item` table keyed by `itemId`, with
  `accessToken` AES-256-GCM encrypted (same pattern as
  `snaptrade_connection.userSecret`)
- [ ] `/api/plaid/link-token` — creates a Link session, returns
  `link_token` to client
- [ ] `/api/plaid/exchange-public-token` — exchanges client's
  `public_token` for `access_token` + stores encrypted in plaid_item
- [ ] `/api/plaid/webhook` — handles Plaid webhooks (DEFAULT_UPDATE,
  HISTORICAL_UPDATE, TRANSACTIONS_UPDATE). HMAC verify using Plaid's
  webhook secret.
- [ ] Investments Holdings sync — pulls `/investments/holdings/get` and
  upserts into existing `holding` table (same shape as SnapTrade
  holdings). Provenance: `source = 'plaid'`.
- [ ] Investments Transactions sync — same pattern into a new
  `plaid_transaction` table (keyed by Plaid's `transaction_id`).
- [ ] Connect picker modal: user clicks "Link brokerage" → sees
  SnapTrade (existing) **and** Plaid as options with one-sentence
  positioning for each.

### Plaid Phase B — Cost controls (~2h)

After Phase A is stable.

- [ ] Tier-based item caps enforced at the server:
  - Beta: 3 items max
  - Individual ($29): 5 items
  - Active ($79): 10 items
  - Advisor ($500): 50 items
- [ ] Cost-tracking: log per-Item-per-day cost into `user.monthlyCostCents`
  using existing `recordUsage()` pattern. $0.35/Item/30 ≈ 1.17 cents/day.
- [ ] Inactive-user item cleanup cron: `itemRemove()` on users who
  haven't signed in for 90 days. `itemRemove()` itself is free and
  stops the $0.35 recurring charge.
- [ ] No "Refresh" button in UI — sync only via nightly cron +
  webhook. Force-refresh ($0.12/call) is NOT exposed to users.

---

## 3. History — deeper features (now that foundation exists)

The user-action tracking shipped 2026-04-18 (`userAction`, `userNote`,
`userActionAt` columns on `recommendation` + `ActionTracker` UI). Natural
follow-ups:

- [ ] **Outcome-by-action views** — quarterly summary card: "Of the 23
  calls you took, 15 hit 7-day stops positive; 8 are still pending."
- [ ] **Pattern insights** — "You skipped 11 BUY calls on energy-sector
  tickers; 7 returned positive in 30d" — rolling 90-day lookback
  surfaced on the History top.
- [ ] **Private reflection prompts** — after 30 days, surface: "Here's
  what you said 30 days ago about LINK; here's what happened" with the
  user's original note pulled forward.

---

## 4. AGENTS.md updates to make next session

- [x] Rule #6 flipped (Plaid re-add allowed) — done 2026-04-19
- [ ] Add a new rule or note about DNS/email topology:
  - "Five domains: clearpathinvest.app / mentisvision.com /
    dianalippert.com / lifecoach808.com on GoDaddy; launchbiz.app on
    Vercel DNS. All share `dmarc_rua@onsecureserver.net` for report
    aggregation."
- [ ] Add note: "SPF flattening via EasyDMARC (`dc-aa8e722993._spfm.*`
  subdomains) — don't replace with raw SPF without updating EasyDMARC."

---

## 5. Not yet on this list

Research page improvements (user noted earlier it was "bland and empty"
— MarketPulse + WorthReading already shipped, may need more). Strategy
action-chips (Snooze / Dismiss on the Next Move hero). Dashboard
mobile-responsive pass. Emailed weekly digest (Monday AM recap).

None of these are blockers. Pick based on what the user hits next.
