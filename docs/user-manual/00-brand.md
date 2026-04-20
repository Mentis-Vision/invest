# Brand identity

The visual identity for ClearPath Invest. Source of truth for the
logo, colors, typography, and voice rules that everything else —
website, app, email, marketing — has to line up with.

## Logomark

The mark is an **infinity-style swoosh shaped into a "CP" monogram**,
with a candlestick chart inside the left loop and an upward arrow
rising out of the right loop. The whole thing sits on a subtle network-
dot backdrop.

### Meaning baked in
- **The swoosh** — a continuous path, never broken. Stands for the
  through-line we promise: every claim traces back to a source.
- **The candlesticks** — on-chain market data, inside the lens. We
  are looking at the same tape everyone else is, but examined.
- **The arrow up-and-right** — growth. Not "to the moon." Considered.
- **The network dots** — cross-source verification. Multiple sources
  agree before we show you a number.
- **CP monogram read** — readable at every size. The "C" on the left,
  the "P" on the right with its vertical stem as the arrow stem.

### Files

| File | Use | Notes |
|---|---|---|
| `/public/logo.png` | **Source of truth** — everywhere by default | Founder-provided 1024×1014 RGBA PNG. next/image handles responsive sizing + srcset; browser downscales gracefully at 16/24/28/64px. Favicon also points at this file. |

Only one logo file is tracked. We dropped the simplified SVG
recreations on 2026-04-18 when the founder dropped in the full PNG —
having two sources of truth (SVG vs PNG) was a bug magnet.

### Where it ships today

- **App header** (`src/components/app-shell.tsx`) — **48×48** next to
  "ClearPath" wordmark (18px).
- **Mobile drawer** (`src/components/app-shell.tsx`) — **40×40** in
  the sheet header.
- **Marketing top nav** (`src/components/marketing/nav.tsx`) — **44×44**.
- **Marketing footer** (`src/components/marketing/footer.tsx`) — **40×40**.
- **Auth pages** (Sign in / Sign up / Forgot password / Reset password
  / Verify / Verify-2FA) — **64×64** stacked above a spaced
  "ClearPath Invest" uppercase wordmark label. Consistent masthead
  across every auth surface.
- **Browser tab + bookmarks** — Next.js file-based icon convention
  via `src/app/icon.png` + `src/app/apple-icon.png` (copies of
  `/public/logo.png`). The file-based route takes precedence over
  metadata config and ships cache-friendly responses automatically.

**Sizing rule of thumb:** 48px in the app header (anchor the brand
alongside content), 64px on auth pages (brand-first surfaces),
40-44px in marketing chrome. Never smaller than 40px in any
user-facing surface; never larger than 64px except inside a
marketing hero.

## Color palette (hybrid-v2, April 2026)

| Token | Hex | Purpose |
|---|---|---|
| Background | `#F4F7FB` | Page background (cool off-white) |
| Card | `#FFFFFF` | Surfaces that sit on the page |
| Border | `#E4E9F1` | All default divider / card edges |
| Primary | `#2563EB` | Brand blue. Accents, links, focus, chart primaries. |
| Foreground | `#0B1220` | Body text |
| Muted | `#6B7684` | Secondary text, labels |
| `--buy` | `#15803D` | BUY verdicts, up-moves, green candlesticks |
| `--sell` | `#DC2626` | SELL verdicts, down-moves, red candlesticks |
| `--hold` | `#CA8A04` | HOLD verdicts, warnings |
| Candle navy | `#0F1E4A` | Dark candlestick bodies in the logo only |

Dark mode flips the background (`#0B1220`), card (`#111827`), and
foreground (`#F8FAFC`) but keeps the primary blue + buy/sell/hold
constant (for verdict-color consistency).

## Typography

- **Body + headings:** Inter (variable, SIL OFL)
- **Numbers + mono:** JetBrains Mono (tabular figures on by default)

We dropped Fraunces/serif entirely in the hybrid-v2 redesign. The
mood is "terminal meets editorial" — Inter carries both. Headings
use `tracking-[-0.015em]` for that quiet-confident settling.

## Voice

Three rules, in order:

1. **Plain English over jargon.** "Bought early, sold late" over
   "entry/exit price deltas." No user-facing copy mentions tokens,
   models, crons, AI SDK, etc.
2. **Show the math when it matters.** "Concentration >25% flagged"
   beats "risk threshold exceeded."
3. **Never soften legal language.** "Informational only, not
   investment advice" is a fixed string everywhere it appears.

## What NOT to do

- Don't rotate the logo. The arrow has a specific angle and slope.
- Don't recolor the primary swoosh away from `#2563EB`.
- Don't re-introduce an SVG version of the logo unless you also
  update every call site. Today `/public/logo.png` is the single
  source of truth.
- Don't use the diamond/rotate-45 placeholder mark from the earlier
  design — it was removed on 2026-04-17 when the real logo shipped.
- Don't introduce a new accent color without updating this file.
