import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import WaitlistForm from "@/components/marketing/waitlist-form";
import { Check } from "lucide-react";

export const metadata = {
  title: "Pricing · ClearPath Invest",
  description:
    "Three research products at three cost points. Four tiers, honest pricing.",
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

const tiers: Tier[] = [
  {
    name: "Beta",
    sub: "Invitation only",
    price: "Free",
    priceSub: "during private beta",
    features: [
      "200 Quick Scans per month",
      "20 Standard research runs",
      "5 Full Panel deep dives",
      "All 12 data sources",
      "Overnight portfolio briefs ($0 cost)",
      "Email support",
    ],
    ctaLabel: "Request access",
    ctaKind: "waitlist",
  },
  {
    name: "Individual",
    sub: "For most investors",
    price: "$29",
    priceSub: "per month",
    accent: "primary",
    features: [
      "3,000 Quick Scans per month",
      "200 Standard research runs",
      "50 Full Panel deep dives",
      "Overnight brief on every holding",
      "Portfolio sync + alerts",
      "Priority support",
    ],
    ctaLabel: "Join waitlist",
    ctaKind: "waitlist",
  },
  {
    name: "Active",
    sub: "For portfolio builders",
    price: "$79",
    priceSub: "per month",
    accent: "secondary",
    features: [
      "10,000 Quick Scans per month",
      "800 Standard research runs",
      "200 Full Panel deep dives",
      "Everything in Individual",
      "Weekly portfolio review (auto-generated)",
      "Event-triggered alerts on holdings",
    ],
    ctaLabel: "Join Active waitlist",
    ctaKind: "active",
  },
  {
    name: "Advisor",
    sub: "For RIAs & planners",
    price: "$500",
    priceSub: "per month",
    features: [
      "Up to 50 client portfolios",
      "Uncapped research across all products",
      "White-label research briefs",
      "Compliance-friendly audit log",
      "API access",
      "Dedicated onboarding",
    ],
    ctaLabel: "Contact us",
    ctaKind: "contact",
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
            Three research products.
            <br />
            <em className="italic text-[var(--buy)]">Pick the depth</em> that
            fits.
          </h1>
          <p className="mx-auto mt-6 max-w-[640px] text-[17px] leading-relaxed text-muted-foreground">
            Quick Scan for triaging candidates. Standard for a real thesis.
            Full Panel for high-conviction decisions. Every tier has the same
            overnight dossier on your holdings at zero AI cost.
          </p>
        </div>
      </section>

      {/* Product explainer */}
      <section className="border-b border-border bg-secondary/30 py-12">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                label: "Quick Scan",
                price: "~$0.004 / scan",
                desc: "One model, one pass. 1-line verdict + 3 signals + primary risk. For when you want to scan 30 tickers this afternoon.",
              },
              {
                label: "Standard",
                price: "~$0.06 / run",
                desc: "One top-tier analyst, full thesis, tool use. When a Quick Scan looked interesting and you want a real read before committing.",
              },
              {
                label: "Full Panel",
                price: "~$0.21 / run",
                desc: "Three independent models with distinct lenses + supervisor cross-check. For the few finalists you're about to buy or sell.",
              },
            ].map((p) => (
              <div
                key={p.label}
                className="rounded-xl border border-border bg-card p-6"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  {p.price}
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
                ) : t.ctaKind === "active" ? (
                  <WaitlistForm source={`pricing-active`} />
                ) : (
                  <WaitlistForm source={`pricing-${t.name.toLowerCase()}`} />
                )}
              </div>
            ))}
          </div>

          <p className="mt-10 text-center text-[13px] text-muted-foreground">
            Dollar-cap sizing: Each tier has a fixed monthly AI budget — you
            can spend it all on Quick Scans, all on Full Panels, or any mix.
            Your rate at signup is locked for 12 months.
          </p>
        </div>
      </section>

      <section className="border-t border-border bg-secondary/30 py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="mb-10 text-center font-heading text-[36px] leading-tight tracking-tight">
            Questions?
          </h2>

          <div className="space-y-8">
            {[
              {
                q: "Why three research products?",
                a: "Different questions deserve different depth. Scanning 50 candidates needs a fast triage read; committing capital to a finalist deserves a panel consensus. Charging the same per-analysis cost for every one of those would force you to spend $0.21 to answer a $0.004 question — that's why you get three products with three price points. Same verified data underneath all three.",
              },
              {
                q: "Is this investment advice?",
                a: "No. ClearPath is an informational research tool. We don't give personalized financial advice, and nothing we produce should be interpreted as such. For advice specific to your situation, consult a licensed advisor.",
              },
              {
                q: "How is this different from ChatGPT?",
                a: "ChatGPT produces a single answer from stale training data with no source citations. ClearPath pulls live data from 12+ authoritative sources, runs it through up to three independent reasoning engines, cross-checks every claim against the verified data, and shows you any disagreements. Every cited number is traceable to its source.",
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
