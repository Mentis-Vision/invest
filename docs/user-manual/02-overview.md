# Overview (`/app`)

Top-to-bottom structure of the main landing screen.

## Portfolio hero

Oversized total-value + sparkline strip at the top. Shows:
- **Total value** — sum of market value across every connected brokerage
- **Today's change** — weighted by position size
- **Timeframe selector** (1M / 3M / YTD / 1Y / ALL) — toggles the sparkline window
- **Positions count** · asset-class count · institution count
- **"Synced N min ago"** — how recent the SnapTrade sync is

The total value is clickable (drills into the KPI explainer). So is
today's change. Anything rendered big enough to read is usually drillable.

Right below the hero: a small compact freshness tag like "Last
refreshed 6:42 AM today" — no card, just inline text.

## KPI strip

Five tiles, all clickable into explainer panels:

| Tile | What it means |
|---|---|
| **Today** | Portfolio-weighted day change % |
| **Positions** | Distinct holdings |
| **Hit rate** | Past recommendations that hit their target |
| **Alerts** | Undismissed overnight alerts |
| **Cash** | % of portfolio in cash / money-market |

Clicking any tile opens the right-side drill panel with a "how this is
computed" + "data dependencies" + "next step" breakdown.

## Overnight alerts

When the nightly scan finds:
- Price moves > 5% on any held ticker
- Material insider Form 4 transactions (officers/directors, not rank-and-file)
- Concentration crossing 25% (info) or 40% (warn) in a position or sector

...they stack here newest-first. Click to expand, dismiss to archive.
Empty = nothing to report, which is the normal state.

## In the news (portfolio-filtered)

Up to 4 items from WSJ, CNBC, MarketWatch, IBD, Seeking Alpha, or SEC
EDGAR that mention **your held tickers** specifically. Each item:

- Headline (click to open in new tab)
- Ticker chip
- Publisher name
- Relative time ("2h", "1d")

Hidden entirely when your holdings haven't been in the news — no
empty state noise. See `09-data-sources.md` for how the mention
extractor works.

## Allocation

Donut chart on the left (2/3) + table on the right (1/3). Click any
sector slice or table row to drill into that bucket — shows what
positions are in it and their relative weights.

Sector classification comes from Yahoo. Non-US or niche tickers
sometimes come back "Unclassified" — that's expected.

## Track record

Below allocation: a distribution bar (BUY/HOLD/SELL counts) + a hit-
rate gauge. See `07-history.md` for the full history surface.

## Holdings grid

Tiered `TickerCard`s — one per held position. The detail-density is
user-configurable (Basic / Standard / Advanced) via settings. Each
card is drillable into the position detail panel.

## Upcoming evaluations

Past recommendations with their check dates coming up. Compact list,
skim-friendly.

## Macro strip

Foot of the page: 10-Y yield, Fed funds, CPI, unemployment, dollar
index — whatever FRED most-recent values are. Purely contextual.
