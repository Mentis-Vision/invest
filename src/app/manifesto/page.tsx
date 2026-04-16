import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import WaitlistForm from "@/components/marketing/waitlist-form";

export const metadata = {
  title: "Manifesto · ClearPath Invest",
  description: "Why single-AI answers are dangerous for real money.",
};

export default function Manifesto() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      <article className="mx-auto max-w-[680px] px-6 py-20">
        {/* Masthead */}
        <header className="mb-16 text-center">
          <div className="mb-4 flex items-center justify-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            <div className="h-px w-8 bg-border" />
            <span>Manifesto · No. 01</span>
            <div className="h-px w-8 bg-border" />
          </div>
          <h1 className="font-heading text-[48px] leading-[1.05] tracking-tight md:text-[64px]">
            Investing should not
            <br />
            be <em className="italic text-[var(--buy)]">vibes</em>.
          </h1>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            By the ClearPath Team · 2026
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
            And it deserves more than one opinion. A single model — no matter how capable — has blind spots it doesn&rsquo;t know about. So we send the same evidence to three. Claude. GPT. Gemini. They analyze independently. Then a supervisor reviews all three, flags genuine disagreements, and verifies that every claim actually appears in the source data.
          </p>

          <p>
            The unpleasant truth about AI investing tools: most of them <em>hide</em> disagreement. They present smooth, confident consensus because it reads better. We do the opposite. If Claude says BUY and GPT says SELL, you see it. That disagreement is information. It tells you the evidence is ambiguous, and that &ldquo;HOLD&rdquo; is probably the honest answer.
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
            Join the private beta.
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Access opens in waves. No spam.
          </p>
          <div className="mx-auto mt-6 max-w-md">
            <WaitlistForm source="manifesto" />
          </div>
        </div>
      </article>

      <MarketingFooter />
    </div>
  );
}
