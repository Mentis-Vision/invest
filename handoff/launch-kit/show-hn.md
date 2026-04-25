# Show HN — ClearPath Invest

Ready-to-paste Hacker News submission.

---

## When to post

**Best windows** (Pacific time has lowest competition):
- **Tuesday** 6:00–8:00 AM PT (9–11 AM ET) — best overall
- **Wednesday** 6:00–8:00 AM PT
- **Thursday** 6:00–8:00 AM PT

**Avoid:** weekends (low engagement), Mondays (everyone's catching up), Fridays (drops off the news cycle by 5pm).

**Pre-launch checklist:**
- [ ] At least 2–3 weekly briefs visible at `/research` (so visitors don't see "priming")
- [ ] `/track-record` page renders cleanly (with or without data — placeholder is OK)
- [ ] At least one ticker page (`/stocks/NVDA`) renders a real dossier
- [ ] Be at your laptop for the 4 hours after posting (first hour determines ranking)
- [ ] Don't share to X/LinkedIn until it's stable on the front page (premature sharing causes downvote spiral)

---

## Title (pick one)

Headline weight is on the **noun**, then the **mechanism**. Avoid clickbait — HN audience is allergic.

**Strongest:**
> Show HN: ClearPath – stock research where every claim cites its source

**Alternates** (good if title above is gamed by similar):
> Show HN: Three-AI consensus stock research that defaults to HOLD when models disagree

> Show HN: Evidence-based stock research with multi-model consensus and traceable claims

---

## Body (paste verbatim, edit only marked spots)

```
Hi HN,

I've been working on ClearPath Invest — evidence-based stock research for
retail investors who don't want an advisor but do want rigor.

The problem: ask ChatGPT about a stock and you get a confident answer
averaged from training data frozen months ago. There's no source, no
indication when the model doesn't know, and no way to tell whether the
answer is any good. For real-money decisions this is dangerous.

The approach:

1. Pull live data: SEC 10-Q/10-K filings, Federal Reserve indicators,
   real-time market prices, BLS employment data. 12+ primary sources,
   nothing cached, nothing summarized.

2. Run the same evidence through three independent "lenses" in parallel:
   Quality (fundamentals), Momentum (price action), Context (macro/sector).
   Each lens is backed by a different frontier model (Claude, GPT, Gemini)
   so no single vendor's blind spots become yours.

3. A supervisor cross-checks every factual claim against the source data
   block. Unverifiable claims are flagged and stripped — not smoothed
   into the final brief.

4. Consensus strength sets confidence. Unanimous → HIGH. Majority (2/3)
   → downgraded one level. Split → defaults to HOLD with LOW confidence.
   Any model returning INSUFFICIENT_DATA triggers an honest escalation
   that tells you what would be needed for a more confident call.

5. Output is a structured brief: verdict, confidence, signals (each
   citing a data point), explicit risks, and the model disagreements
   surfaced — not hidden.

Three things I think are interesting:

- Zero-hallucination prompt design. Every claim a model emits must cite
  a line from the DATA block or the supervisor strips it. The prompt is
  enforcement-first, not guidance-first. ~23% of model claims got
  rejected in the last week.

- The default-to-HOLD rule. When Quality says BUY and Momentum says SELL,
  most tools smooth this into wishy-washy summary copy. We surface the
  disagreement and default to HOLD with LOW confidence.

- Public weekly briefs at /research with bull and bear cases on a
  high-interest ticker (this Monday is NVDA — BUY at LOW confidence,
  SPLIT consensus). Outcome retrospectives published at 7d/30d/90d/365d.
  We publish misses, not just wins. RSS feed at /research/feed.xml.

Live at https://clearpathinvest.app. Private beta. Would love feedback,
especially from anyone who's built or operated multi-agent research
pipelines or thought hard about hallucination detection in finance.

Not investment advice.

— Sang
```

**Edit-before-posting checklist:**
- [ ] Update the "23% of model claims got rejected" stat to a real number from your dashboard, OR delete that bullet if you don't have it ready
- [ ] Update "this Monday is NVDA" to whatever the current week's brief actually is (check /research index)
- [ ] Confirm the bull case + verdict numbers in the post still match what's live

---

## URL field

```
https://clearpathinvest.app
```

Do **not** link directly to /research/[slug] or /pricing. The landing page sells the product better and HN gives you 2-3x more clicks when the URL is the homepage.

---

## First-hour playbook

The first 60 minutes determine whether you hit the front page or die in /newest.

**Within 5 min of posting:**
- Reload your own submission once to check it's live
- Open the comments section in a separate tab — be ready to respond

**First hour:**
- Respond to the first 3-5 comments within 10 minutes each. Speed matters.
- Engage with technical questions in depth. Brush off snark.
- Do **not** upvote yourself or ask friends to upvote (HN detects this and shadowbans)
- Do **not** post the link to X/LinkedIn yet — premature external traffic without HN-internal upvotes triggers their anti-promotion heuristic

**If you hit the front page (any rank top 30):**
- Now share to X with a screenshot of the discussion
- Pin the tweet
- Post to LinkedIn with the same screenshot
- Have a teammate (if you have one) be ready to also engage in the comments

**If you stall in /newest after 30 min:**
- Don't repost. HN treats reposts harshly.
- Wait 7+ days, refine the title, re-post with `Show HN: [different angle]`

---

## Likely critic questions (rehearse answers)

| Comment / question | Best response |
|---|---|
| "How is this different from ChatGPT-with-search?" | "ChatGPT runs one model and synthesizes one answer. We run three model families in parallel against the SAME verified data block, surface disagreements, and reject any claim that doesn't trace to a source. The supervisor stripped 23% of model claims last week — that's the audit trail you don't get from a single chatbot." |
| "Aren't you just charging for what's free?" | "The data sources are free (SEC EDGAR, FRED, Yahoo). We're charging for the multi-model consensus, the claim verification, and the structured brief. Free tier shows you exactly what we do." |
| "What's your hit rate?" | Link to `/track-record`. If empty, say "First 30-day outcomes resolve in May. Both wins and losses are published." Don't fudge a number. |
| "Why three AI models? Isn't that just expensive?" | "$0.10–0.30 per brief at the depth of analysis we do. Cheaper than one human analyst-hour and the disagreement signal is the whole point — single-model confidence is what gets retail investors hurt." |
| "This is just investment advice with extra steps" | "We never produce a personalized recommendation. Everything is informational research. We don't execute trades, we don't manage portfolios, we don't have a fiduciary relationship. The disclaimer is on every surface." |
| "How do I know the models aren't gaming the verification step?" | "The supervisor model is from a different provider than the analysts being verified. The verification step has access to the raw DATA block but is blind to the analyst's chain-of-thought. And critically — the prompt enforces 'reject if you can't find this claim in the DATA block,' not 'judge if it sounds right.'" |
| "How do you handle SEC compliance?" | "Informational tool, not investment advice. No personalized recommendations. No execution. Same compliance posture as Seeking Alpha or Morningstar's free tier. Every surface displays the informational-only disclaimer required by Rule 206(4)-1 considerations." |

---

## After it dies down

Even a stalled HN post is worth ~50–100 high-quality visitors and 2–5 backlinks. Track:

- New waitlist signups (UTM `?utm_source=hn` if you want; HN respects it)
- New backlinks (via Ahrefs / SimilarWeb on next refresh)
- Direct DMs / emails to hello@clearpathinvest.app

Document the post URL in `handoff/2026-04-24-marketing-visibility.md` for future-Sang.
