import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import Link from "next/link";
import { Check } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "ClearPath Invest pricing: free 30-day trial, $29/mo Individual, $79/mo Active, $500/mo Advisor. Evidence-based stock research with live SEC and Federal Reserve data.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "ClearPath Invest pricing — free trial to $500/mo Advisor",
    description:
      "Three research depths, four tiers. Transparent fair-use caps. Your rate locks for 12 months at signup.",
    url: "/pricing",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClearPath Invest pricing",
    description:
      "Three research depths, four tiers. Free 30-day trial, no card required. 12-month price lock at signup.",
  },
};

type Tier = {
  name: string;
  sub: string;
  price: string;
  priceSub: string;
  accent?: "primary" | "secondary";
  features: string[];
  ctaLabel: string;
  ctaKind: "waitlist" | "contact" | "active";
};

const faqItems = [
  {
    q: "Why three depths of research?",
    a: "Different questions deserve different depth. Scanning 50 candidates needs a fast triage read; committing capital to a finalist deserves a full-panel consensus. Asking both with the same tool would either be wasteful or shallow. You get three depths; we route the right one for the context automatically, but you can always override.",
  },
  {
    q: "Is this investment advice?",
    a: "No. ClearPath is an informational research tool. We don't give personalized financial advice, and nothing we produce should be interpreted as such. For advice specific to your situation, consult a licensed advisor.",
  },
  {
    q: "How is this different from a general chatbot?",
    a: "Chatbots produce a single answer from stale training data with no source citations. ClearPath pulls live data from 12+ authoritative sources, applies three independent investment lenses — Quality, Momentum, Context — to the same verified facts, surfaces disagreement between them when it exists, and cites every claim back to its primary source. You see the evidence, not just the conclusion.",
  },
  {
    q: "Can I use ClearPath with my existing brokerage?",
    a: "Yes. We integrate with SnapTrade for read-only portfolio sync across 15+ major brokerages (Fidelity, Schwab, Robinhood, Coinbase, etc.). We never execute trades — you still do that yourself in your brokerage.",
  },
  {
    q: "What happens to my data?",
    a: "Your portfolio data stays in your account. We don't sell data, don't train models on your holdings, and don't share your information with third parties. The nightly warehouse holds ticker-level market data only — never userId or PII.",
  },
  {
    q: "What if I want to switch tiers?",
    a: "Up or down any time. We prorate. If you find yourself hitting the Individual cap three months in a row, that's the signal to upgrade to Active.",
  },
] as const;

// FAQPage JSON-LD — wraps the existing FAQ below. Biggest SEO + LLM-
// citation win on the site: FAQPage schema regularly unlocks AI
// Overviews on Google. Static server-side constant, no user input.
const faqPageLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
} as const;

// Tier volume numbers are published as concrete caps, not vague
// magnitudes — the brand promise is "every claim traceable," so the
// pricing page should not say "a few hundred." All caps are fair-use:
// we email at 80% of the limit rather than hard-clip, giving headroom
// for the occasional spike. Numbers sized so the 4× Individual→Active
// headroom math still works.
const tiers: Tier[] = [
  {
    name: "Free trial",
    sub: "Full access for 30 days",
    price: "Free",
    priceSub: "no credit card",
    features: [
      "Every Individual-tier feature, unlocked",
      "100 quick reads · 10 deep reads · 3 panels per month",
      "Overnight portfolio brief on every holding",
      "All 12+ data sources",
      "Cancels automatically — no card on file",
    ],
    ctaLabel: "Start free trial",
    ctaKind: "active",
  },
  {
    name: "Individual",
    sub: "For most investors",
    price: "$29",
    priceSub: "per month",
    accent: "primary",
    features: [
      "300 quick reads / month",
      "30 deep reads / month",
      "10 panel consensus briefs / month",
      "Overnight brief on every holding",
      "Portfolio sync + alerts",
      "Priority support",
    ],
    ctaLabel: "Start with Individual",
    ctaKind: "active",
  },
  {
    name: "Active",
    sub: "For portfolio builders",
    price: "$79",
    priceSub: "per month",
    accent: "secondary",
    features: [
      "Everything in Individual",
      "1,200 quick / 120 deep / 40 panels per month (4×)",
      "Weekly portfolio review (auto-generated)",
      "Event-triggered alerts on holdings",
      "Priority routing on panel consensus",
    ],
    ctaLabel: "Start with Active",
    ctaKind: "active",
  },
  {
    name: "Advisor",
    sub: "For RIAs & planners",
    price: "$500",
    priceSub: "per month",
    features: [
      "Up to 50 client portfolios",
      "Effectively uncapped research under fair use",
      "White-label research briefs",
      "Compliance-friendly audit log",
      "API access",
      "Dedicated onboarding",
    ],
    ctaLabel: "Contact us",
    ctaKind: "contact",
  },
];

// Product / Offer JSON-LD — one per tier. Static server-side payload.
// Parsed from the `tiers` array so it stays in sync with what the page
// actually renders.
const productsLd = tiers.map((t) => {
  // Beta price "Free" → "0" numeric. All other tiers start with "$".
  const numericPrice =
    t.price === "Free"
      ? "0"
      : t.price.replace(/[^0-9.]/g, "") || "0";
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `ClearPath Invest — ${t.name}`,
    description: `${t.sub}. ${t.features.slice(0, 3).join(". ")}.`,
    brand: { "@type": "Brand", name: "ClearPath Invest" },
    offers: {
      "@type": "Offer",
      price: numericPrice,
      priceCurrency: "USD",
      availability: "https://schema.org/PreOrder",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: numericPrice,
        priceCurrency: "USD",
        billingIncrement: 1,
        unitText: "MONTH",
      },
    },
  };
});

