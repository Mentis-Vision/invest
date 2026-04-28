import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Activity,
  Sparkles,
  ArrowRight,
  ArrowUpRight,
  Code2,
} from "lucide-react";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import { getPublicDossier } from "@/lib/warehouse/public-dossier";
import type { DossierTone, SignalTone } from "@/lib/warehouse/dossier";

/**
 * /stocks/[ticker] — programmatic SEO landing page for any US equity.
 *
 * One indexable page per ticker. Renders the nightly dossier (zero AI
 * cost per visit) as a real, quotable brief with signals, narrative,
 * and source provenance. Links into the full product for visitors who
 * want the live, interactive research flow.
 *
 * SEO thesis:
 *   - Yahoo Finance dominates `[ticker]` head queries — we can't win
 *     those.
 *   - We CAN rank for long-tail: `[ticker] three-lens analysis`,
 *     `[ticker] AI consensus brief`, `is [ticker] a buy evidence-based`.
 *   - Schema-dense (FinancialProduct + Article) means strong AI-
 *     citation signal (Perplexity / Google AI Overviews).
 *
 * Content freshness:
 *   - ISR with 6-hour revalidation — warehouse is slowly-changing,
 *     the dossier prose tolerates 6-hour staleness easily.
 *   - Visitors requesting real-time data hit the CTA → authed product.
 */

export const revalidate = 21600;

