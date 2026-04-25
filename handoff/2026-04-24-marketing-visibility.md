# Marketing Visibility — Handoff

**Date:** 2026-04-24
**Context:** Built Phase 1–2 of the visibility plan; this handoff captures everything deferred, plus the content artifacts (copy, target lists, pitch templates) Sang needs to execute the non-code parts.

---

## What's already shipped in this branch

Code (live on clearpathinvest.app after deploy):

- `/alternatives` — competitor comparison matrix, honest side-by-side vs. Empower, Morningstar, Seeking Alpha, Yahoo, ChatGPT, Stock Rover. `ItemList` JSON-LD.
- `/stocks` — directory hub (46 seed tickers).
- `/stocks/[ticker]` — programmatic SEO landing pages. Server-rendered from warehouse, zero AI cost per visit, ISR with 6h revalidation, Article/Product-style metadata. Internal links to `/how-it-works`, `/alternatives`, `/track-record`.
- `/embed/[ticker]` — iframe-friendly dossier widget. Noindex (canonical is `/stocks/[ticker]`). `<iframe>` copy-paste snippet published on each ticker page.
- `/track-record` — public aggregate hit-rate, confidence calibration, outcome distribution. Pre-data state renders the methodology transparently.
- **`/research` + `/research/[slug]` — weekly bull-vs-bear briefs** (NEW — shipped in the 2026-04-24 session second half). Full three-lens Panel + bull/bear debate + supervisor, rendered with verdict card, bull case, bear case, per-lens excerpts, supervisor agreement/disagreement/red-flags. Article-type OG metadata per brief.
- **`/research/feed.xml` — RSS 2.0 feed** (NEW). Aggregator-friendly, 1h edge cache.
- **`/api/cron/weekly-bull-bear` — Mondays 10:00 UTC cron** (NEW). Picks a ticker from a 32-ticker rotation pool (4-week cooldown), runs the full Panel pipeline, persists to `public_weekly_brief`. Bearer-token-gated, idempotent (ON CONFLICT by ticker+week), supports `?ticker=`/`?week=`/`?force=1` ops overrides.
- `sitemap.ts` — now async, pulls live brief slugs from DB (capped at 200). Seeded static routes + 46 ticker URLs + all published brief URLs.
- Marketing nav — "Weekly brief" added as first item; "Track record" moved to footer; footer lists all discovery pages.

Supporting libs:

- `src/lib/warehouse/public-dossier.ts` — zero-AI ticker dossier loader, safe for unauthenticated reads.
- `src/lib/public-track-record.ts` — aggregate stats helper (no userId anywhere, schema-enforced).
- **`src/lib/public-brief.ts`** (NEW) — `pickWeeklyTicker()` + `generateAndSaveWeeklyBrief()` + read helpers + `mondayOf()` date utility.

DB schema (NEW via Neon MCP):

- `public_weekly_brief` — id, ticker, week_of (date), slug (unique), recommendation, confidence, consensus, price_at_rec, summary, bull_case, bear_case, analysis_json (jsonb), data_as_of, cost_cents, status, created_at, updated_at. Indexed on (ticker, week_of) unique, slug unique, week_of DESC, ticker.

Cron schedule (registered in `vercel.json`):

```
/api/cron/weekly-bull-bear: 0 10 * * 1  (Mondays 10:00 UTC, 6am ET)
```

---

## Phase 2 wave (also shipped 2026-04-24)

Three additional pieces shipped in parallel after the initial visibility infrastructure:

### Auto-email weekly brief — SHIPPED
- New cron `/api/cron/email-weekly-brief` runs Mondays 11:00 UTC (1 hr after the brief generates). Bearer-CRON_SECRET-gated. 500-recipient cap per run; 5-day idempotency window via `weeklyBriefSentAt`.
- Sends to verified non-demo users + waitlist rows (deduped by lowercased email; user wins).
- New `weeklyBriefOptOut` + `weeklyBriefSentAt` columns on both `user` and `waitlist` (applied via Neon MCP).
- Unsubscribe via HMAC-SHA256-signed token (signed with `CRON_SECRET`) — stateless, no DB lookup at click time. Token verification at `/api/unsubscribe` GET (interactive) and POST (RFC 8058 one-click).
- Settings UI gap: `settings-client.tsx` only shows the digest toggle — adding a parallel "Monday brief" checkbox is a small follow-up.