export default function Pricing() {
  return (
    <div className="min-h-screen bg-background">
      {/* JSON-LD — FAQPage + one Product per tier. XSS-safe: the
          dangerouslySetInnerHTML payloads are hard-coded server-side
          constants (no user input, no DB value, no query param). This
          is the Next.js-recommended pattern for JSON-LD, see
          https://nextjs.org/docs/app/guides/json-ld. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageLd) }}
      />
      {productsLd.map((p, i) => (
        <script
          key={`product-ld-${i}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(p) }}
        />
      ))}
      <MarketingNav />

      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Pricing
          </div>
          <h1 className="font-heading text-[52px] leading-[1.05] tracking-tight md:text-[64px]">
            Three research products.
            <br />
            <em className="italic text-[var(--buy)]">Pick the depth</em> that
            fits.
          </h1>
          <p className="mx-auto mt-6 max-w-[640px] text-[17px] leading-relaxed text-muted-foreground">
            Quick Scan for triaging candidates. Standard for a real thesis.
            Full Panel for high-conviction decisions. Every tier includes the
            same overnight dossier on your holdings — no add-on fees.
          </p>
        </div>
      </section>

      {/* Product explainer */}
      <section className="border-b border-border bg-secondary/30 py-12">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                label: "Quick read",
                tagline: "Triage candidates",
                desc: "A fast, honest read: headline verdict, three signals driving it, the single biggest risk. Built for scanning many tickers in an afternoon.",
              },
              {
                label: "Deep read",
                tagline: "Commit to a thesis",
                desc: "One lens applied with full rigor and tool use. Gives you a real thesis — with sources — before you put capital to work.",
              },
              {
                label: "Panel",
                tagline: "Decide with conviction",
                desc: "Three lenses cross-examine each other — Quality, Momentum, Context. Disagreement is surfaced, not hidden. For decisions you'll act on.",
              },
            ].map((p) => (
              <div
                key={p.label}
                className="rounded-xl border border-border bg-card p-6"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  {p.tagline}
                </div>
                <h3 className="mt-1 font-heading text-[22px] tracking-tight">
                  {p.label}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
                  {p.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {tiers.map((t) => (
              <div
                key={t.name}
                className={`relative rounded-xl border bg-card p-7 ${
                  t.accent === "primary"
                    ? "border-[var(--buy)]/30 shadow-[0_4px_32px_-8px_rgba(45,95,63,0.15)]"
                    : t.accent === "secondary"
                      ? "border-[var(--decisive)]/30"
                      : "border-border"
                }`}
              >
                {t.accent === "primary" && (
                  <div className="absolute -top-3 left-6 rounded-full bg-[var(--buy)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--primary-foreground)]">
                    Most investors
                  </div>
                )}
                {t.accent === "secondary" && (
                  <div className="absolute -top-3 left-6 rounded-full bg-[var(--decisive)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white">
                    Power users
                  </div>
                )}
                <div className="mb-5">
                  <h3 className="font-heading text-[22px] leading-tight">
                    {t.name}
                  </h3>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                    {t.sub}
                  </p>
                </div>
                <div className="mb-5 border-y border-border py-5">
                  <div className="font-heading text-[32px] leading-none tracking-tight">
                    {t.price}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t.priceSub}
                  </div>
                </div>
                <ul className="mb-6 space-y-2.5">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px]">
                      <Check
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--buy)]"
                        strokeWidth={2.5}
                      />
                      <span className="text-foreground/85 leading-snug">{f}</span>
                    </li>
                  ))}
                </ul>
                {t.ctaKind === "contact" ? (
                  <a
                    href="mailto:hello@clearpathinvest.app?subject=Advisor%20tier%20inquiry"
                    className="flex w-full items-center justify-center rounded-md border border-border bg-card px-4 py-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-secondary"
                  >
                    {t.ctaLabel}
                  </a>
                ) : (
                  /* All non-Advisor tiers route to /sign-up. The 30-day
                     trial is no-card, so anyone can start; on conversion
                     they pick a paid tier. The src param tags which
                     pricing card they came from for funnel analytics. */
                  <Link
                    href={`/sign-up?src=pricing-${t.name.toLowerCase().replace(/\s+/g, "-")}`}
                    className="flex w-full items-center justify-center rounded-md bg-foreground px-4 py-2.5 text-[12px] font-semibold text-background transition-colors hover:bg-foreground/85"
                  >
                    {t.ctaLabel}
                  </Link>
                )}
              </div>
            ))}
          </div>

          <p className="mt-10 text-center text-[13px] text-muted-foreground">
            Your rate at signup is locked for 12 months. You can switch tiers
            up or down any time — we prorate.
          </p>
          <p className="mt-2 text-center text-[12px] text-muted-foreground/80">
            Caps are fair-use — we email you at 80% of the limit, never hard-
            clip mid-research. Unused capacity doesn&rsquo;t roll over.
          </p>
        </div>
      </section>

      <section className="border-t border-border bg-secondary/30 py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="mb-10 text-center font-heading text-[36px] leading-tight tracking-tight">
            Questions?
          </h2>

          <div className="space-y-8">
            {faqItems.map((item) => (
              <div key={item.q}>
                <h3 className="font-heading text-[20px] leading-tight text-foreground">
                  {item.q}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
