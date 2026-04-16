# ClearPath Invest — State of the App

**Snapshot date:** 2026-04-15
**Author:** Sang (with Claude Opus 4.6)
**Purpose:** Full handoff. Everything built, how it's wired, how to run it. Pair with `2026-04-15-next-steps.md` for the remaining work.

---

## 1. What ClearPath Invest is

A research-desk tool for individual investors. User asks "should I sell NVDA?" — ClearPath pulls live data from 12+ authoritative sources (SEC EDGAR, FRED, Yahoo Finance, Treasury, BLS, etc.), runs it through **three independent reasoning engines in parallel** (Claude Sonnet 4.6, GPT-5.2, Gemini 3 Pro), cross-verifies every claim against the source data via a **supervisor review**, and returns a structured recommendation (BUY / HOLD / SELL / INSUFFICIENT_DATA) with confidence level, agreed points, disagreements, and red-flagged unverified claims.

**Positioning:** evidence over vibes. AI is backstage machinery, not the marketing hero. The product promise is *clarity on real money decisions, backed by verified primary sources*.

**Differentiators vs. every other "AI investing" tool:**
- Live data, not training data
- Three independent models — disagreement is surfaced, not hidden
- Every numeric claim must appear in the source data block (unverified claims flagged)
- Biases toward HOLD on ambiguous evidence

---

## 2. Stack

| Layer | Tech | Notes |
|---|---|---|
| Framework | Next.js 16.2.4 (App Router, Turbopack) | `proxy.ts` not `middleware.ts` in v16 |
| Runtime | Node.js 20 | |
| Language | TypeScript 5 | Strict mode |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`) | `@theme inline` tokens, no `tailwind.config.*` |
| UI library | shadcn/ui (Base UI variant) | `new-york` style. Uses `radix-ui` unified package |
| Animation | Motion (framer-motion rebrand) | **Never use `initial:opacity:0` as outer wrapper — hydration timing can strand content invisible** |
| Fonts | Geist Sans, Geist Mono, **Fraunces** (display serif) | Fraunces italic is the "considered" accent used across marketing and auth |
| Auth | BetterAuth v1.6 | Email/password + Google OAuth + session cookies |
| Database | Neon Postgres (via `@neondatabase/serverless`) | Project: **Invest** (`broad-sun-50424626`) — separate from Mentis Vision |
| AI SDK | Vercel AI SDK v6.0.162 | `generateObject` with Zod schemas for structured output |
| AI providers | `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google-vertex` (Express Mode) | **Direct provider keys, NOT AI Gateway** (user chose to reuse existing Mentis accounts for unified billing across apps) |
| Data sources | `yahoo-finance2` npm, SEC EDGAR REST, FRED REST | |
| Deploy | Vercel | Team: `mentisvision`, Project: `invest`, Domain: `clearpath-invest.vercel.app` |
| Repo | GitHub `Mentis-Vision/invest` (public) | |

### Theme — "Editorial Warm"
Light mode is the default. See `src/app/globals.css` for the full palette:
- Background: warm ivory `#FAF7F2`
- Foreground: deep ink `#1A1A1E`
- `--buy` (primary): forest green `#2D5F3F`
- `--hold`: burnished gold `#9A7B3F`
- `--sell` (destructive): deep wine `#8B1F2A`
- `--decisive` (CTA attention): burnished rust `#B54F2A`
- Border: warm gray `#E8E4DC`

Dark mode palette retained and toggled via `next-themes` with `attribute="class"`.

---

## 3. Repo layout