type Params = { ticker: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { ticker } = await params;
  const t = ticker.toUpperCase();

  return {
    title: `${t} stock research — evidence-based consensus brief`,
    description: `${t} analyzed across three independent lenses — Quality, Momentum, Context — with live SEC, Federal Reserve, and market data. Every claim traces to a primary source. Informational only, not investment advice.`,
    alternates: { canonical: `/stocks/${t}` },
    openGraph: {
      title: `${t} — ClearPath three-lens consensus brief`,
      description: `Evidence-based stock research on ${t}. Live data, cited claims, honest confidence calibration.`,
      url: `/stocks/${t}`,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${t} — three-lens brief`,
      description: `Evidence-based consensus research on ${t}, updated nightly.`,
    },
  };
}

export default async function TickerPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { ticker } = await params;
  const t = ticker.toUpperCase();

  if (!/^[A-Z0-9.\-]{1,10}$/.test(t)) {
    notFound();
  }

  const dossier = await getPublicDossier(t);

  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 pt-14 pb-10">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            <Link
              href="/stocks"
              className="hover:text-foreground"
              aria-label="All tickers"
            >
              Stocks
            </Link>
            <span className="text-foreground/30">/</span>
            <span>{t}</span>
          </div>

          <h1 className="mt-4 font-heading text-[48px] leading-[1.05] tracking-tight md:text-[64px]">
            {t}{" "}
            <em className="italic text-[var(--buy)]">three-lens</em> brief
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-muted-foreground md:text-[17px]">
            Evidence-based stock research on {t}. Three independent lenses —
            Quality, Momentum, Context — examine live data from SEC filings,
            the Federal Reserve, and market feeds. Every claim traces to its
            primary source.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={`/sign-up?src=stocks-${t}-hero`}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background transition-colors hover:bg-foreground/85"
            >
              Get full {t} research
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-5 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:border-primary/40"
            >
              How the three lenses work
            </Link>
          </div>
        </div>
      </section>

      {/* Dossier card */}
      <section className="py-10">
        <div className="mx-auto max-w-4xl px-6">
          {dossier ? (
            <DossierCard dossier={dossier} />
          ) : (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {t} · Priming
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-foreground/85">
                We haven&rsquo;t primed a public brief for {t} yet. Sign up
                to run a live three-lens analysis with the full research
                desk — free during your 30-day trial.
              </p>
              <div className="mx-auto mt-5 flex justify-center">
                <Link
                  href={`/sign-up?src=stocks-${t}`}
                  className="inline-flex items-center justify-center rounded-md bg-foreground px-6 py-2.5 text-[13px] font-semibold text-background transition-colors hover:bg-foreground/85"
                >
                  Start your free trial
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Methodology + embed */}
      <section className="border-t border-border bg-secondary/20 py-14">
        <div className="mx-auto max-w-4xl px-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                <Sparkles className="h-3 w-3 text-[var(--buy)]" />
                Three-lens method
              </div>
              <h2 className="font-heading text-[20px] leading-tight tracking-tight">
                Why three lenses on {t}, not one.
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
                A single reasoning model has blind spots it doesn&rsquo;t
                know about. We examine {t} across Quality (fundamentals),
                Momentum (price action and sentiment), and Context
                (macro/sector). Disagreement between lenses is surfaced,
                not hidden — it&rsquo;s how you know when HOLD is the
                honest call.
              </p>
              <Link
                href="/how-it-works"
                className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-foreground underline underline-offset-4 hover:text-[var(--buy)]"
              >
                Read the full methodology
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                <Code2 className="h-3 w-3 text-[var(--buy)]" />
                Embed this brief
              </div>
              <h2 className="font-heading text-[20px] leading-tight tracking-tight">
                Drop it in your newsletter or blog.
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                Free to embed. Updates every 6 hours. Links back to the
                full brief.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md bg-secondary/60 p-3 font-mono text-[11px] leading-relaxed text-foreground/85">
                {`<iframe
  src="https://clearpathinvest.app/embed/${t}"
  width="100%" height="420" frameborder="0"
  loading="lazy"
  title="ClearPath ${t} brief"></iframe>`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Related / internal-link anchor */}
      <section className="py-14">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="font-heading text-[22px] leading-tight tracking-tight">
            Also on ClearPath
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Link
              href="/how-it-works"
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Methodology
              </div>
              <div className="mt-1 font-heading text-[15px]">
                The five-stage pipeline
              </div>
            </Link>
            <Link
              href="/alternatives"
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Compare
              </div>
              <div className="mt-1 font-heading text-[15px]">
                ClearPath vs. big dashboards
              </div>
            </Link>
            <Link
              href="/track-record"
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Transparency
              </div>
              <div className="mt-1 font-heading text-[15px]">
                Public track record
              </div>
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

// ── dossier rendering ───────────────────────────────────────────────

function DossierCard({
  dossier,
}: {
  dossier: NonNullable<Awaited<ReturnType<typeof getPublicDossier>>>;
}) {
  const toneAccent = toneToAccent(dossier.tone);
  const signals = dossier.signals.slice(0, 5);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_0_0_rgba(0,0,0,0.03),0_24px_48px_-24px_rgba(26,26,30,0.12)]">
      <div className="flex flex-wrap items-center justify-between gap-y-2 border-b border-border/70 bg-secondary/30 px-6 py-3">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="h-3 w-3 text-[var(--buy)]" />
          {dossier.ticker} · Nightly brief
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${toneAccent}`}
        >
          {toneLabel(dossier.tone)}
        </span>
      </div>

      <div className="px-6 py-6">
        <h2 className="font-heading text-[22px] leading-snug text-foreground md:text-[26px]">
          {dossier.headline}
        </h2>

        {signals.length > 0 && (
          <ul className="mt-5 space-y-2.5">
            {signals.map((signal, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-[14px] leading-relaxed"
              >
                <SignalIcon tone={signal.tone} />
                <span className="text-foreground/85">{signal.text}</span>
              </li>
            ))}
          </ul>
        )}

        {dossier.narrative && (
          <p className="mt-5 text-[13.5px] leading-relaxed text-muted-foreground">
            {dossier.narrative}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/80">
            {dossier.sourceSummary.hasMarket && <span>Market ✓</span>}
            {dossier.sourceSummary.hasFundamentals && <span>· Fundamentals ✓</span>}
            {dossier.sourceSummary.eventCount > 0 && (
              <span>· {dossier.sourceSummary.eventCount} events</span>
            )}
            {dossier.sourceSummary.sentimentCoverage === "finnhub" && (
              <span>· Sentiment ✓</span>
            )}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70">
            Informational only · Not investment advice
          </span>
        </div>
      </div>
    </div>
  );
}

function toneToAccent(tone: DossierTone): string {
  switch (tone) {
    case "concern":
      return "bg-[var(--sell)]/10 text-[var(--sell)]";
    case "inspect":
      return "bg-[var(--hold)]/10 text-[var(--hold)]";
    case "watch":
      return "bg-[var(--buy)]/10 text-[var(--buy)]";
    case "steady":
    default:
      return "bg-secondary text-muted-foreground";
  }
}

function toneLabel(tone: DossierTone): string {
  switch (tone) {
    case "concern":
      return "Concern";
    case "inspect":
      return "Inspect";
    case "watch":
      return "Watch";
    case "steady":
    default:
      return "Steady";
  }
}

function SignalIcon({ tone }: { tone: SignalTone }) {
  const className = "mt-0.5 h-3.5 w-3.5 flex-shrink-0";
  switch (tone) {
    case "up":
      return <TrendingUp className={`${className} text-[var(--buy)]`} />;
    case "down":
      return <TrendingDown className={`${className} text-[var(--sell)]`} />;
    case "watch":
      return <AlertCircle className={`${className} text-[var(--hold)]`} />;
    case "neutral":
    default:
      return <Activity className={`${className} text-muted-foreground`} />;
  }
}
