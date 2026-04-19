# Information Security Policy

**Effective date:** 2026-04-19
**Owner:** Sang Lippert, Founder
**Review cadence:** Quarterly, or on material change

This document describes the information-security program for
ClearPath Invest. It is provided to support due-diligence reviews
by prospective partners, integration providers (Plaid, SnapTrade,
Resend), and our own users.

The user-facing summary lives at `/security` on our website. This
document is the deeper technical reference.

---

## 1. Scope

This policy covers:

- **Services:** ClearPath Invest production (`clearpathinvest.app`),
  including the Next.js web application, API routes, cron jobs, and
  all data stores.
- **Data in scope:** user account data (email, hashed passwords,
  session cookies), brokerage-linked data (holdings, transactions via
  SnapTrade and Plaid), research history, user-authored notes, and
  operational metadata (usage counters, rate-limit buckets).
- **Personnel:** the founder is the sole engineer with production
  access as of this writing. This document will be re-issued with
  broader access controls when additional engineers are added.

Out of scope: third-party systems used under contract (Neon, Vercel,
Plaid, SnapTrade, Anthropic, OpenAI, Google Cloud, Resend), which
operate under their own documented security programs and are vetted
per §7 below.

---

## 2. Data flow

### What we receive from brokerage partners

**SnapTrade** — per-user `(userId, userSecret)` pair. The `userSecret`
is what lets us pull that user's holdings + transactions; it's
scoped to the single user. SnapTrade holds the actual brokerage
OAuth grant and we never see the user's brokerage credentials.

**Plaid (Investments scope only)** — per-Item `access_token` for an
institution the user linked (e.g., Schwab). Token scope is limited
to the Plaid Investments product:

- `/investments/holdings/get` — positions + cost basis + weight
- `/investments/transactions/get` — trade activity

We explicitly **do not** call:

- `/accounts/*` (bank accounts)
- `/transactions/*` (bank transactions — distinct from investment trades)
- `/liabilities/*` (credit cards, loans)
- `/enrich/*` (transaction enrichment)
- `/recurring_transactions/*` (recurring bill detection)

Token scope is enforced by Plaid; our code structure makes accidental
expansion impossible (no `plaidClient.accountsGet` calls in the codebase).

### What we send to our sub-processors

**To AI providers (Anthropic / OpenAI / Google Vertex AI):** the
ticker symbol the user queried, plus a verified public-data block
(market data, fundamentals, SEC filings, press coverage) that we
assembled from authoritative sources. **We do not send email, name,
user ID, or any identifying information in prompts.** Prompts are
explicitly anonymized.

**To Resend:** the recipient email address, subject line, and email
body. Only on explicit user-triggered events (sign-up verification,
password reset, waitlist confirmation).

**To Plaid & SnapTrade:** API calls scoped to the user's own item/user
secret. No cross-user data flows.

### What we store

- **User account:** email (plaintext for login lookup), password
  (scrypt-hashed via BetterAuth), session cookies (signed),
  verification + reset tokens (short TTL, hashed).
- **User profile:** optional risk tolerance, goals, horizon — user
  enters voluntarily.
- **Holdings + transactions:** as provided by SnapTrade or Plaid,
  keyed by our internal `userId`. Never includes account numbers
  or brokerage login data.
- **Recommendation history:** every research query + our three-lens
  analysis + supervisor synthesis, tied to `userId`. Used to render
  the user's personal track record.
- **User-recorded actions:** the user's private journal entries on
  each recommendation (`took` / `partial` / `ignored` / `opposed` +
  a note up to 500 chars). Visible only to the user.
