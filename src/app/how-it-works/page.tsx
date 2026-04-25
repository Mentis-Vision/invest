import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import WaitlistForm from "@/components/marketing/waitlist-form";
import { Database, LineChart, Scale, FileText, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "How ClearPath Invest turns live SEC, Federal Reserve, and market data into a traceable stock-research brief — in five stages, across three investment lenses.",
  alternates: { canonical: "/how-it-works" },
  openGraph: {
    title: "How ClearPath's research pipeline works",
    description:
      "Five stages, three lenses, zero unverified claims. Live SEC + Fed data through Quality, Momentum, and Context analysis.",
    url: "/how-it-works",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "How ClearPath's research pipeline works",
    description:
      "Five stages, three lenses, zero unverified claims. Live SEC + Fed data through Quality, Momentum, and Context analysis.",
  },
};

const stages = [
  {
    n: "01",
    title: "Ingest",
    icon: Database,
    lead: "Real data. Not training data.",
    body: "When you ask about a ticker, we don’t query some cached summary. We pull it live: the most recent 10-Q from SEC EDGAR, today’s Treasury yields from FRED, real-time prices from multiple market feeds, the latest employment and inflation prints from BLS, and nine other authoritative sources. Everything fresh. Everything traceable.",
    emphasis: "12+ primary sources per query",
  },
  {
    n: "02",
    title: "Analyze",
    icon: LineChart,
    lead: "Three lenses. Same evidence. Independent analysis.",
    body: "The gathered data is examined in parallel by three investment lenses — Quality, Momentum, and Context. Each applies its own discipline: fundamentals and competitive position (Quality), price action and sentiment (Momentum), and macro/sector context (Context). Under the hood, each lens is backed by a frontier model (Claude, GPT, Gemini) so no single vendor's blind spot becomes yours. Each lens produces a structured analysis: recommendation, confidence, signals with cited data, and explicit risks.",
    emphasis: "3 independent lenses · 3 model families",
  },
  {
    n: "03",
    title: "Verify",
    icon: Scale,
    lead: "Every claim, cross-checked against the source data.",
    body: "A supervisor reviews all three analyses. It compares conclusions and flags genuine disagreements. Then it verifies every factual claim actually appears in the source data block. Any claim that can’t be verified is flagged as a red flag — and the overall confidence is downgraded accordingly.",
    emphasis: "Zero unverified claims",
  },
  {
    n: "04",
    title: "Calibrate",
    icon: ShieldCheck,
    lead: "Consensus strength determines confidence.",
    body: "Unanimous across all three lenses with verified data → HIGH confidence. Majority (2 of 3) → downgraded one level. Split decision → defaults to HOLD with LOW confidence. Any lens returning INSUFFICIENT_DATA triggers an honest escalation: we tell you what we'd need to produce a more confident call.",
    emphasis: "Honest confidence calibration",
  },
  {
    n: "05",
    title: "Deliver",
    icon: FileText,
    lead: "A brief you can act on. Or show your advisor.",
    body: "The final output isn’t a paragraph of hedged copy. It’s a structured brief: the recommendation, the consensus strength, the agreed-upon signals, any disagreements between models, any red-flagged claims, and a plain-language summary. Every data point links back to its source.",
    emphasis: "Transparent, traceable, decisive",
  },
];

const guarantees = [
  {
    icon: CheckCircle2,
    title: "Every number cited traces to a source",
    body: "If a figure appears in an analysis, you can click through to exactly where it came from — SEC document, Fed series, or market feed.",
  },
  {
    icon: AlertTriangle,
    title: "We tell you when we don’t know",
    body: "If the data is sparse or the models disagree, you see a LOW-confidence HOLD with an explicit list of what we’d need to be more certain — not a confident guess.",
  },
  {
    icon: ShieldCheck,
    title: "You see disagreement, not hidden consensus",
    body: "If the Quality lens says BUY but Momentum says SELL, that disagreement shows up in your brief. Other tools hide it. We surface it.",
  },
];

