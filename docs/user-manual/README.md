# ClearPath Invest — User Manual

**Working draft** · Last updated 2026-04-17

This manual documents every feature, surface, and data source currently live in ClearPath Invest. It exists for two reasons:

1. A place to keep a running record of every capability as we ship it, so the eventual public user-facing manual has a source of truth.
2. A hand-off document for anyone joining the project — you should be able to read this end to end and understand everything the app does.

The intent is living documentation, not polished marketing copy. Each
section should be kept factually current with what's actually deployed.
When a feature changes, the doc changes.

## Structure

```
docs/user-manual/
├── README.md              ← this file (index + conventions)
├── 00-brand.md            ← logo, colors, typography, voice rules
├── 01-getting-started.md  ← account creation, first connection, first look
├── 02-overview.md         ← the /app dashboard (portfolio hero, KPIs, alerts, news)
├── 03-portfolio.md        ← /app?view=portfolio (holdings table, allocation)
├── 04-research.md         ← /app?view=research (quick read, deep read, cards)
├── 05-strategy.md         ← /app?view=strategy (overnight portfolio review)
├── 06-account.md          ← /app?view=integrations (linked accounts, data sources)
├── 07-history.md          ← /app/history (past recommendations, track record)
├── 08-settings.md         ← /app/settings (profile, preferences)
├── 09-data-sources.md     ← all 10+ sources we pull from, what each gives us
├── 10-how-ai-works.md     ← the three-lens panel, caching, cost transparency
├── 11-privacy.md          ← the privacy boundary, what we store, what we don't
├── 12-faqs.md             ← frequent questions with answers
└── changelog.md           ← what shipped when
```

## Voice conventions

- **No tech jargon in user-facing content.** No "tokens", no "model",
  no "cron", no "AI SDK". Users see "refreshed overnight" and
  "research read", not "the nightly job runs generateObject."
- **Plain English over jargon, always.** "Bought early, sold late"
  over "entry/exit price deltas."
- **Show the math when it matters.** "Concentration >25% flagged"
  beats "risk threshold exceeded."
- **Legal disclosures are inviolate.** The disclaimer modal, track-
  record footer, and AI-involvement notice in the marketing footer
  all have specific language required for informational-only
  positioning. Don't soften those.

## Publishing path (future)

When we're ready for a public manual, the intent is to compile these
into a marketing-site docs section (separate route under
`clearpathinvest.app/docs` or similar). Until then, this is internal.

See `changelog.md` for the shipping history by date.