- **Ticker data warehouse:** market data, fundamentals, events, and
  sentiment **keyed by ticker only**. No user identifiers, no
  per-user metadata. Enforced by CI review per [AGENTS.md rule #8].

### What we do NOT store

- Brokerage login credentials (we never see them)
- Bank account, credit card, or loan data (we never request it)
- Plaintext passwords (scrypt only)
- AI conversation-history beyond what the user explicitly saves in
  their research history
- Advertising/tracking cookies
- Any data used to train AI models

---

## 3. Access control

### Authentication

- **BetterAuth 1.6.4** for user auth. Supports email/password and
  Google OAuth.
- **Session cookies** are HttpOnly, Secure, SameSite=Lax, signed
  with `BETTER_AUTH_SECRET`. 7-day expiration.
- **Session cookie cache** is enabled with a 5-minute refresh window
  for performance; does not extend session lifetime.
- **Optional TOTP 2FA** — users can enroll in time-based one-time
  password MFA via their Account Settings. Enabled accounts are
  required to complete the second factor on each sign-in.
- **Password requirements** — minimum 8 characters. (Rate-limiting
  gates brute force.)

### Authorization

- All authenticated routes pass through `src/proxy.ts` which
  validates the session before routing any protected request.
- `/app/*` pages redirect to `/sign-in` if no valid session.
- API routes perform their own session check as defense-in-depth.
- Ownership checks — any data access enforces `WHERE userId = $1`
  against the authenticated session user ID. No cross-user read or
  write paths exist.

### Administrative access

- Sole engineer (founder) holds production credentials for: Neon
  (database), Vercel (hosting + env vars), Resend (email),
  SnapTrade (API console), Plaid (dashboard), and the AI provider
  accounts.
- MFA enabled on all admin accounts.
- Credentials rotated on departure (n/a as of 2026-04-19).
- No shared accounts. No long-lived API keys checked into source
  control.

---

## 4. Encryption

### In transit

- All user-facing traffic over HTTPS (TLS 1.2 minimum, 1.3 preferred).
- Certificate issuance + renewal via Vercel.
- API calls to sub-processors (Neon, Plaid, SnapTrade, Resend, AI
  providers) over TLS.

### At rest

- **Database encryption at rest:** Neon Postgres encrypts all stored
  data with AES-256.
- **Application-layer encryption** for sensitive secrets:
  - SnapTrade `userSecret` → AES-256-GCM via `SNAPTRADE_ENCRYPTION_KEY`
  - Plaid `access_token` → AES-256-GCM via the same key
  - Nonces are generated with `crypto.randomBytes(12)` and stored
    alongside the ciphertext.
- Password hashing via scrypt (BetterAuth default). Unique salt per
  user.

### Key management

- Production secrets live in Vercel Environment Variables (encrypted,
  ACL'd to team members).
- No secrets in source control. `.env*` files are `.gitignore`'d.
- Secrets never logged — log lines are JSON-structured and reviewed
  for PII / secret leakage before merge.

---

## 5. Logging & monitoring

- **Structured JSON logs** to stdout, captured by Vercel. Contains:
  correlation IDs, scope tags, error details. Never contains:
  user secrets, passwords, API keys, or PII beyond the user ID used
  for correlation.
- **Log retention:** 90 days at Vercel.
- **Rate-limit telemetry** — per-user and per-IP buckets visible in
  logs. Excessive spikes trigger alerts.
- **Error tracking** — unhandled exceptions land in Vercel logs with
  stack traces. Production issues investigated within 24h.

---

## 6. Incident response

### Contact

- **Security contact:** security@clearpathinvest.app
- **Incident response lead:** Sang Lippert, Founder
- **Response window:** acknowledgment within 24 hours, disclosure
  within 72 hours for confirmed breach involving user data (in line
  with US state laws and GDPR, where applicable).

### Process

1. **Detect** — automated alerting on error spikes, unusual
   authentication patterns, sub-processor status pages.
2. **Contain** — revoke affected credentials, disable affected
   endpoints, rotate secrets as needed.
3. **Assess** — determine scope: which users, which data, how long.
4. **Notify** — notify affected users by email with what happened,
   what data was involved, what we're doing, and what they should do.
   Regulatory notifications (state AGs, etc.) as required.
5. **Post-mortem** — written retrospective within 7 days. Root cause,
   timeline, changes adopted to prevent recurrence.

### Breach notification timeline

Per US state breach-notification laws (strictest: CA AG 72 hours,
most others 30-60 days), we commit to:

- Initial assessment within 24 hours of detection
- User notification within 72 hours of confirmed material impact
- Regulatory filings within statutory windows

---

## 7. Sub-processor vetting

Every external service that processes user data is vetted against:

- **Published security practices** — do they have a SOC 2 report or
  equivalent? (Neon: yes. Vercel: yes. Plaid: yes. SnapTrade: yes.
  Resend: yes. Anthropic: yes. OpenAI: yes. Google Cloud: yes.)
- **Data-processing agreements** — we operate under each provider's
  DPA or equivalent.
- **Breach notification obligations** — providers commit to notifying
  us on material events affecting our data.
- **Scope minimization** — we only use the products we need
  (e.g., Plaid Investments, not the full Plaid suite).

Full sub-processor list maintained in the Privacy Policy (§4).

---

## 8. Software supply chain

- **Dependency auditing** — `npm audit` run at least weekly;
  high-severity issues remediated within 7 days.
- **Dependabot** enabled on GitHub for automated vulnerability PRs.
- **Pinned versions** in `package-lock.json`.
- **No unused or experimental packages** — the `package.json`
  dependencies list is kept minimal and audited.

---

## 9. Data retention & deletion

### Retention defaults

| Data class | Retention |
|---|---|
| Active account data | For the life of the account |
| Recommendation + outcome history | Indefinite (core track-record product) |
| Structured logs | 90 days |
| Rate-limit buckets | 24 hours rolling |
| Verification + reset tokens | 1 hour TTL |
| Inactive accounts | Purged after 24 months + notice email |

### User-initiated deletion

Users can delete their account directly from **Account Settings →
Delete my account**. The operation cascades via foreign keys to:

- `user_profile`, `dashboard_layout`, `snaptrade_connection`,
  `plaid_item`, `holding`, `recommendation`, `recommendation_outcome`,
  `user_rate_limit_bucket`, `user_usage_counter`, and every other
  user-scoped table.

A single API call completes the deletion in one transaction. No
administrator action is required.

Some data may persist in time-limited backups up to 7 days after
deletion (Neon's point-in-time recovery window).

---

## 10. Compliance posture

- **SOC 2 Type I:** we run on SOC 2 Type II certified infrastructure
  (Neon, Vercel, Plaid, SnapTrade) but do not currently hold our
  own SOC 2 attestation. Anticipated completion post-Series A.
- **GDPR / CCPA:** while not currently targeting the EEA/UK, we
  operate CCPA-equivalent rights for all users (access, deletion,
  export, correction). See Privacy Policy §10 and §11.
- **Financial regulation:** we are **not** a registered investment
  adviser. All output is informational; we do not provide
  personalized investment advice. Disclosure banners render on every
  verdict surface.

---

## 11. Changes

We version this document in git. Every change is reviewed and
committed under `docs/security/info-sec-policy.md`. Material updates
will be announced to users via in-product notice or email.

---

## Contact

- **Security questions / reports:** security@clearpathinvest.app
- **Privacy questions:** privacy@clearpath-invest.com
- **General:** hello@clearpath-invest.com