// HowTo JSON-LD — describes the five-stage research pipeline.
// XSS-safety: the use of dangerouslySetInnerHTML below is safe because
// `howToLd` is a hard-coded server-side constant (derived from the
// `stages` array above, which is also a server-side constant). There is
// no user input, no DB value, no query param anywhere in this payload.
// This is the Next.js-recommended pattern for JSON-LD injection, see
// https://nextjs.org/docs/app/guides/json-ld.
const howToLd = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How ClearPath Invest's five-stage research pipeline works",
  description:
    "From a ticker to a traceable research brief: ingest live data, analyze across three investment lenses, verify every claim, calibrate confidence, and deliver a structured brief.",
  totalTime: "PT1M",
  step: stages.map((s, i) => ({
    "@type": "HowToStep",
    position: i + 1,
    name: s.title,
    text: s.body,
  })),
} as const;

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-background">
      {/* JSON-LD structured data — see safety note above. Enables HowTo
          rich results on Google and AI-citation surfaces. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToLd) }}
      />
      <MarketingNav />

      {/* Header */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            How It Works
          </div>
          <h1 className="font-heading text-[52px] leading-[1.05] tracking-tight md:text-[68px]">
            A five-stage <em className="italic text-[var(--buy)]">research pipeline</em>.
          </h1>
          <p className="mx-auto mt-6 max-w-[620px] text-[17px] leading-relaxed text-muted-foreground">
            From raw data to verified recommendation in under a minute. Every stage designed for one thing: eliminating confident-but-wrong answers.
          </p>
        </div>
      </section>

      {/* Stages */}
      <section className="py-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="space-y-20">
            {stages.map((s, idx) => {
              const Icon = s.icon;
              return (
                <div key={s.n} className="relative">
                  {idx < stages.length - 1 && (
                    <div className="absolute left-8 top-16 bottom-[-5rem] w-px bg-border md:left-10" />
                  )}
                  <div className="relative flex gap-6 md:gap-10">
                    <div className="flex-shrink-0">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card md:h-20 md:w-20">
                        <Icon className="h-6 w-6 text-[var(--buy)]" strokeWidth={1.5} />
                      </div>
                    </div>
                    <div className="flex-1 pt-1">
                      <div className="mb-2 flex items-center gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--buy)]">
                          Stage {s.n}
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                      <h2 className="font-heading text-[32px] leading-tight tracking-tight md:text-[40px]">
                        {s.title}
                      </h2>
                      <p className="mt-2 font-heading text-[18px] italic text-[var(--buy)] md:text-[20px]">
                        {s.lead}
                      </p>
                      <p className="mt-4 text-[16px] leading-relaxed text-foreground/85">
                        {s.body}
                      </p>
                      <div className="mt-5 inline-block rounded-md border border-border bg-secondary/50 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                        {s.emphasis}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Example brief — shows the actual structured output Stage 05
          describes. Before this section was added, the page talked about
          a "brief" without ever rendering one. Clearly labeled as an
          illustrative example + informational-only, per legal guardrails. */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="mb-10 text-center">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              Example output
            </div>
            <h2 className="font-heading text-[36px] leading-tight tracking-tight md:text-[46px]">
              What a <em className="italic text-[var(--buy)]">brief</em> looks like.
            </h2>
            <p className="mx-auto mt-3 max-w-[560px] text-[15px] leading-relaxed text-muted-foreground">
              Five-stage pipeline, rendered as a single structured document —
              verdict, consensus strength, the three lenses&rsquo; signals,
              disagreements, and every claim citing its source.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_0_0_rgba(0,0,0,0.03),0_24px_48px_-24px_rgba(26,26,30,0.12)]">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-y-1 border-b border-border/70 bg-secondary/30 px-6 py-3">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <span>AAPL</span>
                <span className="text-foreground/20">·</span>
                <span>Example brief</span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--buy)]">
                <ShieldCheck className="h-3 w-3" />
                Verified · 12 sources
              </div>
            </div>

            {/* Verdict */}
            <div className="border-b border-border px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Apple Inc.
                  </div>
                  <div className="mt-0.5 font-mono text-sm text-foreground">
                    $187.44 <span className="text-[var(--sell)]">−0.6%</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-md border border-[var(--buy)]/25 bg-[var(--buy)]/10 px-3 py-1 text-sm font-semibold text-[var(--buy)]">
                    BUY
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    MEDIUM confidence · 2 of 3 lenses agree
                  </span>
                </div>
              </div>
            </div>

            {/* Three lenses */}
            <div className="divide-y divide-border border-b border-border md:grid md:grid-cols-3 md:divide-x md:divide-y-0">
              {[
                {
                  lens: "Quality",
                  call: "BUY",
                  tone: "buy" as const,
                  signal:
                    "Services revenue +16% YoY (10-Q, Q2 FY26); operating margin 31.5%, sector median 14.8%.",
                },
                {
                  lens: "Momentum",
                  call: "BUY",
                  tone: "buy" as const,
                  signal:
                    "50d MA above 200d MA; RSI 58 (neutral-bullish); 20-day volume +12% vs 90-day avg.",
                },
                {
                  lens: "Context",
                  call: "HOLD",
                  tone: "hold" as const,
                  signal:
                    "Fed funds 5.33% compresses mega-cap multiples; China revenue −9% (10-Q); supply-chain headlines elevated.",
                },
              ].map((row) => (
                <div key={row.lens} className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                      {row.lens}
                    </div>
                    <span
                      className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${
                        row.tone === "buy"
                          ? "bg-[var(--buy)]/10 text-[var(--buy)]"
                          : "bg-[var(--hold)]/10 text-[var(--hold)]"
                      }`}
                    >
                      {row.call}
                    </span>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-foreground/85">
                    {row.signal}
                  </p>
                </div>
              ))}
            </div>

            {/* Disagreement + summary */}
            <div className="space-y-3 px-6 py-5 text-[14px] leading-relaxed text-foreground/85">
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Where the lenses disagree
                </div>
                <p>
                  Quality and Momentum support a BUY on fundamentals and
                  trend. Context flags macro headwinds (rates, China) that
                  could compress multiples on a 3–6 month horizon.
                </p>
              </div>
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Summary
                </div>
                <p>
                  A BUY call, but downgraded to MEDIUM confidence because the
                  three lenses split 2-to-1. Entry under $180 preferred. Re-
                  evaluate after next FOMC or the FY26 Q3 print, whichever
                  comes first.
                </p>
              </div>
            </div>

            {/* Footer / disclaimer */}
            <div className="border-t border-border bg-secondary/20 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
              Illustrative example · Informational only · Not investment advice
            </div>
          </div>
        </div>
      </section>

      {/* Guarantees */}
      <section className="border-t border-border bg-secondary/30 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-12 text-center">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              Our commitments
            </div>
            <h2 className="font-heading text-[36px] leading-tight tracking-tight md:text-[46px]">
              What we will <em className="italic text-[var(--buy)]">never</em> do.
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {guarantees.map((g) => {
              const Icon = g.icon;
              return (
                <div
                  key={g.title}
                  className="rounded-xl border border-border bg-card p-6"
                >
                  <Icon className="mb-4 h-5 w-5 text-[var(--buy)]" strokeWidth={1.5} />
                  <h3 className="font-heading text-[18px] leading-tight">{g.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
                    {g.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="font-heading text-[36px] leading-tight tracking-tight md:text-[46px]">
            See it in action.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Request access to the private beta.
          </p>
          <div className="mx-auto mt-8 max-w-md">
            <WaitlistForm source="how-it-works" />
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
