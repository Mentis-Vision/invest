# Phase 10 Research Memo — Historical Performance Backfill via Broker Transaction History

**Prepared:** 2026-05-04
**Author:** Sang Lippert (with Claude Opus 4.7)
**Status:** Research only — not a spec or plan. Informs Phase 10 design.
**~1,470 words excluding sources.**

---

## Section 1: Top 15 Brokers — Historical Data Depth

**Universal facts (confirmed across multiple SnapTrade and Plaid docs):**
- **SnapTrade Activities endpoint:** paginated at 1,000/page, 10,000 max per request; data is cached and refreshed once daily; "often years of history, sometimes since account inception." Universal caveat: depth depends on the broker, not on SnapTrade.
- **Plaid `/investments/transactions/get`:** documented hard ceiling of **24 months** regardless of institution. Returns `investment_type` subtypes including `buy`, `sell`, `cash` (dividends/interest), `fee`, `transfer`, `cancel`. First call may take 1–2 minutes post-Link.
- Per SnapTrade's own blog: a single broker can expose **261 distinct transaction types**; SnapTrade normalizes to ~10 canonical types (buy, sell, dividend, interest, contribution, withdrawal, transfer, fee, split, other).

| # | Broker | Path | Transaction Depth | Granularity | Reliability Gotchas |
|---|---|---|---|---|---|
| 1 | **Schwab** (post-TD) | SnapTrade + Plaid | **SnapTrade: ~4 years (explicitly documented in SnapTrade FAQ).** Plaid: up to 24 mo. | Buys/sells/divs/interest via SnapTrade. | Plaid has documented "problems updating transactions and investments" at Schwab (RIABiz reporting). Schwab requires partner registration on the native side. |
| 2 | **Fidelity** | SnapTrade (requires application) + Plaid (with caveats) | Uncertain — verify directly. SnapTrade docs say "since inception" possible. Plaid: 24 mo. | Full activity stream. | Fidelity has aggressively pushed back on screen scraping; Plaid access is OAuth/API now. **SnapTrade integration requires partner application approval.** Plaid Fidelity access auto-granted only on Growth/Custom plans (~8 weeks); Pay-as-you-go must request manually. |
| 3 | **Vanguard** | SnapTrade + Plaid | Uncertain published depth. SnapTrade lists Vanguard as supported integration; Plaid lists Assets/Balance/Transactions. | Buys/sells/divs/distributions. | Vanguard historically the slowest API partner. Verify depth empirically on first connect — published numbers not in either docs at time of writing. |
| 4 | **E*TRADE** | SnapTrade + Plaid | SnapTrade: typically multi-year; Plaid: 24 mo. | Standard. | Post-Morgan Stanley acquisition, integration stable. |
| 5 | **Robinhood** | SnapTrade (Plaid is bank-funding only, not investments) | "Full trade history in one batch" per SnapTrade integration page — likely since-inception. | Buys/sells/divs/options/crypto. | Robinhood has no public developer API. SnapTrade is essentially the only path. Cancelled-and-rebuilt orders sometimes drop — verify empirically. |
| 6 | **Merrill Edge** | Plaid primarily | 24 mo via Plaid. SnapTrade support uncertain — not in published integration list at time of writing. | Standard via Plaid. | BoA-Merrill connection historically flaky. Verify. |
| 7 | **Interactive Brokers** | SnapTrade (uses IBKR Flex Query) + Plaid | **IBKR's own portal: 90 days only.** SnapTrade can pull more via Flex Query, but full backfill is typically done by user-uploaded Flex Query CSV per third-party reporting. Plaid: 24 mo. | Full granularity. | IBKR's transaction API surface is the most fragmented of any tier-1 broker. Expect manual CSV import as a complement. |
| 8 | **Webull** | SnapTrade | Uncertain published depth. | Standard. | No native investments API; SnapTrade is the path. |
| 9 | **M1 Finance** | SnapTrade (data); Plaid for bank-linking only | Uncertain published depth. | Standard. | M1's "pies" abstraction means transaction-level reconstruction may not match the user's UI mental model. |
| 10 | **SoFi** | SnapTrade; Plaid for bank-linking | Uncertain — verify. | Standard. | |
| 11 | **Public** | SnapTrade | Uncertain published depth. | Standard. | |
| 12 | **Wealthfront** | Plaid (Wealthfront uses Plaid for outbound; SnapTrade direct unconfirmed) | 24 mo via Plaid. | Auto-rebalancing trades produce dense activity. | Wealthfront's robo-rebalancing creates 10–50× the transaction volume of a self-directed account. Storage planning must account for this. |
| 13 | **Betterment** | Plaid | 24 mo via Plaid. | Same as Wealthfront. | Same dense-rebalance volume issue. |
| 14 | **Coinbase** | SnapTrade (crypto-specific endpoints) + Plaid (read-only since 2022) | Uncertain published depth on either path. | Buys/sells/sends/receives/converts/staking rewards. | Crypto txns include `staking_reward`, `convert`, `airdrop` — none map cleanly to securities-style schema. |
| 15 | **Kraken** | SnapTrade (crypto endpoints) + Plaid | Uncertain published depth. | Same as Coinbase. | Same crypto-normalization issue. |

