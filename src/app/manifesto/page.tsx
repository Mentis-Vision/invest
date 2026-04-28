import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";

export const metadata: Metadata = {
  title: "Manifesto — Investing should not be vibes",
  description:
    "Why single-AI answers are dangerous for real money. A manifesto on evidence-based stock research with three independent lenses, source citations, and honest confidence signals.",
  alternates: { canonical: "/manifesto" },
  openGraph: {
    title: "Manifesto: Investing should not be vibes",
    description:
      "Why one AI isn't enough for real-money decisions. The case for evidence-first stock research with traceable sources.",
    url: "/manifesto",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Manifesto: Investing should not be vibes",
    description:
      "Why one AI isn't enough for real-money decisions. The case for evidence-first stock research with traceable sources.",
  },
};

// Article JSON-LD — unlocks LLM citation + Google article rich results.
// XSS-safety: the dangerouslySetInnerHTML in the JSX below is safe —
// `articleLd` is a hard-coded server-side constant with no user input,
// no DB value, no query param. This is the Next.js-recommended pattern
// for JSON-LD injection, see https://nextjs.org/docs/app/guides/json-ld.
const articleLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Investing should not be vibes",
  description:
    "A manifesto on evidence-based stock research: why single-AI answers are dangerous for real money, and what a three-lens, traceable approach looks like instead.",
  author: { "@type": "Organization", name: "ClearPath Invest" },
  publisher: { "@type": "Organization", name: "ClearPath Invest" },
  datePublished: "2026-04-01",
  articleSection: "Manifesto",
  keywords:
    "evidence-based investing, AI stock research, three-lens analysis, investment research methodology",
} as const;

export default function Manifesto() {
  return (
    <div className="min-h-screen bg-background">
      {/* JSON-LD Article schema — see safety note above the constant. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <MarketingNav />

      <article className="mx-auto max-w-[680px] px-6 py-20">
        {/* Masthead */}
        <header className="mb-16 text-center">
          <div className="mb-4 flex items-center justify-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            <div className="h-px w-8 bg-border" />
            <span>Manifesto</span>
            <div className="h-px w-8 bg-border" />
          </div>
          <h1 className="font-heading text-[48px] leading-[1.05] tracking-tight md:text-[64px]">
            Investing should not
            <br />
            be <em className="italic text-[var(--buy)]">vibes</em>.
          </h1>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            By Sang · Founder, ClearPath Invest · April 2026
          </p>
        </header>

        {/* Dropcap lead */}
        <div className="space-y-7 text-[17px] leading-[1.75] text-foreground/90">
          <p className="first-letter:float-left first-letter:mr-3 first-letter:font-heading first-letter:text-[72px] first-letter:leading-[0.85] first-letter:text-[var(--buy)]">
            Ask a chatbot whether to sell your Nvidia, and it will answer with complete confidence. That answer will have been composed from training data frozen months ago, averaged across millions of internet opinions, delivered with the authority of a Wharton professor and the accuracy of a horoscope.
          </p>

          <p>
            This is not a technology problem. The models are extraordinary. The problem is how we&rsquo;ve been taught to use them — as oracles, not instruments. A single confident voice, ungrounded, untraceable, delivered with zero signal of its own uncertainty. For debating movie rankings, this is fine. For your retirement account, it is <em>dangerous</em>.
          </p>

          <h2 className="pt-8 font-heading text-[28px] leading-tight tracking-tight md:text-[32px]">
            We built ClearPath because the existing tools insult the question.
          </h2>

          <p>
            &ldquo;Should I sell NVDA?&rdquo; is not a trivia prompt. It&rsquo;s a question that deserves the 10-Q filed three weeks ago. The current yield curve. Today&rsquo;s actual price. What the Fed said in the last FOMC minutes. How the sector is valued relative to history. <em>Real data, in real time, from sources you can verify.</em>
          </p>

          <p>
            And it deserves more than one opinion. So we built three independent lenses — <em>Quality</em>, <em>Momentum</em>, <em>Context</em> — each applying its own discipline to the same verified evidence. Each lens is powered by a different frontier model (Claude, GPT, Gemini) so no single vendor&rsquo;s blind spots become yours. They analyze in isolation. Then a supervisor reviews all three, flags genuine disagreements, and verifies that every claim actually appears in the source data.
          </p>

          <p>
            The unpleasant truth about AI investing tools: most of them <em>hide</em> disagreement. They present smooth, confident consensus because it reads better. We do the opposite. If Quality says BUY and Momentum says SELL, you see it. That disagreement is information. It tells you the evidence is ambiguous, and that &ldquo;HOLD&rdquo; is probably the honest answer.
          </p>

          <h2 className="pt-8 font-heading text-[28px] leading-tight tracking-tight md:text-[32px]">
            The rules we wrote for ourselves.
          </h2>

          <div className="space-y-5 border-l-2 border-[var(--buy)] pl-6 text-[16px] italic text-foreground/80">
            <p>
              We will never cite a number that does not appear in the source data block.
            </p>
            <p>
              We will never hide model disagreement behind a smooth summary.
            </p>
            <p>
              We will always tell you what we would need to be more confident.
            </p>
            <p>
              We will always default to HOLD when the evidence is ambiguous.
            </p>
            <p>
              We will always link every claim back to its primary source.
            </p>
          </div>

          <h2 className="pt-8 font-heading text-[28px] leading-tight tracking-tight md:text-[32px]">
            What we are, and what we are not.
          </h2>

          <p>
            ClearPath is not a robo-advisor. We will not rebalance your portfolio while you sleep. ClearPath is not a brokerage. We will not execute your trades. ClearPath is not licensed to give you investment advice, and nothing we produce should be confused for it.
          </p>

          <p>
            What ClearPath <em>is</em>, is a research desk — the kind that used to live inside wealth management firms and sell-side banks, accessible only to people with seven-figure portfolios. We&rsquo;ve taken the structure of that discipline and made it accessible to individuals. Evidence-backed, triple-verified, honest about what it doesn&rsquo;t know.
          </p>

          <p>
            You still make the call. That part has never been automated, and it shouldn&rsquo;t be. We just make sure the brief on your desk is the best one available.
          </p>

          <p className="pt-4 font-heading text-[20px] italic text-[var(--buy)]">
            Investing should not be vibes.
            <br />
            It should be considered.
          </p>
        </div>

        {/* End rule */}
        <div className="mt-16 flex items-center justify-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          <div className="h-px w-12 bg-border" />
          <span>End</span>
          <div className="h-px w-12 bg-border" />
        </div>

        {/* CTA */}
        <div className="mt-20 rounded-xl border border-border bg-secondary/40 p-8 text-center">
          <h3 className="font-heading text-[26px] leading-tight tracking-tight">
            Try it on your own portfolio.
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Free 30-day trial. No credit card. Cancel anytime.
          </p>
          <div className="mx-auto mt-6 flex justify-center">
            <Link
              href="/sign-up?src=manifesto"
              className="inline-flex items-center justify-center rounded-md bg-foreground px-7 py-3 text-[15px] font-semibold text-background transition-all hover:bg-foreground/85"
            >
              Start your free trial
            </Link>
          </div>
        </div>
      </article>

      <MarketingFooter />
    </div>
  );
}
