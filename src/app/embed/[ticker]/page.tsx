import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Activity,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import { getPublicDossier } from "@/lib/warehouse/public-dossier";
import type { DossierTone, SignalTone } from "@/lib/warehouse/dossier";

/**
 * /embed/[ticker] — public, iframe-friendly dossier widget.
 *
 * A tiny, self-contained card bloggers / Substack writers / fintwit
 * accounts can drop into their content via a simple <iframe>:
 *
 *   <iframe src="https://clearpathinvest.app/embed/AAPL"
 *           width="100%" height="420" frameborder="0"></iframe>
 *
 * Every embed is a backlink (the "Open full research" CTA is a real
 * <a> tag). Zero AI cost per render — reads from the warehouse
 * via the same heuristic dossier builder the authed Research page uses.
 *
 * Iframe compatibility:
 *   - No nav, no footer, no marketing chrome
 *   - No auth wall
 *   - No X-Frame-Options header set by proxy.ts (confirmed)
 *   - Next.js sets no default X-Frame-Options, so major browsers
 *     render this cross-origin without issue
 *
 * Revalidate every 6 hours — warehouse data is slowly-changing and
 * cache-per-render would lock in a stale price mid-session.
 */

export const revalidate = 21600;
export const dynamic = "force-static";

type Params = { ticker: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  return {
    title: `${t} brief`,
    description: `ClearPath Invest consensus brief for ${t} — three-lens evidence-based stock research. Informational only.`,
    robots: {
      // Embed pages are meant to be iframed, not ranked. The canonical
      // ticker landing is /stocks/[ticker] — let it get the SEO juice
      // and noindex the embed variant to avoid duplicate content.
      index: false,
      follow: true,
    },
  };
}

export default async function EmbedPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { ticker } = await params;
  const normalized = ticker.toUpperCase();

  // Cheap input guard — everything beyond 10 chars or containing
  // non-ticker chars is almost certainly a 404 probe.
  if (!/^[A-Z0-9.\-]{1,10}$/.test(normalized)) {
    notFound();
  }

  const dossier = await getPublicDossier(normalized);

  if (!dossier) {
    // Stay graceful inside an iframe — render a minimal card rather
    // than a full 404 page (a 404 HTML page looks terrible embedded).
    return <NoDataCard ticker={normalized} />;
  }

  const toneAccent = toneToAccent(dossier.tone);
  const topSignals = dossier.signals.slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-xl p-4">
        <div className="relative overflow-hidden rounded-lg border border-border bg-card p-5 shadow-[0_1px_0_0_rgba(0,0,0,0.02),0_12px_24px_-16px_rgba(26,26,30,0.08)]">
          {/* Eyebrow */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              <Sparkles className="h-3 w-3 text-[var(--buy)]" />
              ClearPath · {dossier.ticker}
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${toneAccent}`}
            >
              {toneLabel(dossier.tone)}
            </span>
          </div>

          {/* Headline */}
          <h2 className="mt-3 text-[15px] font-semibold leading-snug text-foreground">
            {dossier.headline}
          </h2>

          {/* Signals */}
          {topSignals.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {topSignals.map((signal, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-[12.5px] leading-relaxed"
                >
                  <SignalIcon tone={signal.tone} />
                  <span className="text-foreground/80">{signal.text}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Narrative */}
          {dossier.narrative && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              {dossier.narrative}
            </p>
          )}

          {/* CTA + disclaimer */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground/70">
              Informational only · Not investment advice
            </span>
            <Link
              href={`https://clearpathinvest.app/stocks/${dossier.ticker}?utm_source=embed&utm_medium=widget&utm_content=${dossier.ticker}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-semibold text-background transition-colors hover:bg-foreground/85"
            >
              Full brief
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* ClearPath attribution — the reason the widget is free to use */}
        <div className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/60">
          Powered by{" "}
          <a
            href="https://clearpathinvest.app/?utm_source=embed&utm_medium=widget_footer"
            target="_blank"
            rel="noopener"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            clearpathinvest.app
          </a>
        </div>
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function NoDataCard({ ticker }: { ticker: string }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-xl p-4">
        <div className="rounded-lg border border-border bg-card p-5 text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            ClearPath · {ticker}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-foreground/85">
            We don&rsquo;t have a fresh brief for{" "}
            <span className="font-mono">{ticker}</span> yet.
          </p>
          <Link
            href={`https://clearpathinvest.app/?ticker=${ticker}&utm_source=embed&utm_medium=widget`}
            target="_blank"
            rel="noopener"
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-foreground underline underline-offset-4 hover:text-[var(--buy)]"
          >
            See ClearPath <ArrowUpRight className="h-3 w-3" />
          </Link>
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
  const className = "mt-0.5 h-3 w-3 flex-shrink-0";
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
