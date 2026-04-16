import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import WaitlistForm from "@/components/marketing/waitlist-form";
import { Database, LineChart, Scale, FileText, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";

export const metadata = {
  title: "How It Works · ClearPath Invest",
  description: "The five-stage research pipeline: ingest, analyze, verify, supervise, deliver.",
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
    lead: "Three reasoning engines. Same evidence. Independent analysis.",
    body: "The gathered data is sent — in parallel — to three distinct reasoning engines: Claude, GPT, and Gemini. Each works in isolation. Each produces a structured analysis: recommendation, confidence level, supporting signals with cited data points, and explicit risk factors. No chain-of-thought contamination between models.",
    emphasis: "3 independent perspectives",
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
    body: "Unanimous across all three models with verified data → HIGH confidence. Majority (2 of 3) → downgraded one level. Split decision → defaults to HOLD with LOW confidence. Any model returning INSUFFICIENT_DATA triggers an honest escalation: we tell you what we need to produce a more confident call.",
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
    body: "If Claude says BUY but GPT says SELL, that disagreement shows up in your brief. Other tools hide it. We surface it.",
  },
];

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-background">
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
