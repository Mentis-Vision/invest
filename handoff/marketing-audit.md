# Marketing audit — 2026-04-28

Snapshot review of every public marketing surface, scored against four
criteria: claim accuracy (matches shipped product?), trust signals,
scannability, and CTA strength. Companion to the early-access copy
sweep (PR #6) and the Phase B hero rewrite + Phase D pricing rebuild
that follow.

## Scoring

| Page | Accuracy | Trust | Scan | CTA | Notes |
|---|:-:|:-:|:-:|:-:|---|
| `/` (landing) | A− | B | A | B | Hero now reads "Early access · Free 30-day trial." Mock NVDA verdict card is good. Comparison block still uses "Single-model AI tools" framing — strong. **Phase B targets:** sharper headline, interactive ticker demo, social-proof strip with verified brokers. |
| `/manifesto` | A | A | A | A− | Strongest page. "Horoscope" line is the best copy on the site. Title now matches body voice. Leave structure alone. |
| `/how-it-works` | B+ | A− | B+ | B | Five-stage pipeline is clear. Could include screenshots/animations of an actual brief once we have one. Currently no visual examples. |
| `/pricing` | A− | B | B | A | Tier "Beta → Free trial" rename done. Cards are dense but legible. **Phase D targets:** annual toggle, founder-pricing badge, visual hierarchy that elevates the recommended tier (Individual). |
| `/track-record` | C | A | A | A− | Still pre-data ("Priming"). The honesty itself is a trust signal but the page won't carry weight until first 30-day window closes. Consider seeding with the public weekly-brief outcomes for at least *something* visible. |
| `/alternatives` | A− | A | A | A | Honest competitive comparison is rare and valuable. Keep. |
| `/security` | B+ | A | B | B | "No selling, no AI training" is direct and trustworthy. Could use a security-incident-handling section + SOC2 status (even "in progress"). |
| `/research` (index) | B | B+ | B | B | Empty state pre-Monday-brief feels thin. Once briefs exist, this becomes a leverageable trust surface (live samples). |
| `/stocks` (index) | B | B | B | B | Useful SEO-ish landing for ticker-tail searches. Mostly automated. |

## What the marketing site claims vs what's actually shipped

### Currently claimed and **shipped** (✓ keep claiming)
- Three-lens analysis (Quality, Momentum, Context) — **shipped**, three model families wired.
- Live data from 12+ sources — **shipped**, listed in `/` data-sources block.
- Source citations / claim traceability — **shipped**, dossier renders source attributions.
- Brokerage portfolio sync via Plaid + SnapTrade — **shipped**, Schwab + Coinbase user-confirmed.
- Per-account dashboard breakdown with custom aliases — **shipped today** (PR #4 + #5).
- Today's portfolio change computed per-holding (account-add-safe) — **shipped today** (PR #2).
- Real index levels in ticker tape — **shipped** (PR #1).
- Track-record methodology + commitment to publish misses — **shipped page**, no data yet.

### Claimed but **gaps**
- "Live SEC + Fed" — yes, but the **landing's data-sources strip is static**; users can't browse them. Phase B opportunity: link each tile to the actual data path / sample.
- Brokerage list — claims 30 institutions; only 2 user-confirmed (Schwab, Coinbase). Fix: brokerage spot-check (scheduled for tomorrow 8 AM HST) → trim claims to verified, others get "available via Plaid" hedge.
- "Weekly brief delivered Monday" — `/research` index is currently a "Priming" empty state. Either ship the first brief before Monday or soften the weekly cadence claim.

### **Shipped** but not surfaced in marketing
- Inline account aliases ("Sang's IRA")
- Per-account portfolio grouping
- Day-change computed correctly across account add/remove
- Ticker bar with real index levels
- Show/hide accounts toggle
- Schwab + Plaid integration working

These are recent quality-of-life wins worth a "What's new" or "Latest releases" mini-section on the landing. Phase B can absorb.

## Phase B (hero rewrite + interactive demo) — design direction

**Headline shift.** Current: "Stock research. / Every claim *sourced.*" — concrete but doesn't name the pain. Tested replacement: "Don't trust *one* AI / with your retirement." Names the wedge (single-AI is dangerous), forces the user to side with three-lens.

**Interactive demo.** Curated client-side preview only — no real backend cost. User picks from {NVDA, AAPL, TSLA, NFLX} → animated three-lens pane reveals BUY/HOLD/SELL with cited rationale. The data is hardcoded (we know what last week's three-lens output was). Sells the product at the moment of attention.

**Social proof strip.** Logos / names of confirmed brokers. After the spot-check completes: e.g. "Linked to Schwab, Fidelity, Robinhood, Coinbase + 26 more." Until then: "Connected to your existing brokerage — Schwab, Coinbase verified, 28 more available."

**Trust amplifier strip.** Below the fold: "Cited to primary sources · Three independent model families · Misses published, same as wins." Echoes the auth-footer copy.

## Phase D (pricing rebuild) — design direction

**Visual hierarchy.** Elevate Individual ($29) — bigger card, "Most popular" tag, primary accent border. Active sits secondary. Free trial as an *entry path* not a tier card — moved into a hero "Try free for 30 days" stripe above the four cards. Advisor as separate "Sales" CTA below the grid.

**Annual toggle.** Above the grid. Default annual (better LTV anchor). Two months free framing.

**Founder pricing badge.** "Lock in 25% off for life — first 30 days only." Limited-time urgency without discounting the public list price.

**CTA wiring.** Once Stripe is live (Phase D-2), each tier CTA becomes:
- Free trial → `/sign-up` (already wired)
- Individual / Active → POST `/api/stripe/checkout?tier=individual|active` for authed users; `/sign-up?next=/api/stripe/checkout&tier=...` for unauthed.
- Advisor → mailto (unchanged)

## Open follow-ups (post-Phase-B/D)

- **Customer logos / testimonials:** none yet. Once first 5 paid customers convert, capture quotes.
- **Live track-record stats:** depends on first 30-day window closing. Set a calendar reminder to refresh once data exists.
- **Founder note** with photo — adds humanity, especially for Advisor tier prospects deciding whether to trust their RIA practice to a small team.
- **Comparison page metadata** lists ChatGPT, Empower, Morningstar, etc. — make sure the `/alternatives` page hits well in search for those competitor names. Already has good `<title>` + JSON-LD.

## Files referenced
- All marketing pages under `src/app/*` outside the `/app` subtree
- `src/components/marketing/{nav,footer,waitlist-form}.tsx`
- `src/components/auth-layout.tsx`
- `handoff/brokerage-verification.md` — pending, fires tomorrow 8 AM HST
