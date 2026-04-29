import Link from "next/link";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import DemoVerdict from "@/components/marketing/demo-verdict";
import { Check, ArrowUpRight, Database, FileText, LineChart, Scale, Landmark } from "lucide-react";

// Landing-page JSON-LD: SoftwareApplication + ItemList of data sources.
// XSS-safe — all content is server-side static constants (see note in
// root layout).
const softwareAppLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "ClearPath Invest",
  applicationCategory: "FinanceApplication",
  applicationSubCategory: "Investment Research",
  operatingSystem: "Web",
  description:
    "Evidence-based stock research for retail investors. Three independent lenses — Quality, Momentum, Context — examine live SEC, Federal Reserve, and market data. Every claim traces to a primary source.",
  offers: [
    { "@type": "Offer", name: "Free 30-day trial", price: "0", priceCurrency: "USD" },
    { "@type": "Offer", name: "Individual", price: "29", priceCurrency: "USD" },
    { "@type": "Offer", name: "Active", price: "79", priceCurrency: "USD" },
    { "@type": "Offer", name: "Advisor", price: "500", priceCurrency: "USD" },
  ],
  featureList: [
    "Live data from 12+ authoritative sources (SEC EDGAR, FRED, Yahoo Finance, BLS, CBO, FDIC, and more)",
    "Three investment lenses — Quality, Momentum, Context — cross-examine the same verified evidence",
    "Every number traces to a primary source",
    "Honest confidence calibration: HOLD by default when evidence is ambiguous",
    "Transparent model disagreement surfaced, never hidden",
  ],
} as const;

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
  "Three investment lenses — Quality, Momentum, Context — cross-examine the same evidence",
  "Every number traces to a primary source",
  "Bias toward HOLD when evidence is ambiguous",
  "Tells you exactly what it needs to be more confident",
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* JSON-LD structured data. The dangerouslySetInnerHTML below is
          XSS-safe: `softwareAppLd` is a hard-coded server-side constant
          (no user input, no DB value, no query param). This is the
          Next.js-recommended pattern for JSON-LD — see
          https://nextjs.org/docs/app/guides/json-ld. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppLd) }}
      />
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
            Early access · Free 30-day trial
          </div>

          <h1 className="font-heading text-[56px] leading-[1.02] tracking-tight text-foreground sm:text-[72px] md:text-[88px]">
            Stock research.
            <br />
            Every claim <em className="italic text-[var(--buy)]">sourced.</em>
          </h1>

          <p className="mx-auto mt-6 max-w-[620px] text-[17px] leading-relaxed text-muted-foreground md:text-[18px]">
            Evidence-based equity research for retail investors. Three independent lenses — <span className="text-foreground">Quality, Momentum, Context</span> — examine live data from SEC filings, the Federal Reserve, and market feeds. Every number traces to a primary source.
          </p>

          {/* Direct sign-up CTA — replaces the prior waitlist form. The
              30-day full-feature trial is no-card-required, so the
              friction is just an email + password. */}
          <div id="access" className="mx-auto mt-10 flex flex-col items-center gap-3">
            <Link
              href="/sign-up?src=landing-hero"
              className="inline-flex items-center justify-center rounded-md bg-foreground px-7 py-3 text-[15px] font-semibold text-background transition-all hover:bg-foreground/85"
            >
              Start your free 30-day trial
            </Link>
            <p className="text-[12px] text-muted-foreground/70">
              No credit card. Cancel anytime.
            </p>
          </div>
        </div>

        {/* Interactive verdict demo — replaces the prior static NVDA
            mock. Visitors can swap between four sample tickers (NVDA,
            TSLA, AAPL, NFLX); the TSLA case deliberately shows lens
            disagreement so visitors see what the three-lens
            differentiator actually changes. Component is client-side
            with hardcoded data — zero backend cost. */}
        <DemoVerdict />

        {/* Brokerage social proof — names the brokers we've actually
            verified as working today (Schwab + Coinbase user-tested),
            plus a hedge for the rest of the supported list. Update
            this once the brokerage spot-check completes — see
            handoff/brokerage-verification.md. */}
        <div className="relative mx-auto max-w-3xl px-6 pb-20 text-center">
          <div className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <Landmark className="h-3.5 w-3.5 text-[var(--buy)]" />
            <span>Connects to your brokerage:</span>
            <span className="text-foreground/85">Schwab</span>
            <span className="text-foreground/20">·</span>
            <span className="text-foreground/85">Fidelity</span>
            <span className="text-foreground/20">·</span>
            <span className="text-foreground/85">Robinhood</span>
            <span className="text-foreground/20">·</span>
            <span className="text-foreground/85">Vanguard</span>
            <span className="text-foreground/20">·</span>
            <span className="text-foreground/85">Coinbase</span>
            <span className="text-foreground/20">·</span>
            <span>+ 25 more</span>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground/70">
            Read-only sync via Plaid + SnapTrade. We never execute trades.
          </p>
        </div>
      </section>

      {/* Trust amplifier strip — echoes the auth-footer copy
          ("three lenses, one verdict · cited to primary sources")
          so the trust language is consistent across surfaces. */}
      <section className="border-y border-border bg-secondary/40 py-10">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 text-center md:grid-cols-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Mechanism
            </div>
            <div className="mt-2 font-heading text-[20px] leading-snug">
              Three independent model families
            </div>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Claude, GPT, Gemini — each lens runs on a different
              vendor so no single blind spot becomes yours.
            </p>
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Evidence
            </div>
            <div className="mt-2 font-heading text-[20px] leading-snug">
              Cited to primary sources
            </div>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Every number traces back to its 10-Q, FRED series, or
              market feed. A supervisor rejects unverifiable claims.
            </p>
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Honesty
            </div>
            <div className="mt-2 font-heading text-[20px] leading-snug">
              Misses published, same as wins
            </div>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Every brief is scored at 7d / 30d / 90d / 365d. The
              public track record shows hits and misses both.
            </p>
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
              { n: "02", icon: LineChart, title: "Analyze", body: "Three investment lenses — Quality, Momentum, Context — examine the same evidence in parallel. Each lens applies its own discipline; disagreement between them is surfaced, not hidden." },
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
                  Single-model AI tools
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
            Start your free 30-day trial — full access, no credit card. Built for investors who want evidence, not vibes.
          </p>
          <div className="mx-auto mt-8 flex flex-col items-center gap-3">
            <Link
              href="/sign-up?src=landing-cta"
              className="inline-flex items-center justify-center rounded-md bg-foreground px-7 py-3 text-[15px] font-semibold text-background transition-all hover:bg-foreground/85"
            >
              Start your free 30-day trial
            </Link>
            <p className="text-[12px] text-muted-foreground/70">
              No credit card. Cancel anytime.
            </p>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
