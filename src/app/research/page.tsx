import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import { Rss, ArrowRight } from "lucide-react";
import { listRecentBriefs } from "@/lib/public-brief";

/**
 * /research — index of all public weekly briefs.
 *
 * Ranked chronologically (newest first). Each row links to the full
 * brief at /research/[slug]. Also advertises the RSS feed at
 * /research/feed.xml for newsletter-adjacent distribution.
 *
 * Revalidates every 6 hours — new briefs drop on Mondays and there's
 * no point hitting the DB on every visit when the data is weekly.
 */

export const revalidate = 21600;

export const metadata: Metadata = {
  title: "Weekly stock research briefs",
  description:
    "Evidence-based weekly bull-vs-bear briefs on high-interest stocks. Three-lens consensus, every claim cited. Public track record maintained.",
  alternates: {
    canonical: "/research",
    types: { "application/rss+xml": "/research/feed.xml" },
  },
  openGraph: {
    title: "Weekly stock research briefs — ClearPath Invest",
    description:
      "Bull-vs-bear briefs on a high-interest ticker every Monday. Three-lens consensus, cited claims, informational only.",
    url: "/research",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Weekly stock research briefs — ClearPath Invest",
    description:
      "Bull-vs-bear briefs on a high-interest ticker every Monday. Three-lens consensus, cited claims.",
  },
};

export default async function ResearchIndex() {
  const briefs = await listRecentBriefs(60);

  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      {/* Header */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Weekly briefs
          </div>
          <h1 className="font-heading text-[44px] leading-[1.05] tracking-tight md:text-[60px]">
            One ticker. <em className="italic text-[var(--buy)]">Bull and bear.</em>{" "}
            Every Monday.
          </h1>
          <p className="mx-auto mt-6 max-w-[640px] text-[17px] leading-relaxed text-muted-foreground">
            Each Monday we publish a full three-lens brief on one
            high-interest stock — Quality, Momentum, and Context lenses,
            an explicit bull case, an explicit bear case, and a calibrated
            consensus verdict. Every claim traces to a primary source.
          </p>

          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/#access"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background transition-colors hover:bg-foreground/85"
            >
              Get weekly briefs by email
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <a
              href="/research/feed.xml"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2.5 text-[12px] font-semibold text-foreground transition-colors hover:border-primary/40"
            >
              <Rss className="h-3.5 w-3.5" />
              RSS
            </a>
          </div>
          <p className="mt-4 text-[11px] text-muted-foreground/70">
            Informational only · Not investment advice
          </p>
        </div>
      </section>

      {/* List */}
      <section className="py-14">
        <div className="mx-auto max-w-4xl px-6">
          {briefs.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Priming
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-foreground/85">
                The first weekly brief drops Monday. Want it by email on
                arrival?
              </p>
              <Link
                href="/#access"
                className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-foreground underline underline-offset-4 hover:text-[var(--buy)]"
              >
                Request access
              </Link>
            </div>
          ) : (
            <ul className="space-y-4">
              {briefs.map((b) => (
                <li
                  key={b.id}
                  className="rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
                >
                  <Link href={`/research/${b.slug}`} className="block p-5 md:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                          <span>Week of {b.weekOf}</span>
                          <span className="text-foreground/25">·</span>
                          <span>{b.ticker}</span>
                          <span className="text-foreground/25">·</span>
                          <span>{b.consensus}</span>
                        </div>
                        <h2 className="mt-2 font-heading text-[20px] leading-snug tracking-tight md:text-[22px]">
                          {b.summary ?? `${b.ticker} — ${b.recommendation}`}
                        </h2>
                      </div>
                      <VerdictBadge
                        call={b.recommendation}
                        confidence={b.confidence}
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function VerdictBadge({
  call,
  confidence,
}: {
  call: string;
  confidence: string;
}) {
  const toneClass =
    call === "BUY"
      ? "border-[var(--buy)]/30 bg-[var(--buy)]/10 text-[var(--buy)]"
      : call === "SELL"
        ? "border-[var(--sell)]/30 bg-[var(--sell)]/10 text-[var(--sell)]"
        : "border-[var(--hold)]/30 bg-[var(--hold)]/10 text-[var(--hold)]";
  return (
    <div className="flex flex-col items-end">
      <span
        className={`rounded-md border px-3 py-1 text-sm font-semibold ${toneClass}`}
      >
        {call}
      </span>
      <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        {confidence} confidence
      </span>
    </div>
  );
}