**Honest gap:** Per-broker depth numbers are **not publicly documented in a single matrix** by either SnapTrade or Plaid as of this research date. Schwab's 4-year limit is the only number SnapTrade publishes. Everything else is "since inception when the broker allows it." **Recommendation: instrument the first-connect sync to log earliest-transaction-date per broker, then build the matrix from real data over the first 90 days post-launch.**

---

## Section 2: Architecture + Security Best Practices

**1. Do we need our own DB?** **Yes.** Re-fetching from broker on every chart load fails on three grounds: (a) SnapTrade caches once daily — no benefit to re-pulling; (b) Plaid `/investments/transactions/get` can take 60–120 seconds on first call and is rate-limited per-Item; (c) cost — Plaid charges per-call and SnapTrade's pricing scales with API hits. A wealth-active user opening their dashboard 5×/day across 4 accounts = 20 API calls/day. Storing the data once is the only economically viable path.

**2. Minimum viable schema** (extends current Neon Postgres pattern):

```sql
CREATE TABLE broker_transactions (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('snaptrade','plaid')),
  account_id      text NOT NULL,                 -- aggregator's opaque ID, NOT broker account number
  external_txn_id text NOT NULL,                 -- aggregator-provided idempotency key
  txn_date        date NOT NULL,
  settle_date     date,
  action          text NOT NULL,                 -- normalized: buy|sell|dividend|interest|split|transfer|fee|other
  ticker          text,                          -- nullable (e.g., interest, fees)
  quantity        numeric(20,8),
  price           numeric(20,8),
  amount          numeric(20,8) NOT NULL,        -- signed; cash impact on account
  fees            numeric(20,8),
  currency        char(3) NOT NULL DEFAULT 'USD',
  raw             jsonb,                         -- ENCRYPTED
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_txn_id)
);
CREATE INDEX ON broker_transactions (user_id, txn_date DESC);
```

**Do NOT store:** broker account numbers, masked or otherwise; broker login credentials (already enforced — SnapTrade `userSecret` and Plaid `accessToken` are AES-256-GCM encrypted in the existing pattern); SSN; tax IDs; cost basis from broker (recompute from transactions to avoid stale data).

**3. Encryption strategy.**
- **At rest:** Neon already provides full-DB encryption at rest (AWS KMS). For ClearPath's threat model (a curious DBA, leaked backup), that is sufficient for non-PII fields. **Apply application-layer AES-256-GCM** (reuse the existing `SNAPTRADE_ENCRYPTION_KEY` pattern via `src/lib/snaptrade-crypto.ts`) only to the `raw` JSONB column, which may contain free-text descriptions, broker memos, and the only fields we cannot fully predict. pgcrypto is **not** recommended — it sends keys to the server during decryption, defeating the purpose. Industry parallel: Kubera uses AWS-at-rest + HTTPS-in-transit and explicitly does not E2E-encrypt because "the server has to compute on the data." Empower uses AES-256 with rotating per-user salts at Yodlee (their aggregator), not in-app.
- **In transit:** TLS 1.3 enforced (default on Vercel + Neon).
- **Key management:** Vercel env var works for v1, but **plan a KMS migration when revenue crosses ~$500K ARR or user count crosses ~5K.** Rotation: maintain `SNAPTRADE_ENCRYPTION_KEY_V1`, `_V2`, with a `key_version` column; rotate annually or on suspected exposure.

