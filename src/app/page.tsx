import Link from "next/link";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import WaitlistForm from "@/components/marketing/waitlist-form";
import { Check, ArrowUpRight, Database, FileText, LineChart, ShieldCheck, Scale } from "lucide-react";

const dataSources = [
  { name: "SEC EDGAR", sub: "10-K / 10-Q / 8-K filings" },
  { name: "FRED", sub: "Federal Reserve Economic Data" },
  { name: "US Treasury", sub: "Yield curves, auctions, debt" },
  { name: "Yahoo Finance", sub: "Real-time price & fundamentals" },
  { name: "BLS", sub: "Employment, CPI, wage data" },
  { name: "CBO", sub: "Fiscal & deficit projections" },
  { name: "FDIC", sub: "Banking sector health" },
  { name: "Alpha Vantage", sub: "Technicals & earnings" },
  { name: "World Bank", sub: "Global dev indicators" },
  { name: "Census Bureau", sub: "Housing, consumer spending" },
  { name: "Finnhub", sub: "Quotes, news, ESG" },
  { name: "Morningstar", sub: "Fund & ETF fundamentals" },
];

const otherToolsCons = [
  "Answers pulled from stale training data",
  "Single model, confident opinion",
  "No citations, no traceability",
  "Overfit to bull markets",
  "Can’t tell you when it doesn’t know",
];

