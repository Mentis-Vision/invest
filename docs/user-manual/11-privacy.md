# Privacy

## The privacy boundary

ClearPath stores two categories of data in clearly separated schemas:

### Per-user data (authenticated access only)
- `user` — email, name, password hash (bcrypt via BetterAuth)
- `holding` — your positions as synced from SnapTrade
- `recommendation` — research reads you've run, with timestamps
- `portfolio_snapshot` — daily total-value snapshots
- `portfolio_review_daily` — your pre-computed overnight AI review
- `snaptrade_user` — your SnapTrade user-secret, AES-256-GCM encrypted

### Ticker-keyed warehouse (no user identity stored)
- `ticker_market_daily` — OHLCV + valuation + technicals + verified
  price cross-source
- `ticker_fundamentals` — quarterly/annual financials
- `ticker_events` — earnings dates, filings, dividends
- `ticker_sentiment_daily` — news sentiment
- `system_aggregate_daily` — platform-wide counts
- `market_news_daily` — editorial headlines with ticker mentions

**No warehouse table contains a `userId` column.** This is a hard
invariant in the codebase — see `AGENTS.md` rule 8. The audit query
in `docs/superpowers/plans/2026-04-16-ticker-data-warehouse-plan.md`
verifies it.

## What we never store

- Your brokerage credentials. SnapTrade handles the OAuth flow; we
  only ever see an encrypted "userSecret" token that gives us
  read-only data access.
- Trading history beyond what SnapTrade exposes.
- Third-party account credentials of any kind.
- AI research requests to external providers include your ticker +
  public data. They don't include your holdings list, your name, or
  your email.

## What we do store

- Your email, name, password hash (for auth)
- Your holdings as synced from your brokerage (required for portfolio
  features)
- Your research history (so you can see "what did I decide last time?")
- Daily snapshots of your total portfolio value (for the sparkline)
- Encrypted SnapTrade user-secret (required to re-sync)

## Data retention

- `recommendation` rows persist indefinitely unless you delete your
  account.
- `portfolio_snapshot` rows persist indefinitely (one row per user per
  day, negligible footprint).
- Warehouse tables are pruned on a rolling basis:
  - `ticker_market_daily` — 2 years
  - `ticker_fundamentals` — indefinite (rarely changes)
  - `ticker_events` — 2 years
  - `ticker_sentiment_daily` — 90 days
  - `market_news_daily` — 30 days
  - `system_aggregate_daily` — 2 years

Pruning runs nightly via `/api/cron/warehouse-retention`.

## Export + deletion

Two actions are in progress:

- **Export your data** — JSON download of every row keyed by your
  userId, including analysisJson bodies. Expected surface: Account
  page. Not yet shipped.
- **Delete account** — removes `user` row; CASCADE wipes `holding`,
  `recommendation`, `portfolio_snapshot`, `portfolio_review_daily`,
  `snaptrade_user`. The warehouse tables have no userId so nothing
  to clean there. Expected surface: Account page. Not yet shipped.

## Legal positioning

ClearPath is a research tool. We are not a licensed financial advisor,
broker-dealer, or fiduciary. Analyses produced are informational only
and are not a recommendation to buy, sell, or hold any security.

These disclosures appear:
- The disclaimer modal on first research run (requires explicit
  acknowledgment, persisted as `user.disclaimerAcceptedAt`)
- The "For informational purposes only" banner on every research
  surface
- The legal footer on every marketing page

## AI-generated content

Research verdicts, thesis text, and bull/bear arguments are produced
by AI models (Claude, GPT, Gemini). These outputs can be incomplete,
inaccurate, or incorrect. We disclose AI involvement in:
- The first-use disclaimer modal
- The marketing-page footer disclosure
- The "Published by third parties. We cite; we don't endorse." note
  under the press coverage section of ticker drills

In day-to-day UI, we don't advertise the AI involvement (the user
doesn't need to think about it to use the product). But the
disclosure surfaces above satisfy informed-consent requirements.

## Third-party data attribution

Every surface that displays third-party editorial content (news
headlines, SEC filings, market data) shows the source. Publishers
are credited by name (WSJ, CNBC, etc.); we never claim their content
as our own. Click-through always opens the original article in a new
tab.