```
/Volumes/Sang-Dev-SSD/invest
├── handoff/                       ← you are here
├── src/
│   ├── app/
│   │   ├── page.tsx               ← Marketing landing (/)
│   │   ├── how-it-works/          ← 5-stage pipeline page
│   │   ├── manifesto/             ← editorial "Investing should not be vibes"
│   │   ├── pricing/               ← 3 tiers + FAQ
│   │   ├── sign-in/               ← auth page (light editorial)
│   │   ├── sign-up/               ← auth page (light editorial)
│   │   ├── app/                   ← auth-gated dashboard root
│   │   │   └── page.tsx           ← loads DashboardClient with session user
│   │   ├── api/
│   │   │   ├── auth/[...all]/     ← BetterAuth handler
│   │   │   ├── research/          ← 3-model consensus endpoint (POST ticker)
│   │   │   ├── strategy/          ← stub for portfolio-level advice
│   │   │   └── waitlist/          ← public waitlist capture → Neon
│   │   ├── layout.tsx             ← fonts (Geist + Fraunces), theme provider, tooltip
│   │   └── globals.css            ← Editorial Warm tokens
│   ├── proxy.ts                   ← auth-gates /app/* + /api/research|strategy only
│   ├── lib/
│   │   ├── auth.ts                ← BetterAuth server config (Neon Pool)
│   │   ├── auth-client.ts         ← BetterAuth React client
│   │   ├── utils.ts               ← cn()
│   │   ├── ai/
│   │   │   ├── models.ts          ← lazy-init model registry (claude/gpt/gemini)
│   │   │   ├── schemas.ts         ← AnalystOutput + SupervisorOutput Zod schemas
│   │   │   └── consensus.ts       ← runAnalystPanel() + runSupervisor()
│   │   └── data/
│   │       ├── yahoo.ts           ← price/valuation/volume snapshot
│   │       ├── sec.ts             ← recent 10-K/10-Q/8-K filings via EDGAR
│   │       └── fred.ts            ← Treasury yields, CPI, unemployment, VIX
│   └── components/
│       ├── ui/                    ← shadcn primitives (Base UI)
│       ├── marketing/
│       │   ├── nav.tsx            ← sticky marketing header
│       │   ├── footer.tsx         ← site footer
│       │   └── waitlist-form.tsx  ← email capture → /api/waitlist
│       ├── views/
│       │   ├── dashboard.tsx      ← overview with mock macro + stats
│       │   ├── portfolio.tsx      ← placeholder (Connect Brokerage button)
│       │   ├── research.tsx       ← consensus verdict UI (working!)
│       │   ├── strategy.tsx       ← placeholder (Get AI Advice button)
│       │   └── integrations.tsx   ← data source directory (mostly visual)
│       ├── app-shell.tsx          ← sidebar nav + mobile sheet + user dropdown
│       ├── auth-layout.tsx        ← paper-grain background, editorial framing
│       └── dashboard-client.tsx   ← view state for the 5 tabs
├── .env.example                   ← all required env vars documented
├── .env.local                     ← local dev values (gitignored)
├── package.json
└── postcss.config.mjs             ← Tailwind v4 PostCSS plugin
```

---

## 4. What works end-to-end

### Marketing site (public, /)
- `/` landing — hero, mock verdict card preview, 4-step process, 12 data sources grid, honest comparison table, CTAs
- `/how-it-works` — 5-stage pipeline with icons + 3 commitments section
- `/manifesto` — editorial piece with dropcap, pull-quote rules, signed masthead
- `/pricing` — Beta (free) / Individual ($29) / Advisor (custom) + FAQ
- Waitlist form on all pages → posts to `/api/waitlist` → upserts into Neon `waitlist` table
- Shared `MarketingNav` + `MarketingFooter`

### Auth (BetterAuth)
- Email/password sign-up and sign-in (working)
- Google OAuth — **requires GCP consent screen + authorized redirect URI exactly `https://clearpath-invest.vercel.app/api/auth/callback/google`** (was broken by `\n` in `BETTER_AUTH_URL`, fixed)
- Session cookies via BetterAuth default
- Proxy redirects unauthenticated `/app/*` and `/api/research|strategy` hits to `/sign-in`
- Tables on Neon: `user`, `session`, `account`, `verification`

### Dashboard (auth-gated, /app)
- Sidebar nav + mobile sheet (Overview, Portfolio, Research, AI Strategy, Data & APIs)
- User avatar dropdown with sign-out
- **Research tab: FULLY WORKING** — type ticker → triple-model consensus with verdict card + 3 per-model cards

### Consensus engine (`/api/research`)
Pipeline:
1. `getStockSnapshot(ticker)` → Yahoo Finance
2. `getRecentFilings(ticker)` → SEC EDGAR (5 most recent 10-K/10-Q/8-K/DEF 14A)
3. `getMacroSnapshot()` → FRED (10Y, 2Y, Fed funds, CPI, unemployment, VIX)
4. `runAnalystPanel()` → Claude + GPT + Gemini in parallel, `generateObject` with `AnalystOutputSchema`
5. `runSupervisor()` → Claude reviews all 3 outputs against raw data, `SupervisorOutputSchema`
6. Returns: `{ ticker, snapshot, analyses, supervisor, sources }`

UI surfaces: final verdict (BUY/HOLD/SELL + confidence + consensus strength), agreed points, disagreements with per-model views, red flags, and individual analyst cards.

### Data sources wired
- **Yahoo Finance** (`yahoo-finance2`) — price, P/E, market cap, 52-week range, analyst targets
- **SEC EDGAR** (free REST, no key, needs User-Agent header) — `data.sec.gov/submissions/CIK*.json`
- **FRED** (REST, needs `FRED_API_KEY`) — 6 series cached 1h

### Test accounts
- **Demo user:** `demo@clearpath.com` / `DemoPass2026!` (created 2026-04-15)

---

