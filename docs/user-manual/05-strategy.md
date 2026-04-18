# Strategy (`/app?view=strategy`)

Portfolio-level review across value, growth, and macro lenses,
synthesized into one verdict. **Pre-computed automatically overnight**
so a fresh read is waiting every morning — no action required.

## What you see

First visit of the day: "Refreshed at 6:42 AM today — fresh prices
and headlines arrive each morning, so the read won't change much
before tomorrow." The full review renders below:

- **Verdict card** — overall health (STRONG / BALANCED / FRAGILE /
  AT_RISK) + confidence level + consensus (UNANIMOUS / MAJORITY /
  SPLIT)
- **Summary paragraph** — the one-sentence version
- **Top actions** — ranked list of "do this first" moves with rationale
- **Agreed points** — where all three lenses converged
- **Disagreements** — where value, growth, and macro lenses saw it
  differently, per-lens view preserved
- **Red flags** — concerns the supervisor flagged across lenses
- **Per-lens cards** — drill into each lens's individual read

## Preloaded $0 context (before the AI review loads)

While the review loads (or if it hasn't run yet for this portfolio):

- **Composition** card — total value, positions, largest position %,
  top sector weights
- **Concentration flags** — position >25% or >40%, sector >35% or >50%
- **Macro backdrop** — current 10Y, Fed funds, CPI from FRED
- **Recent calls** — your last 5 research recommendations
- **Upcoming events** — earnings + filings on your held tickers in
  the next 30 days

## Refresh cadence

- **Every night** the cron pre-generates a fresh review per connected
  user. Zero action needed — you open the app tomorrow, it's there.
- **Refresh now** button is available if you want a new read on
  demand (rarely needed — same data → same verdict).

## When no review exists yet

First-time users or users who just connected a brokerage see a
"Your first portfolio review" card prompting them to kick one off
now. From tomorrow onward, the overnight refresh handles it.

## How the review is computed

Three lenses run in parallel over your holdings:
- **Value lens** (Claude) — traditional Graham/Dodd discipline
- **Growth lens** (GPT) — secular growth + compounding
- **Macro lens** (Gemini) — regime + positioning + downside

Each sees the same data block (portfolio composition + sector
breakdown + per-position valuation + current macro). A fourth
"supervisor" model reconciles their output into a single verdict,
preserving any genuine disagreement as `disagreements[]`.

Data is fresh from the overnight warehouse refresh; no live quotes
are pulled for this (the overnight price snapshot is what the AI
sees). This is intentional — we want the review to reflect "what
closed yesterday," not intraday noise.
