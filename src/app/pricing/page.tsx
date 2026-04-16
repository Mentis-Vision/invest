import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import WaitlistForm from "@/components/marketing/waitlist-form";
import { Check } from "lucide-react";

export const metadata = {
  title: "Pricing · ClearPath Invest",
  description: "Private beta. Transparent pricing when we open access.",
};

const tiers = [
  {
    name: "Beta",
    sub: "Invitation only",
    price: "Free",
    priceSub: "during private beta",
    accent: false,
    features: [
      "10 ticker analyses per day",
      "All 12 data sources",
      "Full 3-model consensus",
      "Portfolio sync (read-only)",
      "Email support",
    ],
    cta: "Request access",
  },
  {
    name: "Individual",
    sub: "When access opens",
    price: "$29",
    priceSub: "per month",
    accent: true,
    features: [
      "Unlimited analyses",
      "All 12 data sources",
      "Full 3-model consensus",
      "Portfolio sync + alerts",
      "Weekly portfolio review",
      "Priority support",
    ],
    cta: "Join waitlist",
  },
  {
    name: "Advisor",
    sub: "For RIAs and planners",
    price: "Custom",
    priceSub: "contact us",
    accent: false,
    features: [
      "Up to 50 client portfolios",
      "White-label research briefs",
      "Compliance-friendly audit log",
      "API access",
      "Dedicated onboarding",
    ],
    cta: "Contact us",
  },
];

export default function Pricing() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Pricing
          </div>
          <h1 className="font-heading text-[52px] leading-[1.05] tracking-tight md:text-[64px]">
            Honest pricing,
            <br />
            once we <em className="italic text-[var(--buy)]">open access</em>.
          </h1>
          <p className="mx-auto mt-6 max-w-[560px] text-[17px] leading-relaxed text-muted-foreground">
            We&rsquo;re in private beta. Free for early users. When access opens broadly, pricing will be transparent and posted here first.
          </p>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-6 md:grid-cols-3">
            {tiers.map((t) => (
              <div
                key={t.name}
                className={`relative rounded-xl border bg-card p-8 ${
                  t.accent
                    ? "border-[var(--buy)]/30 shadow-[0_4px_32px_-8px_rgba(45,95,63,0.15)]"
                    : "border-border"
                }`}
              >
                {t.accent && (
                  <div className="absolute -top-3 left-8 rounded-full bg-[var(--buy)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--primary-foreground)]">
                    Most Investors
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="font-heading text-[26px] leading-tight">{t.name}</h3>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                    {t.sub}
                  </p>
                </div>
                <div className="mb-6 border-y border-border py-6">
                  <div className="font-heading text-[40px] leading-none tracking-tight">
                    {t.price}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{t.priceSub}</div>
                </div>
                <ul className="mb-8 space-y-3">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--buy)]" strokeWidth={2.5} />
                      <span className="text-foreground/85">{f}</span>
                    </li>
                  ))}
                </ul>
                {t.accent ? (
                  <WaitlistForm source={`pricing-${t.name.toLowerCase()}`} />
                ) : t.name === "Advisor" ? (
                  <a
                    href="mailto:hello@clearpath-invest.com"
                    className="flex w-full items-center justify-center rounded-md border border-border bg-card px-4 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-secondary"
                  >
                    {t.cta}
                  </a>
                ) : (
                  <WaitlistForm source={`pricing-${t.name.toLowerCase()}`} />
                )}
              </div>
            ))}
          </div>

          <p className="mt-10 text-center text-[13px] text-muted-foreground">
            Pricing subject to change based on beta feedback. Your rate at signup is locked for 12 months.
          </p>
        </div>
      </section>

      {/* FAQ-ish */}
      <section className="border-t border-border bg-secondary/30 py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="mb-10 text-center font-heading text-[36px] leading-tight tracking-tight">
            Questions?
          </h2>

          <div className="space-y-8">
            {[
              {
                q: "Is this investment advice?",
                a: "No. ClearPath is an informational research tool. We don’t give personalized financial advice, and nothing we produce should be interpreted as such. For advice specific to your situation, consult a licensed advisor.",
              },
              {
                q: "How is this different from ChatGPT?",
                a: "ChatGPT produces a single answer from stale training data with no source citations. ClearPath pulls live data from 12+ authoritative sources, runs it through three independent reasoning engines, cross-checks every claim, and shows you any disagreements.",
              },
              {
                q: "Can I use ClearPath with my existing brokerage?",
                a: "Yes. We integrate with Plaid for read-only portfolio sync across most major US brokerages (Fidelity, Schwab, Vanguard, Robinhood, etc.). We never execute trades — you still do that yourself.",
              },
              {
                q: "What happens to my data?",
                a: "Your portfolio data stays in your account. We don’t sell data, don’t train models on your holdings, and don’t share your information with third parties. The only outbound calls we make are to the public data sources we cite.",
              },
            ].map((item) => (
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