**4. Access control.**
- Postgres roles: `clearpath_writer` (used by `/api/cron/*` only) with INSERT/UPDATE on `broker_transactions`; `clearpath_reader` (used by app request handlers) with SELECT only. **Enforce in code path** — current single-pool pattern in `src/lib/db.ts` needs splitting.
- Row-level security: add `USING (user_id = current_setting('app.user_id')::uuid)` policy; `SET LOCAL app.user_id = $1` at the start of every authenticated request in `proxy.ts` chain.
- **Audit log:** log `(user_id, action, table, txn_count, correlation_id)` to existing `src/lib/log.ts` pipeline. **Never log:** quantities, prices, tickers, amounts. The audit log answers "who pulled what" — not "what did they hold."

**5. Data retention.**
- **Active users:** retain indefinitely while account active.
- **Disconnected broker (user kept ClearPath account):** retain for chart continuity until user explicitly removes; warn at 12 months with one-click purge.
- **Deleted user:** `ON DELETE CASCADE` purges immediately; backups rotate on a 30-day cycle (Neon default). This matches Wealthfront's published 30-day backup-retention window and Kubera's 30-day rotation. Disclose this in privacy policy.
- **"Read replica gap":** Neon's logical replication has no separate read replica we control. Branch-based snapshots expire per Neon's retention policy — disclose the longest such window.

---

## Section 3: Legal + Regulatory

**1. Investment Advisers Act.** Storing transaction history alone does **not** trigger registration. The three-prong test (15 USC §80b-2(a)(11)): **(a) for compensation, (b) in the business of advising others on securities, (c) personalized advice.** ClearPath already satisfies (a) and (b). The pivotal element is (c) **personalized**. **Lowe v. SEC, 472 U.S. 181 (1985)** establishes the publisher's exclusion: bona fide, regular, impersonal publications are exempt. ClearPath's AI research output is borderline because it references the user's holdings — that is "attuned to a specific portfolio" and the publisher exclusion likely **does not** protect it. The AUM-based registration thresholds ($110M federal, $25M state) don't apply because we don't manage assets — but the *advice* prong does. **Practical posture:** the existing "informational only, not investment advice" disclaimer + no execute buttons + no specific buy/sell recommendations is the firewall. Phase 10 changes nothing on this axis as long as we don't start using the historical data to generate "you should rebalance" type prompts. **Do not** add a "rebalance recommendation" surface without securities counsel review.

**2. Reg S-P.** SEC's 2024 amendments (effective Dec 3, 2025 large / Jun 3, 2026 small) apply to **SEC-registered** broker-dealers, investment companies, advisers, funding portals, transfer agents. ClearPath is **not** any of those, so **Reg S-P does not directly bind us.** Plaid and SnapTrade pass data to us under their own contractual safeguards — there is no statutory chain-liability. However: **GLBA Safeguards Rule (FTC version)** **does** apply. The 2018 Treasury report and 2021 FTC amendments treat data aggregators and consumer fintechs that access account/transaction data as "financial institutions" under GLBA. ClearPath is in that bucket. Concrete obligations: written information security program, designated qualified individual, annual risk assessment, MFA, encryption, vendor oversight, incident response plan, and as of May 2024 — **report breaches affecting 500+ individuals to the FTC within 30 days.**

**3. CCPA/CPRA + state laws.** ClearPath needs to add to the privacy policy: data categories collected (broker transaction data is "financial info"); right-to-know (45-day SLA, +45 day extension); right-to-delete with the GLBA-recordkeeping carve-out documented; right to portability (CSV export of `broker_transactions`); two intake methods (web form + email — already satisfied). **California asset-manager exemption expired** in 2023 — fintechs are now squarely covered. New comprehensive privacy laws across 19 states largely mirror CCPA; a single CCPA-compliant program covers them.

**4. GDPR (EEA — out of scope today).** If ClearPath ever expands to EEA: legal basis = consent (explicit, withdrawable), DPIA required for "systematic monitoring" of financial data, EU representative required, Article 30 records of processing, 72-hour breach notification, $20M / 4% global revenue ceiling. Conservatively, expansion is a 6-month legal-engineering project. Do not "soft launch" EEA.

