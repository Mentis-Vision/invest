# Overview (`/app`)

Your starting screen. Completely redesigned in the hybrid-v2 redesign
(April 2026): no more sidebar, no more big hero card — it's a
customizable grid of information blocks you arrange the way you want.

## Top of the screen

### Ticker tape
A thin dark bar at the very top that scrolls horizontally:
- **Indexes first** — S&P 500, NASDAQ, DOW, Russell 2000, 10-year yield, VIX
- **Your top holdings next** — up to 6, sorted by value
- Each shows current price + day change
- Green = up, red = down
- Hover anywhere on the bar to pause the scroll

Refreshes every 60 seconds. Uses Yahoo quote data via our cross-source
verification pipeline.

### Top navigation
Horizontal tab row across the top. No sidebar anymore.
- Dashboard · Portfolio · Research · Strategy · History
- Your name + avatar on the right; click for Account menu (Settings,
  Change password, Contact support, Sign out)
- Theme toggle (light / dark) next to your name on desktop

## The greeting

One line, right below the nav:

> **Good morning, Sang. Portfolio is +2.31% today.**
> *Friday, Apr 17*

That's it. No paragraph, no editorial lead — you can see everything
else below.

Portfolio day-change is computed from yesterday's daily snapshot vs
today's total. If you just connected a brokerage and we don't have two
snapshots yet, it shows "Loading your latest…" until tomorrow's cron.

## The customizable block grid

Everything below the greeting is a grid of **blocks** you can arrange.

### Default layout (new users)

1. **Portfolio summary** (full-width) — Total Value, Positions, Cash %,
   Hit rate, Day change
2. **Holdings** (2/3 wide) — dense table with ticker, name, weight,
   shares, price, value
3. **Alerts** (1/3 wide) — overnight price moves, insider activity,
   concentration flags
4. **Performance** (1/2 wide) — YTD portfolio sparkline
5. **In the news** (1/2 wide) — WSJ/CNBC/IBD/MarketWatch headlines
   mentioning your tickers
6. **Calendar** (1/3 wide) — upcoming earnings, dividends, filings on
   your holdings
7. **Sector mix** (1/3 wide) — horizontal bars by sector weight
8. **Recent research** (1/3 wide) — your last 5 research reads with
   verdicts

### Customizing the grid

Hit the **⚙ Customize** button (top-right of the grid). The grid
enters edit mode:
- Every block gets a dashed blue outline
- A small toolbar appears at the top-right corner of each block:
  - **≡ drag handle** — drag the block onto any other block to swap
    positions
  - **S / M / L / XL / Full** — click to resize the block. These are
    1/4, 1/3, 1/2, 2/3, and full-width on a 12-column grid
  - **×** — hide the block
- The **+ Add section** button appears; click to see the catalog of
  blocks not currently in your layout
- Changes save automatically (no save button; debounced 600ms after
  the last edit)
- Hit **✓ Done** when you're finished to exit edit mode

### Available blocks

Currently implemented:

| Block | What it shows |
|---|---|
| Portfolio summary | 5 KPIs: total value, positions, cash, hit rate, day change |
| Holdings | Dense table of all positions |
| Alerts | Overnight flags: price moves, insider, concentration |
| Performance | YTD portfolio value sparkline |
| In the news | Headlines mentioning your holdings |
| Calendar | Upcoming earnings + dividends + filings |
| Sector mix | Horizontal bars by sector |
| Macro | 10-Y, Fed funds, CPI, USD index (from FRED) |
| Recent research | Your last research reads with verdicts |
| Top movers | Biggest absolute % moves in your portfolio today |

Coming soon (placeholder blocks, click to add — body says "coming soon"):
- Watchlist (tickers you follow without holding)
- Worth reading (long-form investor thinking: Damodaran, Howard Marks)
- Insider activity (SEC Form 4 on your holdings)
- Dividend calendar (ex-div + pay dates)
- Notes (your own notes on holdings)

### Where your layout is saved

Your arrangement (block order + sizes) is saved per-user in the
`dashboard_layout` table. Sign in on a different device and you'll
see the same layout. If you remove a block that later gets replaced
with a new version (schema change), it's dropped silently — no
migration dance for you.

## How drill-down works

Most numbers on the dashboard are **clickable** into a right-side
detail panel. Click a KPI to see "how this is computed." Click a
ticker to see the full drill (valuation, technicals, fundamentals,
press coverage, recent recommendations). Click a holding row to see
your cost basis + unrealized P&L.

The drill panel is shared across every view — the same panel opens
on the Portfolio and Research pages when you click a ticker there.
