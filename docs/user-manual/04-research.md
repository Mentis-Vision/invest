# Research (`/app?view=research`)

Two-speed research on any ticker: **Quick read** (glance) or **Deep
read** (full thesis with bull/bear debate). Every verdict cites
verified data; we never state numbers we can't back up.

## The flow

1. Land on `/app?view=research`. You see:
   - Market pulse strip (S&P 500, Nasdaq, Russell 2000 + macro headline)
   - Search box — "Enter ticker..."
   - Starter chips: your holdings, trending, recently researched, this
     week's earnings, recent filings on your holdings
2. Type a ticker (or click a chip) and hit **Analyze**.
3. You get a **Quick read** result card.
4. Optionally click **Go deeper — full thesis with debate** for the
   Deep read.

## Quick read card

Compact two-column layout:

- **Header row:** TICKER · "Quick read" eyebrow · freshness chip
  ("Updated 12m ago" or "Just now") · 30-day price sparkline · current
  price + day-change · verdict badge (BUY/HOLD/SELL · confidence)
- **Thesis:** one-sentence summary under the header
- **Left column:** Key signals — 3 bullets the read is based on
- **Right column:** Primary risk — the single biggest concern
- **Footer:** "Go deeper" button

## Deep read card

Same header shape as Quick read. Body adds:
- **Full thesis** — 2–3 sentence summary
- **Key signals** — 5–7 signals, each citing a specific data point
- **Risk factors** — bulleted list
- **Bull case / Bear case pair** — adversarial debate
  - Each side has a thesis + 3 reasons + "what would change this
    view" line
- **Verdict reconciliation** — if Quick said HOLD and Deep says SELL,
  an explainer card says "The deeper read is the one to trust — it
  challenges its own thesis with a bull and bear argument before
  settling. The quick read is a first-glance triage."

## Freshness + same-day caching

- If you run a Quick or Deep read on a ticker you've already read
  **today**, the cached result loads instantly — no re-read. Tag:
  "Updated 2h ago."
- If it's a fresh read, tag says "Just now."
- Caching is same-calendar-day only. Tomorrow's first read is fresh.

Why: the underlying data only refreshes overnight. Re-reading the
same ticker twice on the same day would return the same verdict
with the same citations; we don't burn the time.

## Data the read sees

When you analyze AAPL, the research prompt receives (provenance-tagged):

- **[LIVE] PRICE** — current Yahoo quote + cross-source Verified badge
  when Alpha Vantage agrees within 1%
- **[WAREHOUSE] VALUATION** — P/E, P/B, P/S, EV/EBITDA, market cap,
  dividend yield, EPS, beta (from the overnight warehouse refresh)
- **[WAREHOUSE] RANGE & TECHNICALS** — 52-week range, 50/200 MA, RSI,
  MACD, Bollinger bands, VWAP, relative strength vs SPY, short interest
- **[WAREHOUSE] ANALYST CONSENSUS** — target price, coverage count,
  recommendation key
- **[WAREHOUSE] FUNDAMENTALS** — revenue, margins, ROE, FCF, debt
  (from Yahoo's quoteSummary)
- **[WAREHOUSE] SENTIMENT** — bullish/bearish %, buzz ratio, company
  news score, sector avg (Finnhub + Alpha Vantage merged)
- **[PRESS] COVERAGE** — up to 6 recent headlines mentioning the
  ticker from WSJ, CNBC, MarketWatch, IBD, Seeking Alpha, or SEC
  EDGAR, with "consensus" tag when 3+ outlets covered it in the last 7 days
- **SEC FILINGS** — the 5 most-recent 10-K / 10-Q / 8-K / DEF 14A

Plus a system prompt with the absolute rule: "cite only what's in
the data block or a tool-call result; never invent numbers."

## The three lenses

Quick and Deep reads use a single analyst by default (the **value
lens** / Claude). The full panel (Quick → Deep is a simplified
path) runs three independent analysts in parallel:

- **Value lens** — Graham/Dodd: margin of safety, durable cash flow,
  balance-sheet strength
- **Growth lens** — TAM, moats, reinvestment, operating leverage
- **Macro lens** — regime risk, positioning, rate/liquidity, downside
  scenarios

When all three disagree, that disagreement is preserved in the final
writeup — we don't paper it over.

## Cost framing (internal reference)

Users see NONE of this; it's here for internal cost accounting:

| Mode | Cost | Characteristics |
|---|---|---|
| Quick read | ~$0.004 | Single Haiku, no tools, 1-pass |
| Deep read | ~$0.06 | One top-tier model + bull/bear debate |
| Full panel | ~$0.21 | 3 analysts + supervisor + tool use |

Same-day cache turns repeat reads into $0.