### Brief outcome retrospective — SHIPPED
- New table `public_weekly_brief_outcome` with FK to `public_weekly_brief` (cascade delete), 4 rows per brief (7d/30d/90d/365d), uniqueness on (brief_id, window).
- `scheduleBriefOutcomes()` called fire-and-forget after each brief generation (failures log but don't break brief publish).
- `evaluatePendingPublicBriefOutcomes()` runs as step 11 in the existing `/api/cron/evaluate-outcomes` daily cron. WIN/LOSS/FLAT logic: BUY wins > +3%, SELL wins < -3%, HOLD wins on |move| ≤ 3%.
- `/research/[slug]` renders an `OutcomeRetrospective` section with completed-window cards or a "resolves at 7d/30d/90d/365d" placeholder. Track-record-mandated disclaimer rendered per AGENTS.md rule.
- NVDA brief (`nvda-2026-04-20`) had outcomes scheduled at: 7d=2026-05-01, 30d=2026-05-24, 90d=2026-07-23, 365d=2027-04-24.
- Benchmark caveat: `getBenchmarkPriceAt()` reads SPY from `price_snapshot`. Historical SPY snapshots not guaranteed for old briefs → some `benchmark_change_pct` values may be NULL until SPY enters `price_snapshot`. Consider a one-shot SPY backfill if alpha math matters.

---

## DEFERRED — needs Sang's input or action

### 1. Weekly bull vs. bear briefs — SHIPPED

All of this is built and deployed. Details:

- URL pattern changed from the original spec (`/research/[ticker]/[YYYY-MM]`) to `/research/[slug]` where slug is `ticker-YYYY-MM-DD` (Monday of the week). Simpler routing and the date works as a stable primary key.
- Picker strategy uses a curated 32-ticker rotation pool with a 4-week cooldown — deterministic-ish (rotates on ISO week number so same-week retries pick the same ticker, which makes the cron idempotent with its own retries).
- "Disagreement-first" picker was deferred — right now it rotates the retail-interest pool in a fair way. When we want smarter picking, add a second strategy that reads `ticker_sentiment_daily` or prior-week lens disagreements, and fall back to the rotation pool. Tracked as "Phase 2 picker" below.
- Informational-only disclaimer renders inline on every brief page + feed entry.
- The cron is idempotent via `ON CONFLICT (ticker, week_of)` on the DB table — safe to re-run.
- First run behavior: the cron fires next Monday at 10:00 UTC. If you want to see it render before then, manually hit the endpoint:

```bash
# Replace $CRON_SECRET with the production secret from Vercel env
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://clearpathinvest.app/api/cron/weekly-bull-bear?ticker=NVDA"
```

**Phase 2 improvements** (deferred):

- Smarter ticker picker (disagreement-weighted)
- Brief-to-newsletter automation (send the brief to the waitlist email list on publication)
- "Outcome update" — 30-day retrospective rendered on each brief page once the 30d evaluation resolves (reuse `recommendation_outcome` patterns, but keyed on `public_weekly_brief.id` — new `public_weekly_brief_outcome` table)
- Optional 2x/week cadence (Monday + Thursday) if retail demand supports it — literally a cron schedule change

---

### 1a. Ticker-coverage expansion — SHIPPED

673 deduped tickers now seeded into the warehouse universe. Composition: S&P 500 (504), Nasdaq 100 (103), Dow 30 (31), retail favorites (50), foreign ADRs (35), ETFs (73). Crypto-direct symbols intentionally excluded (Yahoo would resolve them as unrelated equity namesakes — crypto comes in via user holdings on the Alpha Vantage path).

Key changes:
- `src/lib/warehouse/seed-universe.ts` (NEW) — typed array, ETF wins on dedupe ties
- `src/lib/warehouse/universe.ts` — `getTickerUniverse()` now returns `union(holdings, SEED_UNIVERSE)`. AGENTS.md rule #9 preserved: seed list is static and not user-attributed
- `src/app/sitemap.ts` — `/stocks/[ticker]` URLs now derived from `ticker_market_daily` (only tickers with a row in the last 2 days are listed); failure-tolerant
- `src/app/stocks/page.tsx` — dynamic, reads warehouse, capped at 500 displayed, "{N} stocks covered" subhead

**First cron run after deploy will take longer than usual** — ~673 tickers vs. the prior holding-only universe. Watch for elevated Yahoo rate-limit warnings; refresh sequencing handles its own concurrency caps.

Quarterly refresh of constituents is documented in the seed file header.

### 1b. (history of original 1a — kept for reference)

**Scope:** expand `/stocks/[ticker]` indexable coverage from 46 today to ~600–1,000 tickers.

**Why it's not "trivial":** adding more static entries to `src/app/stocks/page.tsx` is one line. But without corresponding warehouse data for each added ticker, the page renders the "priming" empty state. Google treats hundreds of near-empty pages as doorway content and can penalize the domain. The real fix is threefold:

1. **Expand the warehouse universe**
   - Current: `getTickerUniverse()` in `src/lib/warehouse/universe.ts` returns only tickers from `holding`
   - Add: static seed list of S&P 500 + Nasdaq 100 + Dow 30 + ~50 retail favorites (dedupe, ~520 tickers)
   - Return: `union(holdings, seed)` to the nightly cron
   - Per AGENTS.md rule #9: this is the ONLY caller of `holding.ticker`. The change must preserve that — seed list is a static array, not a DB table, and the rule is about user-attribution privacy, not about limiting universe size. No PII leak.

2. **Make the sitemap dynamic**
   - Today: static array in `src/app/sitemap.ts`
   - Needed: query `ticker_market_daily` for tickers with a row from the last ~2 days; include only those as `/stocks/[ticker]` URLs
   - Effect: Google only sees "real" ticker pages — "priming" URLs never enter the index

3. **Expand the `/stocks` directory page**
   - Same query as the sitemap — show only primed tickers
   - Organize by sector / market cap / retail-interest for scannability

**Cost:** ~$2–5/month in extra Yahoo + SEC API calls for pre-priming 500 non-held tickers. Possibly higher if Yahoo rate-limits harder at volume — budget $10/month to be safe.

**Estimated build:** half a day (careful change — touches warehouse orchestrator, per rule #9).

**Prerequisite:** decide the seed list. Easiest path: publish a constant like `src/lib/warehouse/seed-universe.ts` with the array, review the list, sign off, then wire it.

**Not-yet-answered questions for you:**
- Want Russell 1000 instead of Dow 30? Russell 1000 = ~1,000 names, overlap mostly with S&P + Nasdaq, so "S&P 500 + Nasdaq 100 + Russell 1000" ≈ 1,100 unique tickers. Same API-cost order of magnitude.
- Want international ADRs (TSM, ASML, TM)? They're popular retail tickers and our Yahoo reader already handles them. Another ~50 tickers.

---

### 2. AI / fintech directory submission kit

**Can't be automated — submission forms require captchas and manual copy pasting.** But here's the batch-ready kit so Sang can fire them off in 30–45 minutes.

**Pre-filled submission copy** (copy-paste-ready):

**Short description (120 chars):**
> Evidence-based stock research. Three AI lenses — Quality, Momentum, Context — cross-examine live SEC + Fed data.

**Medium description (250 chars):**
> ClearPath Invest is evidence-based stock research for retail investors. Three independent AI lenses — Quality, Momentum, Context — examine the same live SEC, Federal Reserve, and market data. Every claim traces to a primary source. Informational only, not investment advice.

**Long description (600 chars):**
> ClearPath Invest is an evidence-based stock research tool built for retail investors who want rigor without an advisor. Every query runs through three independent investment lenses — Quality (fundamentals), Momentum (price action), and Context (macro/sector) — each backed by a different frontier AI model so no single vendor's blind spots become yours. A supervisor verifies every factual claim against primary sources: live SEC filings, Federal Reserve data, and market feeds. Disagreement between lenses is surfaced, not hidden. HOLD is the default when evidence is ambiguous. Not investment advice.

**Tags/categories:** Fintech, Investment Research, AI Tools, Finance, Stock Analysis, Portfolio Management, SEC Data, Evidence-Based Investing

**Screenshots needed** (prep once, reuse everywhere):
- Landing page hero + NVDA mock card (1920×1080)
- Research page with Three-Lens consensus visible
- Example brief (AAPL one from /how-it-works)
- Pricing page
- Track record page

**Logo assets:** `public/logo.png` (1024×1014, square), resize to 256×256 and 512×512 for directories that want exact dimensions.

**Submission batch — Tier 1 (must-do, ~15 min total):**

| Directory | URL | Approved-instance est. |
|---|---|---|
| **Product Hunt** | producthunt.com | Schedule launch, not just submission |
| **Alternative To** | alternativeto.net/software/new/ | Submit as alt to Morningstar, Seeking Alpha, Empower |
| **Indie Hackers** | indiehackers.com/products/new | Free, founder-friendly community |
| **BetaList** | betalist.com/submit | Pre-launch traffic spike |
| **Futurepedia** | futurepedia.io/submit-tool | Largest AI-tool directory |
| **There's An AI For That** | theresanaiforthat.com/submit/ | Second-largest AI directory |
| **AI Tools Directory** | aitoolsdirectory.com | Free listing |
| **Top AI Tools** | topai.tools/submit | Free listing |
| **Tools.ms** | tools.ms/submit | Free listing |

**Tier 2 (fintech-specific, ~20 min):**

| Directory | URL |
|---|---|
| **Fintech Meetup** startups | fintechmeetup.com/startup-directory |
| **Finovate** | finovate.com (media directory) |
| **The Paypers** directory | thepaypers.com/company-directory |
| **Finextra** | finextra.com (press release distribution) |
| **Crunchbase** | crunchbase.com (company profile) |
| **LinkedIn Company Page** | linkedin.com/company (if not already created) |

**Tier 3 (SaaS review sites, ~10 min):**

| Site | URL |
|---|---|
| **G2** | g2.com/products/new |
| **Capterra** | capterra.com/vendors |
| **GetApp** | getapp.com |
| **Software Advice** | softwareadvice.com |

**Pro tip:** batch these in a 90-minute Saturday morning session with a spreadsheet tracking which ones asked for what. Most reuse the same short/long description, so after the first 2 the rest are copy-paste.

---

### 3. Show HN launch post (ready to publish)

**Suggested timing:** Tuesday or Wednesday, 9:00–10:00 ET. Avoid weekends (lower engagement) and Fridays (drops off news cycle).

**Title options** (pick the one that matches current state of site):

- `Show HN: Evidence-based stock research with multi-model consensus and traceable claims`
- `Show HN: ClearPath – stock research where every claim cites its source`
- `Show HN: Three-lens AI stock analysis that defaults to HOLD when evidence disagrees`

**Post body (copy-paste ready):**

```
Hi HN,

I've been working on ClearPath Invest — evidence-based stock research for
retail investors who don't want an advisor but do want rigor.

The problem: ask ChatGPT about a stock and you get a confident answer
averaged from training data frozen months ago. There's no source, no
indication when the model doesn't know, and no way to tell whether the
answer is any good.

The approach:

1. Pull live data: SEC 10-Q/10-K filings, Federal Reserve indicators,
   real-time market prices, BLS employment data. 12+ primary sources.
2. Run the same evidence through three independent "lenses" in parallel:
   Quality (fundamentals), Momentum (price action), Context (macro).
   Each lens is backed by a different frontier model (Claude, GPT,
   Gemini) so no single vendor's blind spots become yours.
3. A supervisor cross-checks every factual claim against the source
   data block. Unverifiable claims get flagged, not smoothed over.
4. Consensus strength sets confidence: unanimous -> HIGH, majority ->
   downgraded, split -> defaults to HOLD.
5. Output is a structured brief: verdict, confidence, signals (with
   citations), explicit risks, model disagreements.

Three things I think are interesting:

- Zero-hallucination prompt design. Every claim the model emits must
  cite a line from the DATA block or get stripped by the supervisor.
  The prompt itself is enforcement-first, not guidance-first.
- The default-to-HOLD rule. When Quality says BUY and Momentum says
  SELL, most tools smooth it into a wishy-washy summary. We surface
  the disagreement and default to HOLD with LOW confidence.
- Public track record at /track-record. Misses published, not just
  wins. 30-day outcomes resolved nightly.

Live at https://clearpathinvest.app. Private beta. Would love feedback
on the methodology, especially from anyone who's built or operated
multi-agent research pipelines.

Not investment advice.

— Sang
```

**After it posts:**
- Respond fast to the first 3–5 comments (first hour determines ranking)
- Don't argue with critics — engage with genuine technical questions
- Don't upvote yourself (HN detects it, will shadowban)
- Share to X/LinkedIn only AFTER it's stable on the front page (premature sharing causes rapid downvote spiral)

---

### 4. Founder content ideas (Sang on X + LinkedIn)

**Rule of thumb:** 3–5 posts/week. Mix of case-studies, anti-hype takes, behind-the-scenes, and screenshots. Founders' faces get 3–5× the reach of brand posts.

**20 ready-to-post topics** (rough order of strength):

1. "We asked three AI models if NVDA was a buy. Here's where they disagreed." + screenshot
2. "Why we default to HOLD when models disagree (and why no one else does)"
3. "The real cost of a single AI hallucination in a real portfolio" (specific scenario)
4. "Anatomy of a three-lens brief" (annotated screenshot)
5. "What ChatGPT can't tell you about a 10-Q (and what it just makes up)"
6. "Our supervisor rejected 23% of model claims last week. Here's what it caught."
7. "We publish our misses. Here's our April 30-day hit rate." (once /track-record has data)
8. "The pitch that didn't make it" — a version of the manifesto we scrapped
9. Time-lapse of a brief being built (ingest → analyze → verify → deliver)
10. "Three rules our prompt enforces that ChatGPT can't" (technical post)
11. "Why a 'net-worth tracker' isn't stock research" (Empower comparison)
12. "What a traceable claim actually looks like" (click-through demo)
13. "The question I can't stop getting: 'Why three AIs?' — here's the honest answer"
14. "Every number in a ClearPath brief links to its source. Here's how."
15. "HOLD is an answer. Most tools won't say it."
16. Tear-down of a bad AI investing prompt → rewritten ClearPath version
17. "The warehouse architecture that makes our briefs free to render" (technical)
18. "Beta user of the week" with their permission + a specific story
19. "What I got wrong about retail investors" (founder reflection)
20. A 10-tweet thread walking through one NVDA brief end-to-end

**Posting cadence:** M/W/F on X (short/punchy); Tuesday + Thursday on LinkedIn (longer, more reflective). Each post always has a link to a real ClearPath URL — no empty musings.

**Hashtags for X:** #fintech #investing #AI (sparingly — HN-tone is stronger than hashtag-heavy posts)

---

### 5. Newsletter sponsorship kit

**Sang's question:** "create these newsletter and let me know how to proceed"

*Two possible interpretations — covering both:*

#### Interpretation A: Newsletter SPONSORSHIPS (paid placements in other newsletters)

This was the original plan. Target list + creative kit + outreach template:

**Target newsletters (ranked by ROI):**

| Newsletter | Audience | Est. reach | Est. cost/placement |
|---|---|---|---|
| **The Daily Upside** | Retail investors, daily | ~1M | $5–8k |
| **Morning Brew** | General business, high reach | ~4M | $10–15k |
| **Exec Sum** | Finance / IB / PE | ~200k | $3–5k |
| **Not Boring** (Packy McCormick) | Founders, tech-curious | ~200k | $8–12k |
| **The Information** | Tech insider | ~500k paid | $15–20k |
| **Stocktwits Daily** | Active retail traders | ~500k | $4–6k |
| **The Transcript** | Earnings-focused | ~50k | $2–3k |
| **MBA Mondays (Fred Wilson)** | VC-adjacent | ~100k | $3–5k |

**Tier-1 pick for $5k budget:** The Daily Upside — most on-target audience for ClearPath.

**Creative to submit:**

*Subject-line sponsor slot (30–50 chars):*
> "The AI stock tool that admits when it doesn't know"

*Sponsor blurb (80–120 words):*
> Most AI investing tools give you one confident answer from stale
> training data with no source. ClearPath runs three independent
> lenses — Quality, Momentum, Context — on the same live SEC and
> Federal Reserve data, surfaces disagreement between them, and
> cites every claim back to its primary document. When evidence is
> ambiguous, it defaults to HOLD and tells you what it would need
> to be more confident. Free during private beta.
>
> **Get access:** clearpathinvest.app

*CTA button:* "Request beta access"
*UTM:* `utm_source=dailyupside&utm_medium=newsletter&utm_campaign=beta`

**Outreach email template** (send to sponsorships@[newsletter]):

```
Subject: Sponsorship inquiry — ClearPath Invest (fintech beta)

Hi [name],

I run ClearPath Invest, an evidence-based stock research tool in
private beta. Our audience overlap with [newsletter] is high —
retail investors who already read intelligent financial content
and want better tools than ChatGPT for real-money decisions.

Looking at one mid-week sponsorship slot to drive beta signups.
Budget in the [$X-Y] range for a single placement; if it performs,
happy to lock a 4-week cadence.

Creative ready to go, UTMs set up to measure CTR and signup rate.

Specifically interested in [insert recent newsletter issue topic]
as a content adjacency.

Site: clearpathinvest.app
Track record: clearpathinvest.app/track-record

Open to what you've got.

— Sang
```

**Success metric:** 1% CTR from the sponsorship, 20% landing-to-waitlist conversion = ~200 signups per $5k placement. Good-enough unit economics only if lifetime value > $25/signup (Individual tier @ $29/mo x 12 month lock).

#### Interpretation B: An owned ClearPath newsletter

If Sang meant "create a newsletter for ClearPath" (owned, not sponsored), the play is:

- **Weekly Monday brief:** the bull-vs-bear ticker of the week (same content as the public `/research/[ticker]` pages), delivered to email
- Platform: **Substack** (own the list, can migrate), or **Beehiiv** (better paid-tier mechanics later)
- Name ideas: "The ClearPath Weekly," "Three Lenses," "The Considered Take"
- Each issue drives back to `/research/[ticker]` and `/track-record`
- Grow via: existing waitlist (~500 subscribers instant), HN launch traffic, Reddit seeding

If you want this, defer to next session — it's a 1-day project (Substack setup, template, first issue).

---

### 6. Podcast tour target list

Defer per Sang's request. When ready:

**Target shows (ranked by audience × fit):**

| Show | Host(s) | Fit | Outreach channel |
|---|---|---|---|
| **Animal Spirits** | Michael Batnick & Ben Carlson | Huge fit — skeptical, data-driven | animalspiritspod@gmail.com |
| **The Compound & Friends** | Josh Brown | Ritholtz-adjacent, serious | `@downtown` on X |
| **Chat With Traders** | Aaron Fifield | Retail trader audience | aaron@chatwithtraders.com |
| **The Investor's Podcast** | Preston / Stig | Value-investing leaning | site form |
| **BiggerPockets Money** | Mindy Jensen | Retail-adjacent | site form |
| **The Fintech Blueprint** | Lex Sokolin | Fintech insider | site form |
| **Acquired** | Ben Gilbert, David Rosenthal | Stretch — tech/biz deep-dives | long shot, worth trying |
| **The Stacking Benjamins Show** | Joe Saul-Sehy | Retail/accessible | site form |

**Pitch template:**

```
Subject: Guest pitch — the AI investing tool that admits when it doesn't know

Hi [host],

I'm Sang, founder of ClearPath Invest — evidence-based stock research
that runs three independent AI lenses on live SEC + Fed data, cross-
checks every claim, and defaults to HOLD when the models disagree.

Three topics I could cover that your audience would engage with:

1. Why single-AI answers are dangerous for real money (with specific
   hallucination examples I've caught in the wild)
2. The default-to-HOLD rule — why most tools won't admit uncertainty
   and what that costs the average retail investor
3. The architecture of a zero-hallucination prompt (technical but
   accessible)

I can share the NVDA walkthrough live on the pod. Public track record
at clearpathinvest.app/track-record.

20–30 min, flexible on timing.

Not investment advice. Just research.

— Sang
```

**Targeting:** aim for 2 podcasts per month once the cadence starts. Each appearance = 2–3 backlinks (show notes, guest bio, host's own blog) + evergreen audio.

---

### 7. Long-game items (12+ months) — how-tos

These are deferred per Sang's "I don't know how to do this." Here's concrete guidance for each.

#### (12) Become the cited source for AI investing research

**Quarterly data report** — "The State of AI Investing Q2 2026." Pick ONE meaningful dataset each quarter:
- Q2: Model-disagreement rates across the S&P 500 (which tickers produce three-lens splits?)
- Q3: Hallucination frequency comparison (ClearPath vs. raw ChatGPT on the same 100 tickers)
- Q4: Confidence calibration accuracy — do HIGH-confidence calls outperform?

Each report is ~2,000 words + one chart, published at `/reports/[slug]`. Send to 20 reporters 24 hours before public. PR distribution: TechCrunch + The Information + Bloomberg + Axios Pro Rata + Matt Levine at Bloomberg.

**Reporter outreach list** (build this over 3 months by reading their work):
- Matt Levine (Bloomberg)
- Natasha Mascarenhas (TechCrunch)
- Berber Jin (WSJ fintech)
- Tracy Alloway (Bloomberg — Odd Lots)
- Byrne Hobart (Diff newsletter)
- Packy McCormick (Not Boring)

Each quarterly report = 1 press hit if well-timed, 3–5 if genuinely new.

#### (13) Conference speaking

**Fintech Meetup** (Las Vegas, February): startup-friendly, $2–4k for a booth, get you on their startup directory. Apply November for February speaking slot.

**Finovate Fall** (September NYC): bigger, $15k for a speaking slot. Hold until 2027 when there's real traction.

**Money20/20** (Las Vegas, October): the main fintech show. $25k+ for real speaking slot. Defer until Series A.

**Free/cheap path:** apply to the "startup stage" or "new ideas" track at each. Usually 5-min pitches, no cost beyond booth. Start with Fintech Meetup 2027.

#### (14) Open-source adjacent

**Easiest wins** (pick one, ~2 weeks of work each):

- `hallucination-detector` — given a claim and a source doc, return boolean + cited line. Publish on GitHub + HN "Show HN."
- `multi-model-consensus` — TypeScript library that takes N model outputs and returns consensus strength + disagreement signal. Publish as npm package.
- `sec-edgar-parser` — clean, typed Node client for SEC EDGAR. No one has a great one. Would rank on GitHub for weeks.

Each one = 1 HN front page + developer-community credibility + devs who later become users.

#### (15) Financial media white-label

Defer to Year 2. Approach only when we have track record + 1k+ users. Then:
- Seeking Alpha Premium: embed briefs as "third-party AI analysis." Revenue share, probably 30%.
- Stocktwits: integrate via their widget ecosystem.
- TradingView: custom indicator or "research" integration.

Outreach: LinkedIn DM to head of content at each. Don't cold-email execs.

#### (16) Wikipedia-adjacent reference play

- Publish *the* canonical reference page for "evidence-based investing" on clearpathinvest.app with citations to academic work
- Publish a methodology whitepaper as a PDF + HTML page
- Once it has 5+ external citations from reputable sites, pursue a Wikipedia article on "Multi-model consensus investing" or "Evidence-based stock research" (can't write it yourself, but can draft, then ask a Wikipedia editor friend to help). Takes 6–12 months.
- Parallel: claim your Google Knowledge Panel (g.page/r/[your-business]) — requires a Google Business Profile.

---

## Execution sequence

If Sang does everything in this doc plus what's already shipped, the order of operations is:

**Next 7 days:**
1. Deploy this branch (code's done)
2. Batch-submit to 25 directories (45 min, one afternoon)
3. Draft + schedule Show HN for following Tuesday
4. Seed 3 founder posts on X/LinkedIn using the topic list above

**Weeks 2–4:**
5. Send first newsletter sponsorship outreach (Daily Upside, $5k test)
6. Write first founder posts — aim for 2/week as baseline
7. Decide on weekly-brief automation scope (cost budget + cadence)

**Month 2:**
8. Build the weekly-brief automation (1-2 dev sessions)
9. Launch first podcast pitches (send to 8 shows, aim for 2 bookings)
10. First press outreach push (5 reporters, pitch + methodology)

**Month 3+:**
11. First quarterly report (State of AI Investing Q2 2026)
12. First open-source release (pick one from the list above)

---

## Success metrics — day 90

- **Organic traffic:** 5,000 monthly visitors from search (baseline: ~0 today)
- **Backlinks:** 50+ from DR>30 domains (directories + HN + podcasts + press + newsletter coverage)
- **Waitlist signups:** 500+ net new from visibility work
- **Press mentions:** 1+ meaningful (Bloomberg, WSJ, TechCrunch, or tier-1 fintech press)
- **Ticker pages indexed:** 40+ of the 46 seeded pages ranking for at least one long-tail query each

If we hit 3 of 5, the strategy's working. If we hit 5, it's a breakout.

---

## Files touched by this session

New:
- `src/app/alternatives/page.tsx`
- `src/app/embed/[ticker]/page.tsx`
- `src/app/embed/layout.tsx`
- `src/app/stocks/page.tsx`
- `src/app/stocks/[ticker]/page.tsx`
- `src/app/track-record/page.tsx`
- `src/app/research/page.tsx`
- `src/app/research/[slug]/page.tsx`
- `src/app/research/feed.xml/route.ts`
- `src/app/api/cron/weekly-bull-bear/route.ts`
- `src/lib/warehouse/public-dossier.ts`
- `src/lib/public-track-record.ts`
- `src/lib/public-brief.ts`
- `handoff/2026-04-24-marketing-visibility.md` (this file)

Modified:
- `src/app/sitemap.ts` — added all new routes + 46 ticker URLs + dynamic brief slugs; now async
- `src/app/robots.ts` — commented /embed noindex rationale
- `src/components/marketing/nav.tsx` — Weekly brief + Compare + How It Works + Pricing
- `src/components/marketing/footer.tsx` — added Compare, Stocks, Track record, Weekly brief
- `vercel.json` — added weekly-bull-bear cron (Mondays 10:00 UTC)

DB schema changes (applied via Neon MCP):
- Created `public_weekly_brief` table (17 columns) + 4 indexes. See spec at top of this handoff.

No new env vars. No breaking changes to existing schema. All net-additive.