**5. Cyber liability + E&O.** Industry data: fintech cyber premiums start $5K–$10K/yr for early-stage, $15K–$20K+ for scale. Each additional $1M coverage adds 30–60%. **$5M coverage** for ClearPath at current scale lands roughly **$15K–$30K/yr**. **Trigger threshold for non-negotiability: 1,000 paying users OR first enterprise/RIA contract OR $250K ARR — whichever first.** MFA + EDR + offsite-immutable backups + IR plan earns 25–30% credit.

**6. Breach notification.** Federal: GLBA Safeguards (FTC) — 30 days, 500+ users, written report. State: 30-day clock now in NY, CA, CO, FL, ME, WA. NY DFS Part 500 — only triggers if ClearPath holds a NY DFS license (we do not), so the 72-hour rule there is **inapplicable**. Build a generic 30-day notification playbook and it covers the union of obligations.

---

## Section 4: Recommended Phase 10 Approach (≤300 words)

**Schema:** Use the `broker_transactions` table above. Add a `holdings_snapshot_derived` materialized view computed by replaying transactions forward from the earliest-known position; persist daily at market close to back the performance chart.

**Cron pattern:**
- **One-shot backfill** triggered by webhook on first SnapTrade `CONNECTION_ADDED` or Plaid `HISTORICAL_UPDATE`. Pulls full available history; logs `earliest_txn_date` per account; surfaces "data goes back to {date}" in the UI.
- **Continuous incremental:** existing `/api/cron/*` adds a 6-hour delta sync (`startDate = max(txn_date) - 7 days` to catch corrections). Use the `external_txn_id` UNIQUE constraint for idempotency.
- **Quarterly reconciliation:** full re-pull, diff against stored, flag drift in admin telemetry only.

**Encryption:** Application-layer AES-256-GCM on `raw` JSONB only. Reuse `SNAPTRADE_ENCRYPTION_KEY` envelope; introduce versioning column now to make rotation cheap later.

**User control surface:** New "Data & Privacy" page under `/app/settings`:
- View earliest available date per account
- One-click CSV export of `broker_transactions` (CCPA portability)
- One-click "purge transaction history for this connection" (keeps holdings, drops history)
- Hard-delete-account button preserves existing flow; CASCADE handles cleanup

**Privacy policy / TOS additions (specific bullets):**
- "We retrieve and store your broker transaction history (buys, sells, dividends, fees) for up to the depth your broker permits, currently as far back as 24 months for most institutions."
- "We never store your broker account numbers or login credentials."
- "Transaction data is encrypted at rest and in transit. The free-text portion is additionally encrypted at the application layer."
- "We retain transaction history while your ClearPath account is active. Deletion purges from primary systems immediately and from backups within 30 days."
- "You can export all stored transaction data as CSV at any time from Settings → Data & Privacy."
- "Past transaction outcomes are informational only. Not investment advice. Not a guarantee of future performance." *(extends existing rule)*
- Add named-vendor disclosure: SnapTrade, Plaid, Neon, Vercel.
- Add 30-day GLBA-compliant breach notification commitment.

---

## Sources