const clearPathPros = [
  "Live data from 12+ authoritative sources",
  "Three independent reasoning engines cross-check each other",
  "Every number traces to a primary source",
  "Bias toward HOLD when evidence is ambiguous",
  "Tells you exactly what it needs to be more confident",
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage: `
              radial-gradient(circle at 15% 20%, rgba(45, 95, 63, 0.05) 0%, transparent 50%),
              radial-gradient(circle at 85% 80%, rgba(181, 79, 42, 0.04) 0%, transparent 55%)
            `,
          }}
        />

        <div className="relative mx-auto max-w-5xl px-6 pt-20 pb-28 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--buy)]" />
            Private beta · Issue 01
          </div>

          <h1 className="font-heading text-[56px] leading-[1.02] tracking-tight text-foreground sm:text-[72px] md:text-[88px]">
            Know what to do
            <br />
            with <em className="italic text-[var(--buy)]">your money.</em>
          </h1>

          <p className="mx-auto mt-6 max-w-[620px] text-[17px] leading-relaxed text-muted-foreground md:text-[18px]">
            Every recommendation begins with real data — <span className="text-foreground">SEC filings, Federal Reserve indicators, live market prices</span> — then runs through rigorous, triple-verified analysis. Every claim traces to a source.
          </p>

          <div id="access" className="mx-auto mt-10 max-w-md">
            <WaitlistForm source="landing-hero" />
            <p className="mt-3 text-[12px] text-muted-foreground/70">
              No spam. Just one email when access opens.
            </p>
          </div>
        </div>

        {/* Mock verdict card preview */}
        <div className="relative mx-auto max-w-3xl px-6 pb-16">
          <div className="rounded-xl border border-border bg-card shadow-[0_1px_0_0_rgba(0,0,0,0.03),0_24px_48px_-24px_rgba(26,26,30,0.15)]">
            <div className="flex items-center justify-between border-b border-border/70 px-6 py-3">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <span>NVDA</span>
                <span className="text-foreground/20">·</span>
                <span>Analysis</span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--buy)]">
                <ShieldCheck className="h-3 w-3" />
                Verified · 12 sources
              </div>
            </div>
            <div className="px-6 py-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">NVIDIA Corp</div>
                  <div className="mt-0.5 font-mono text-sm text-foreground">
                    $486.92 <span className="text-[var(--buy)]">+1.2%</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-md border border-[var(--hold)]/25 bg-[var(--hold)]/10 px-3 py-1 text-sm font-semibold text-[var(--hold)]">
                    HOLD
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    HIGH confidence · Unanimous
                  </span>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-foreground/85">
                Valuation elevated (forward P/E 38.2 vs sector 24.1) offsets strong revenue growth (122% YoY per latest 10-Q). With Fed funds at 5.33% and the 10Y at 4.38%, risk-asset multiples face compression. Wait for entry below $420 or for next earnings print.
              </p>
              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-[11px] font-mono">
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-[var(--buy)]" />
                  <span className="text-muted-foreground">Claude: HOLD</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-[var(--buy)]" />
                  <span className="text-muted-foreground">GPT: HOLD</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-[var(--buy)]" />
                  <span className="text-muted-foreground">Gemini: HOLD</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MANIFESTO STRIP */}
      <section className="border-y border-border bg-secondary/30 py-16">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="font-heading text-[32px] leading-[1.15] tracking-tight text-foreground md:text-[40px]">
            Most investing tools give you <em className="italic text-muted-foreground">opinions</em>.
            <br />
            ClearPath gives you <em className="italic text-[var(--buy)]">evidence</em>.
          </h2>
        </div>
      </section>

      {/* HOW */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14 text-center">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              The Process
            </div>
            <h2 className="font-heading text-[40px] leading-[1.1] tracking-tight md:text-[52px]">
              A <em className="italic text-[var(--buy)]">research desk</em> for your portfolio.
            </h2>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {[
              { n: "01", icon: Database, title: "Ingest", body: "Pull live data from 12+ authoritative sources — SEC filings, Fed indicators, real prices. Nothing cached, nothing summarized." },
              { n: "02", icon: LineChart, title: "Analyze", body: "Three independent reasoning engines examine the same evidence in parallel. No single model, no single viewpoint." },
              { n: "03", icon: Scale, title: "Verify", body: "A supervisor cross-checks every claim against the source data. Unverifiable claims are flagged and stripped." },
              { n: "04", icon: FileText, title: "Deliver", body: "A clear recommendation — BUY, HOLD, or SELL — with every supporting number traceable to its source." },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.n} className="relative">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--buy)]">
                      Step {s.n}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <Icon className="mb-4 h-5 w-5 text-[var(--buy)]" strokeWidth={1.5} />
                  <h3 className="font-heading text-[22px] leading-tight">{s.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-14 text-center">
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline decoration-[var(--buy)] decoration-2 underline-offset-[6px] transition-colors hover:text-[var(--buy)]"
            >
              Read the full process
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* DATA SOURCES */}
      <section className="border-y border-border bg-secondary/30 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
                Data Sources
              </div>
              <h2 className="font-heading text-[36px] leading-[1.1] tracking-tight md:text-[46px]">
                We read the filings.
                <br />
                We <em className="italic text-[var(--buy)]">verify</em> the numbers.
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              Every recommendation references primary sources. No black-box AI training data. No hedge-fund hearsay.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {dataSources.map((s) => (
              <div
                key={s.name}
                className="group rounded-md border border-border bg-card px-4 py-3.5 transition-colors hover:border-foreground/25"
              >
                <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-foreground">
                  {s.name}
                </div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COUNTER-POSITIONING */}
      <section className="py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-12 text-center">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              What ClearPath is <span className="text-[var(--sell)]">not</span>
            </div>
            <h2 className="font-heading text-[36px] leading-[1.1] tracking-tight md:text-[46px]">
              The honest comparison.
            </h2>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="p-6 md:p-8">
                <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  Other AI investing tools
                </div>
                <ul className="space-y-3 text-sm">
                  {otherToolsCons.map((t) => (
                    <li key={t} className="flex items-start gap-2 text-muted-foreground">
                      <span className="mt-0.5 text-[var(--sell)]">✗</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-[var(--buy)]/[0.03] p-6 md:p-8">
                <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--buy)]">
                  ClearPath
                </div>
                <ul className="space-y-3 text-sm">
                  {clearPathPros.map((t) => (
                    <li key={t} className="flex items-start gap-2 text-foreground/90">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--buy)]" strokeWidth={2.5} />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative overflow-hidden border-t border-border bg-secondary/30 py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-heading text-[42px] leading-[1.05] tracking-tight md:text-[56px]">
            Ready for
            <br />
            <em className="italic text-[var(--buy)]">considered</em> decisions?
          </h2>
          <p className="mx-auto mt-5 max-w-[480px] text-[16px] leading-relaxed text-muted-foreground">
            Join the private beta. We&rsquo;re onboarding investors who want evidence, not vibes.
          </p>
          <div className="mx-auto mt-8 max-w-md">
            <WaitlistForm source="landing-cta" />
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
