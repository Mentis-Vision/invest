# Changelog

Reverse-chronological feature ship log. Pulls from git history;
we'll keep this current as we ship.

## 2026-04-17 — Logo identity landed

- Founder-provided logomark (infinity CP swoosh + candlesticks +
  upward arrow + network dots) replaces the placeholder rotate-45
  diamond mark across every surface.
- **New files:** `/public/logo.svg` (full color, 28×28 header
  variant), `/public/logo-mono.svg` (single-color currentColor
  variant for tight palettes), `/public/icon.svg` (favicon / PWA).
- **Swapped in:** app header, mobile drawer, marketing nav,
  marketing footer, sign-in / sign-up / forgot-password / reset-
  password pages.
- **New doc:** `00-brand.md` — logo meaning, files, colors,
  typography, voice, dos/don'ts.
- Marketing site `var(--buy)`-tinted SVG zigzag mark retired.

## 2026-04-18 — Hybrid v2 redesign (complete overhaul)

### Phase 2: Customizable block-based dashboard
- **New `dashboard_layout` table** — persists each user's block
  arrangement (order + sizes) as a single JSONB column.
- **BlockGrid + BlockShell components** — 12-column CSS grid with
  blocks sized at col-3 / col-4 / col-6 / col-8 / col-12.
- **10 blocks shipped**: Portfolio summary, Holdings, Alerts,
  Performance chart, In the news, Calendar, Sector mix, Macro, Recent
  research, Top movers.
- **⚙ Customize button** (top-right of grid): enters edit mode with
  per-block toolbars (drag handle, S/M/L/XL/Full size pills, hide).
  Drag any block onto another to reorder.
- **+ Add section** panel lists blocks not currently in the user's
  layout, plus 5 "coming soon" placeholders (Watchlist, Worth reading,
  Insider activity, Dividend calendar, Notes).
- **Auto-save** — debounced 600ms after the last change; no save
  button.
- **Big hero killed** — replaced with a one-line greeting:
  "Good morning, Sang. Portfolio is +2.31% today."

### Phase 1: Visual foundation
- **Palette rewrite**: light cool off-white (#F4F7FB) + white cards +
  #E4E9F1 borders + #2563EB single blue accent + standard
  emerald/red for buy/sell. Replaces warm-cream + forest-green.
- **Typography swap**: Inter (body + headings) + JetBrains Mono
  (numbers). Dropped Fraunces/serif entirely.
- **Ticker tape header** — scrolling marquee of market indexes (S&P,
  NASDAQ, DOW, Russell, 10Y, VIX) + user's top 6 holdings with prices
  + day deltas. Pauses on hover, refreshes every 60s.
- **Sidebar killed** — replaced by horizontal tabs in the top nav:
  Dashboard / Portfolio / Research / Strategy / History. Account menu
  still on the name chip.
- **Default theme** flipped back to light.
- New `/api/ticker-tape` endpoint for the marquee data.
- New `/api/dashboard/layout` GET + PATCH endpoints.

## 2026-04-17 — Prior redesign (reverted)

### Editorial trading floor (dark-default)
- Dark-default palette with warm amber accent, Onest body, Fraunces
  editorial eyebrows. Superseded by hybrid-v2 on 2026-04-18 after
  user feedback ("too formal, want lighter + customizable").

### Editorial news integrated into AI research
- Research prompts now receive a `[PRESS]` section with top 6 recent
  headlines mentioning the ticker from WSJ / CNBC / MarketWatch / IBD
  / Seeking Alpha / SEC EDGAR / Damodaran
- Every research verdict reads the news when it writes the thesis —
  the "three sources cross-verify every claim" promise is now real

### Editorial news aggregator
- 7 public RSS/Atom feeds pulled nightly into `market_news_daily`
- Ticker-mention extractor with name-based matching (13× coverage
  boost vs ticker-symbol-only)
- Dashboard "In the news" strip (4 items, empty state hides the card)
- Ticker drill "Press coverage" section with outlet-consensus badge
- `/api/market-news` endpoint with ticker/portfolio/thinker scopes
- SEC EDGAR getcurrent feed flowing through as regulatory category
- SEC Company Facts XBRL helper (`getCompanyFacts`) surfaces 15
  structured fundamentals series

## 2026-04-16 to 2026-04-17 (compressed)

- Polygon.io integration (options chains with greeks, intraday, news)
- Seeking Alpha RSS
- Finnhub earnings transcripts (paid-tier, soft-fails on free tier)
- Finnhub env-var typo fixed (code accepts both `FINNHUB_API_KEY`
  and legacy `FINHUB_API_KEY`)
- Asset-class-aware fallback (crypto never touches Yahoo)
- CoinGecko tertiary crypto fallback (closes AV-missing-token gap)
- Alpha Vantage integration (cross-verify, crypto pricing, news merge)
- Stale Yahoo crypto rows scrubbed (BTC $34 → $75K+, LINK $3 → $11+)
- Adaptive AV throttle + budgeted verify rotation for free-tier cap

## 2026-04-17: User experience

- SnapTrade Done-button reliability fix (`immediateRedirect: true`)
- `/verify` page: dedicated verification-email landing with success /
  expired / not-signed-in / error states + resend form
- Resend deliverability hardening: List-Unsubscribe + List-
  Unsubscribe-Post (RFC 8058), Reply-To, auto plain-text fallback,
  tags, X-Entity-Ref-ID
- `/unsubscribe` + `/api/unsubscribe` (one-click RFC 8058 handler)
- `/api/admin/test-email` smoke endpoint (admin-gated)

## 2026-04-17: Quick-glance UX

- Freshness indicators on overview / research / strategy (compact
  inline chip or card variant)
- 3 new KPI drills: brokerage_balance, institution_count,
  largest_position_pct
- Holdings table Price + Value cells → drillable into ticker / position
- Portfolio Summary stats → drillable
- MarketPulse on research (SPY/QQQ/IWM + macro strip)
- Integrations page "Data sources" section listing every always-on
  provider

## 2026-04-17: Research caching + auto-strategy

- Same-day cache for Quick read + Deep read (24h window, mode-filtered)
- Research rows excluded from formal track record when `mode='quick'`
- Auto-nightly portfolio review for every connected user
- GET/POST split on `/api/portfolio-review` (cache-first GET, force POST)
- Verdict-mismatch explainer when Quick ≠ Deep
- Voice cleanup: stripped AI / token / cron / model references from
  every user-facing surface

## 2026-04-17: Cards redesign

- Quick Read + Deep Read cards: 30-day price sparkline, inline
  freshness chip, two-column body, no tech disclosures
- `<MiniSparkline />` pure-SVG component

## 2026-04-16: Warehouse + privacy boundary

- Ticker-keyed data warehouse (5 tables, zero userId columns)
- Cross-source price verification (Yahoo + Alpha Vantage)
- Nightly refresh orchestrator with concurrency caps

## Before 2026-04-16

- Three-lens AI analyst panel (Value / Growth / Macro)
- Zero-hallucination prompt framework (cite only verified data)
- SnapTrade brokerage linking
- BetterAuth email + Google OAuth
- Editorial design language (Fraunces hero, cream paper palette)
