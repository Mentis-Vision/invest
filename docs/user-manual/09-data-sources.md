# Data sources

Full roster of every data source we pull from, what each gives us,
and how they're combined.

## Market data (quotes, OHLCV, fundamentals)

### Yahoo Finance (primary)
Per-ticker quote + 250-day history + quoteSummary (valuation + analyst
consensus). Via `yahoo-finance2` npm package. Free, no key.

### Alpha Vantage (cross-verification + crypto + supplemental news)
- `GLOBAL_QUOTE` — runs against every equity in the warehouse nightly
  for price-verification. When AV agrees with Yahoo within 1%, the
  ticker drill shows a "Verified · 2 sources" pill.
- `DIGITAL_CURRENCY_DAILY` — crypto OHLCV. **Fixes the bug where
  Yahoo resolves "BTC" to Bitgreen ($33 equity) instead of Bitcoin
  (~$75K).**
- `NEWS_SENTIMENT` — merged with Finnhub.
- Reads `ALPHA_VANTAGE_API_KEY`.

### CoinGecko (tertiary crypto)
For tokens Alpha Vantage doesn't list (SPK, HYPE, newer DeFi).
Uses `/simple/price` endpoint, no API key required on the free tier.
Pro tier uses `COINGECKO_API_KEY`.

### Polygon.io (options + intraday + additional news)
- Options chain with full greeks (delta/gamma/theta/vega) + IV
- Intraday 1m/5m/15m bars
- Per-ticker news with per-article sentiment
- Reads `POLYGON_API_KEY` (preferred) or `MASSIVE_API_KEY` (legacy).

### SEC EDGAR
Zero cost, no API key (just a User-Agent with contact email).
- `getRecentFilings(ticker)` — 10-K / 10-Q / 8-K / DEF 14A
- `getCompanyFacts(ticker)` — every XBRL fact a company has reported,
  slimmed to 15 most-useful series (revenue, net income, assets,
  equity, cash, shares outstanding, R&D, FCF, etc.)
- `getRecentFilingsFeed()` — cross-company Atom feed of all new
  filings (flows through editorial news as `regulatory` category)

### Finnhub
- Per-ticker news + sentiment (buzz ratio, company news score,
  bullish/bearish %)
- Earnings-call transcripts (paid tier; we degrade quietly to empty
  when 403'd)
- Reads `FINNHUB_API_KEY` or legacy `FINHUB_API_KEY`.

### Seeking Alpha RSS
Per-ticker + general market commentary. Independent third-party
commentary (opinion, not breaking news). No API key; public RSS.
Requires a browser User-Agent header.

### FRED (St. Louis Fed)
Macro indicators: rates, CPI, unemployment, M2, yield curve. Used
for the macro snapshot + the macro strip at the bottom of /app.
Reads `FRED_API_KEY`.

## Editorial news feeds (nightly cron pull)

Populates `market_news_daily` table. Ticker mentions extracted against
the user-universe + top 40 mega-caps + recent research targets:

| Provider | Category | URL |
|---|---|---|
| WSJ Markets | news | feeds.content.dowjones.io |
| MarketWatch | news | marketwatch.com/rss |
| CNBC | news | search.cnbc.com (wrss01 feed) |
| Investor's Business Daily | news | investors.com/feed |
| Seeking Alpha (market currents) | analysis | seekingalpha.com/market_currents.xml |
| Aswath Damodaran (blog) | thinker | aswathdamodaran.blogspot.com |
| SEC EDGAR (getcurrent) | regulatory | sec.gov/cgi-bin/browse-edgar |

**Dropped after evaluation** (documented in `handoff/DEFERRED.md`):
- Barron's — Dow Jones locked down RSS in 2024 (403)
- Stock Analysis (stockanalysis.com) — no RSS exists
- Howard Marks / Oaktree — no RSS; handled as curated link instead
- Berkshire shareholder letters — annual, no RSS
- Reuters — RSS partially deprecated 2020–2022; coverage arrives via Polygon

## Ticker-mention extractor

When an editorial article is ingested, its title + summary are scanned
for ticker mentions:

1. `$AAPL` (cashtag) — unambiguous
2. `(AAPL)` — parenthetical (common in editorial style: "Apple (AAPL)")
3. `AAPL` at a word boundary — only when in our universe (avoids
   false-matching "ATOM" in prose when we don't hold it)
4. **Name-based matching** (the big one) — "Apple" → AAPL, "Tesla"
   → TSLA, etc. Curated map of ~40 mega-caps. Case-sensitive to
   avoid matching lowercase "apple" in food articles.

## Cross-source verification

When two independent sources report a price for the same ticker,
the warehouse stores both:

- Yahoo's close in the `close` column
- Alpha Vantage's close in the `verify_close` column
- Delta % in `verify_delta_pct`

The UI surfaces:
- ≤ 1% delta → "Verified · 2 sources" pill on the drill header
- > 5% delta → "Source drift · X%" pill (amber, warn)
- Logged to server logs as a data-quality concern

## Brokerage linking (SnapTrade)

Read-only access. Per-user credentials stored encrypted (AES-256-GCM
via `SNAPTRADE_ENCRYPTION_KEY`). The nightly cron syncs holdings +
trade activity for every connected user.

## AI providers (for the analyst panel)

Direct provider keys (no Vercel AI Gateway — billing consolidation
with Mentis Vision):
- Anthropic Claude — Value lens + supervisor
- OpenAI GPT — Growth lens + claim verification
- Google Gemini (via Vertex) — Macro lens

Reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VERTEX_SERVICE_KEY` +
`GOOGLE_VERTEX_PROJECT` + `GOOGLE_VERTEX_LOCATION`.

## Email (transactional only)

Resend for verification + password reset. Reads `RESEND_API_KEY` +
`RESEND_FROM_EMAIL`. DKIM/SPF/DMARC verified on the sending domain.

## What we DO NOT store

The warehouse tables are strictly ticker-keyed — there is no `userId`
column in any analytical table (`ticker_market_daily`,
`ticker_fundamentals`, `ticker_events`, `ticker_sentiment_daily`,
`system_aggregate_daily`, `market_news_daily`). The only per-user
tables are `holding`, `recommendation`, `portfolio_snapshot`,
`portfolio_review_daily`, and `snaptrade_user`.

This separation is enforced by the privacy audit described in
`AGENTS.md` rule 8 and re-checked whenever new tables land.