## 5. Env vars (Vercel production, all set)

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooler URL for BetterAuth + waitlist |
| `BETTER_AUTH_SECRET` | 32-byte random (from `openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | `https://clearpath-invest.vercel.app` (no trailing slash, no newline — had a `\n` bug, fixed) |
| `GOOGLE_CLIENT_ID` | GCP OAuth client (Mentis Vision project) |
| `GOOGLE_CLIENT_SECRET` | GCP OAuth secret |
| `ANTHROPIC_API_KEY` | Anthropic console key (ClearPath-labeled) |
| `OPENAI_API_KEY` | OpenAI dashboard key |
| `VERTEX_SERVICE_KEY` | Google Vertex API key (Express Mode) — code also accepts `GOOGLE_VERTEX_API_KEY` |
| `GOOGLE_VERTEX_PROJECT` | `mentis-vision-479702` |
| `GOOGLE_VERTEX_LOCATION` | `us-central1` |
| `FRED_API_KEY` | Federal Reserve Economic Data (free registration) |

---

## 6. Neon schema (project `broad-sun-50424626`)

```sql
user                          -- BetterAuth: id, name, email, emailVerified, image, createdAt, updatedAt
session                       -- BetterAuth: id, expiresAt, token, userId FK, ipAddress, userAgent
account                       -- BetterAuth: id, accountId, providerId, userId FK, accessToken, refreshToken, password (hashed), ...
verification                  -- BetterAuth: id, identifier, value, expiresAt

waitlist                      -- public capture
  id SERIAL PK
  email TEXT UNIQUE NOT NULL
  name TEXT
  portfolioSize TEXT
  source TEXT                 -- 'landing-hero' | 'pricing-individual' | 'manifesto' | etc
  notes TEXT
  createdAt TIMESTAMP DEFAULT NOW()
  invitedAt TIMESTAMP
  ipAddress TEXT
  userAgent TEXT
```

To query signups:
```sql
SELECT email, source, "createdAt" FROM waitlist ORDER BY "createdAt" DESC;
```

---

## 7. Key design decisions (why things are the way they are)

- **Direct provider SDKs over Vercel AI Gateway.** User already has Anthropic, OpenAI, and GCP/Vertex accounts for Mentis Vision. Avoids AI Gateway's ~5% markup and keeps billing consolidated in existing accounts. Tradeoff: no automatic failover, no unified usage dashboard — accept this.
- **Models are lazy-initialized** (getters on the `models` object in `src/lib/ai/models.ts`). `createVertex()` requires env vars at construction time, which fail during Next.js build-time page-data collection. Getters defer construction to request time.
- **`proxy.ts` matcher excludes `_next/static`** — an earlier version of the proxy matched everything and was redirecting CSS chunk requests to `/sign-in`, breaking all styling. Don't regress this.
- **Never wrap meaningful content in `motion.div` with `initial: opacity: 0`** — two separate bugs in this repo where content was rendered but stuck invisible when hydration timing went sideways. If you want animation, animate color/scale/transform instead.
- **Marketing at `/`, app at `/app/*`** — clean public/private split. `proxy.ts` only gates `/app` and the AI API routes. Everything else is public.
- **Editorial Warm theme + Fraunces italic** — positioning the product as "trusted financial publication," not "another SaaS dashboard." Italic on emphasis words (`*considered*`, `*your money*`) is the signature move.
- **Vercel deploy, not Sliplane.** User runs Mentis Vision on Sliplane; ClearPath is Vercel-native to avoid noisy-neighbor CPU contention with business-critical Mentis workloads.
- **Demo user exists for Plaid/brokerage testing** — don't delete `demo@clearpath.com`.

---

## 8. Bugs fixed during this build (so we don't regress)

| Bug | Fix location | Commit-ish |
|---|---|---|
| Original `clearpath-invest` repo: `app.get()` called before `app` declared | n/a — rebuilt in Next.js | — |
| Shadcn init injected broken `@import "shadcn/tailwind.css"` | removed in `globals.css` | early |
| Base UI `DropdownMenuTrigger`/`SheetTrigger` don't accept `asChild` | removed from `app-shell.tsx` | early |
| `generateObject` false-flagged as removed in v6 | verified still exported — ignore hook | `consensus.ts` |
| `createVertex()` at module load broke build | lazy getter in `models.ts` | 8156d32 |
| `BETTER_AUTH_URL` had literal `\n` from `echo` | re-added with `printf`, no trailing newline | runtime fix |
| Proxy intercepted CSS chunks → pages unstyled | matcher excludes `_next/static` | 779dbe7 |
| Motion `initial: opacity: 0` stuck content invisible (twice — auth + research) | removed motion wrappers | 3583796, 5f217b2 |

---

## 9. Commands you'll actually use

```bash
# local dev
cd /Volumes/Sang-Dev-SSD/invest
npm install
npm run dev                         # http://localhost:3000

# build/typecheck before deploy
npm run build

# deploy to Vercel
vercel --prod --scope mentisvision

# manage env vars
vercel env ls production --scope mentisvision
printf "VALUE" | vercel env add NAME production --scope mentisvision   # NEVER use echo — it appends \n
vercel env rm NAME production --scope mentisvision --yes
vercel env pull /tmp/env.production --environment=production --scope mentisvision --yes

# view deployment logs
vercel inspect <deployment-url> --scope mentisvision
# or via MCP: mcp__claude_ai_Vercel__get_deployment_build_logs

# query Neon via MCP
# project: broad-sun-50424626
```

---

## 10. Live URLs

- **Production:** https://clearpath-invest.vercel.app
- **GitHub:** https://github.com/Mentis-Vision/invest
- **Vercel project:** https://vercel.com/mentisvision/invest
- **Neon project:** Invest (`broad-sun-50424626`)
