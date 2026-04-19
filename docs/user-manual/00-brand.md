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
| `/public/logo.svg` | Everywhere by default | Full-color blue with colored candlestick accents. Renders sharp at 16px–1024px. |
| `/public/logo-mono.svg` | Tight palette contexts | Single-color (uses `currentColor`). Tints from the parent text color. |
| `/public/icon.svg` | Favicon (browser tab) | Blue-bg rounded-rect with the white mark. Also used as the PWA icon. |
| `/public/logo-full.png` *(optional)* | Marketing hero / social | Drop the full-detail raster here if richer rendering is wanted (will be used verbatim wherever `src="/logo-full.png"` is referenced). |

> **Note:** A detailed reference PNG of the mark was provided by the
> founder on 2026-04-17. The current `/public/logo.svg` is a clean
> simplified recreation optimized for the 24-32px header context. If
> you want the richer version in-app, save the source PNG as
> `/public/logo-full.png` and swap the `src` in the header.

### Where it ships today

- **App header** (`src/components/app-shell.tsx`) — 28×28 next to
  "ClearPath" wordmark.
- **Mobile drawer** (`src/components/app-shell.tsx`) — 24×24 in the
  sheet header.
- **Marketing top nav** (`src/components/marketing/nav.tsx`).
- **Marketing footer** (`src/components/marketing/footer.tsx`).
- **Sign in / Sign up / Forgot password / Reset password** — all
  auth pages render the mark at 16×16 above the title.
- **Browser tab + bookmarks** — via `/public/icon.svg`.

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
- Don't recolor the primary swoosh away from `#2563EB`. If you need
  monochrome, use `logo-mono.svg` (which picks up `currentColor`).
- Don't use the diamond/rotate-45 placeholder mark from the earlier
  design — it was removed on 2026-04-17 when the real logo shipped.
- Don't introduce a new accent color without updating this file.