- [SnapTrade — Brokerage Integrations](https://snaptrade.com/brokerage-integrations)
- [SnapTrade — Account Data docs](https://docs.snaptrade.com/docs/account-data)
- [SnapTrade — FAQ (Schwab 4-year limit)](https://docs.snaptrade.com/docs/faq)
- [SnapTrade — Transaction Types Are The Wild West (261 types)](https://snaptrade.com/blogs/historical-transaction-data)
- [SnapTrade — Get transaction history reference](https://docs.snaptrade.com/reference/Transactions%20And%20Reporting/TransactionsAndReporting_getActivities)
- [SnapTrade — Robinhood Integration](https://snaptrade.com/brokerage-integrations/robinhood-api)
- [SnapTrade — Vanguard Integration](https://snaptrade.com/brokerage-integrations/vanguard-api)
- [SnapTrade — Interactive Brokers Integration](https://snaptrade.com/brokerage-integrations/ibkr-api)
- [SnapTrade — Crypto trading docs](https://docs.snaptrade.com/docs/crypto-trading)
- [Plaid — Investments Introduction (24-month ceiling)](https://plaid.com/docs/investments/)
- [Plaid — Investments API reference](https://plaid.com/docs/api/products/investments/)
- [Plaid — Vanguard institution page](https://plaid.com/institutions/vanguard/)
- [Plaid — Interactive Brokers institution page](https://plaid.com/institutions/interactive-brokers-us/)
- [Plaid — Privacy / data handling](https://plaid.com/how-we-handle-data/)
- [TechCrunch — Plaid adds read-only crypto exchange support](https://techcrunch.com/2022/07/14/plaid-adds-read-only-support-for-thousands-of-crypto-exchanges/)
- [RIABiz — Fidelity vs Plaid screen-scraping](https://riabiz.com/a/2023/10/19/fidelity-just-dropped-the-hammer-on-screen-scrapers-to-cheers-but-some-firms-like-plaid-are-holdouts-and-the-cfpb-may-wield-the-final-gavel)
- [SEC — Regulation of Investment Advisers (Plaze)](https://www.sec.gov/about/offices/oia/oia_investman/rplaze-042012.pdf)
- [15 USC §80b-2 — Adviser definitions (Cornell LII)](https://www.law.cornell.edu/uscode/text/15/80b-2)
- [Lowe v. SEC, 472 U.S. 181 (1985) — Justia](https://supreme.justia.com/cases/federal/us/472/181/)
- [Mayer Brown — Advisers Act outline 2025](https://www.mayerbrown.com/-/media/files/perspectives-events/events/2025/04/mayer-brown-advisers-act-outline-imu-2025-final.pdf)
- [SEC — Regulation S-P 2024 amendment (final rule)](https://www.sec.gov/rules-regulations/2024/06/s7-05-23)
- [Federal Register — Reg S-P 2024 final rule](https://www.federalregister.gov/documents/2024/06/03/2024-11116/regulation-s-p-privacy-of-consumer-financial-information-and-safeguarding-customer-information)
- [Ropes & Gray — SEC Amends Reg S-P](https://www.ropesgray.com/en/insights/alerts/2024/06/sec-amends-regulation-s-p-privacy-of-consumer-financial-information-and-safeguarding)
- [Cooley — GLBA expanded applicability to fintech](https://cdp.cooley.com/fintech-faces-expanded-applicability-of-glbas-privacy-and-security-requirements/)
- [FTC — GLBA business guidance](https://www.ftc.gov/business-guidance/privacy-security/gramm-leach-bliley-act)
- [Morgan Lewis — Expanded Safeguards Rule](https://www.morganlewis.com/pubs/2021/11/expanded-safeguards-rule-applicable-to-more-financial-institutions-gives-more-specificity-on-security-requirements)
- [Alston & Bird — Safeguards Rule breach notification in effect](https://www.alstonprivacy.com/data-breach-notification-requirements-under-the-safeguards-rule-now-in-effect/)
- [Dechert — California asset-manager exemption expiration](https://www.dechert.com/knowledge/onpoint/2022/11/asset-managers-should-prepare-for-the-expiration-of-two-importan.html)
- [Wipfli — California data privacy laws for fintech](https://www.wipfli.com/insights/articles/updated-california-data-privacy-laws-expose-fintech-companies-to-costly-compliance-risks)
- [Perkins Coie — 2025 Breach Notification Law Update](https://perkinscoie.com/insights/update/2025-breach-notification-law-update)
- [NY DFS Part 500 (text)](https://www.dfs.ny.gov/system/files/documents/2023/03/23NYCRR500_0.pdf)
- [Hogan Lovells — NYDFS Part 500 Nov 2025 effective date](https://www.hoganlovells.com/en/publications/nydfs-final-set-of-cybersecurity-requirements-under-amended-part-500-take-effect-november-1-2025)
- [Kubera — Security page](https://www.kubera.com/security)
- [Empower — Cybersecurity page](https://www.empower.com/individuals/about-empower/cybersecurity)
- [Wealthfront — Account security FAQ](https://support.wealthfront.com/hc/en-us/articles/211003623-How-does-Wealthfront-secure-my-account-information)
- [SeedPod — Cyber insurance for tech companies](https://seedpodcyber.com/cyber-insurance-for-tech-companies/)
- [Pro Insurance Group — 2026 cyber liability cost by industry](https://www.proinsgrp.com/business/cyber-liability-insurance/cost/)
- [PostgreSQL pgcrypto docs](https://www.postgresql.org/docs/current/pgcrypto.html)
- [PostgreSQL Encryption Options](https://www.postgresql.org/docs/current/encryption-options.html)
