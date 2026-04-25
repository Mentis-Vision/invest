import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import WaitlistForm from "@/components/marketing/waitlist-form";
import {
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  ArrowUpRight,
  Sparkles,
  Clock,
} from "lucide-react";
import { getBriefBySlug } from "@/lib/public-brief";
import {
  getOutcomesForBrief,
  type PublicBriefOutcomeRow,
  type PublicBriefWindow,
} from "@/lib/public-brief-outcomes";

/**
 * /research/[slug] — full rendered weekly brief.
 *
 * Slug format: `${ticker-lowercase}-${weekOf ISO date}` — e.g.
 * `aapl-2026-04-21`. Produced at generation time in public-brief.ts.
 *
 * The page is intentionally content-rich: full bull case, bear case,
 * supervisor summary, and three-lens excerpts — plus structured data
 * that LLMs can cite. Revalidates every 6 hours; new briefs land
 * Mondays via the cron.
 */

export const revalidate = 21600;

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const brief = await getBriefBySlug(slug);
  if (!brief) {
    return {
      title: "Brief not found",
      robots: { index: false, follow: false },
    };
  }
  const title = `${brief.ticker} weekly brief — ${brief.recommendation} (${brief.confidence})`;
  const description =
    brief.summary ??
    `Three-lens evidence-based brief on ${brief.ticker}. Week of ${brief.weekOf}. Bull case, bear case, cited claims, informational only.`;
  return {
    title,
    description,
    alternates: { canonical: `/research/${brief.slug}` },
    openGraph: {
      title,
      description,
      url: `/research/${brief.slug}`,
      type: "article",
      publishedTime: brief.createdAt,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function BriefPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const brief = await getBriefBySlug(slug);
  if (!brief) notFound();

  // Outcome retrospective — fetched in parallel with the lens render so
  // a slow price-snapshot query never blocks first paint. Failures here
  // just omit the section; outcomes are informational, not gating.
  const outcomes = await getOutcomesForBrief(brief.id).catch(() => [] as PublicBriefOutcomeRow[]);

  // Pull analyst lens summaries from the stored analysisJson.
  const analysisJson = brief.analysisJson as {
    analyses?: Array<{
      model?: string;
      status?: string;
      output?: {
        recommendation?: string;
        confidence?: string;
        thesis?: string;
        keySignals?: Array<{
          signal: string;
          direction?: string;
          datum?: string;
        }>;
      };
    }>;
    supervisor?: {
      finalRecommendation?: string;
      confidence?: string;
      summary?: string;
      agreedPoints?: string[];
      // Per SupervisorOutputSchema: disagreements is an array of
      // {topic, claudeView, gptView, geminiView} objects, NOT strings.
      // Rendering each one needs a dedicated component (see below).
      disagreements?: Array<{
        topic: string;
        claudeView: string;
        gptView: string;
        geminiView: string;
      }>;
      redFlags?: string[];
    };
  };

  const analyses = analysisJson.analyses ?? [];
  const supervisor = analysisJson.supervisor ?? {};

  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      {/* Header */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 pt-14 pb-8">
          <nav className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            <Link href="/research" className="hover:text-foreground">
              Weekly briefs
            </Link>
            <span className="text-foreground/30">/</span>
            <span>Week of {brief.weekOf}</span>
          </nav>

          <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h1 className="font-heading text-[44px] leading-[1.02] tracking-tight md:text-[56px]">
                  {brief.ticker}
                </h1>
                <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  · Week of {brief.weekOf}
                </span>
              </div>
              {brief.priceAtRec != null && (
                <div className="mt-1 font-mono text-sm text-muted-foreground">
                  At brief: ${brief.priceAtRec.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              )}
            </div>

            <VerdictCard
              call={brief.recommendation}
              confidence={brief.confidence}
              consensus={brief.consensus}
            />
          </div>

          {brief.summary && (
            <p className="mt-6 max-w-3xl text-[17px] leading-relaxed text-foreground/90">
              {brief.summary}
            </p>
          )}
        </div>
      </section>

      {/* Bull vs. Bear */}
      <section className="py-14">
        <div className="mx-auto max-w-4xl px-6">
          <div className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-[var(--buy)]" />
            Bull vs. bear
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <CasePanel
              tone="bull"
              title="Bull case"
              text={brief.bullCase}
            />
            <CasePanel
              tone="bear"
              title="Bear case"
              text={brief.bearCase}
            />
          </div>
        </div>
      </section>

      {/* Three lenses */}
      {analyses.length > 0 && (
        <section className="border-t border-border bg-secondary/20 py-14">
          <div className="mx-auto max-w-5xl px-6">
            <div className="mb-8">
              <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Three lenses
              </div>
              <h2 className="font-heading text-[28px] leading-tight tracking-tight md:text-[36px]">
                How the Quality, Momentum, and Context lenses read{" "}
                {brief.ticker}.
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {analyses.map((a, i) => (
                <LensCard key={`${a.model}-${i}`} analysis={a} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Supervisor — agreements / disagreements / red flags */}
      {(supervisor.agreedPoints?.length ||
        supervisor.disagreements?.length ||
        supervisor.redFlags?.length) && (
        <section className="py-14">
          <div className="mx-auto max-w-4xl px-6">
            <div className="mb-8">
              <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                <ShieldCheck className="h-3 w-3 text-[var(--buy)]" />
                Supervisor review
              </div>
              <h2 className="font-heading text-[24px] leading-tight tracking-tight md:text-[30px]">
                Where the lenses agree, disagree, and flag risk.
              </h2>
            </div>
            <div className="space-y-5">
              {supervisor.agreedPoints && supervisor.agreedPoints.length > 0 && (
                <SupervisorBlock
                  title="Agreed points"
                  tone="agree"
                  items={supervisor.agreedPoints}
                />
              )}
              {supervisor.disagreements && supervisor.disagreements.length > 0 && (
                <DisagreementsBlock items={supervisor.disagreements} />
              )}
              {supervisor.redFlags && supervisor.redFlags.length > 0 && (
                <SupervisorBlock
                  title="Red flags"
                  tone="redflag"
                  items={supervisor.redFlags}
                />
              )}
            </div>
          </div>
        </section>
      )}

      {/* Outcome retrospective — track-record surface */}
      <OutcomeRetrospective
        call={brief.recommendation}
        priceAtRec={brief.priceAtRec}
        outcomes={outcomes}
      />

      {/* CTA + legal */}
      <section className="border-t border-border bg-secondary/30 py-14">
        <div className="mx-auto max-w-3xl px-6">
          <div className="grid gap-6 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="font-heading text-[26px] leading-tight tracking-tight md:text-[32px]">
                Want the live brief on any ticker?
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                This is a weekly public brief. ClearPath runs the same
                three-lens pipeline on demand for any US equity in the
                private beta — free during beta.
              </p>
              <p className="mt-4 text-[11px] text-muted-foreground/70">
                Informational only · Not investment advice
              </p>
            </div>
            <div>
              <WaitlistForm source={`brief-${brief.ticker}`} />
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

// ── rendering helpers ──────────────────────────────────────────────

function VerdictCard({
  call,
  confidence,
  consensus,
}: {
  call: string;
  confidence: string;
  consensus: string;
}) {
  const toneClass =
    call === "BUY"
      ? "border-[var(--buy)]/30 bg-[var(--buy)]/10 text-[var(--buy)]"
      : call === "SELL"
        ? "border-[var(--sell)]/30 bg-[var(--sell)]/10 text-[var(--sell)]"
        : "border-[var(--hold)]/30 bg-[var(--hold)]/10 text-[var(--hold)]";
  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={`rounded-md border px-4 py-1.5 text-lg font-semibold ${toneClass}`}
      >
        {call}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {confidence} confidence · {consensus}
      </span>
    </div>
  );
}

function CasePanel({
  tone,
  title,
  text,
}: {
  tone: "bull" | "bear";
  title: string;
  text: string | null;
}) {
  const Icon = tone === "bull" ? TrendingUp : TrendingDown;
  const ringClass =
    tone === "bull"
      ? "border-[var(--buy)]/25 bg-[var(--buy)]/5"
      : "border-[var(--sell)]/25 bg-[var(--sell)]/5";
  const textColor = tone === "bull" ? "text-[var(--buy)]" : "text-[var(--sell)]";
  return (
    <div className={`rounded-xl border ${ringClass} p-5 md:p-6`}>
      <div
        className={`mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] ${textColor}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {text ? (
        <div className="space-y-2 text-[14px] leading-relaxed text-foreground/85">
          {text.split("\n").map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      ) : (
        <p className="text-[14px] italic text-muted-foreground">
          No {tone} case was produced for this brief.
        </p>
      )}
    </div>
  );
}

function LensCard({
  analysis,
}: {
  analysis: {
    model?: string;
    status?: string;
    output?: {
      recommendation?: string;
      confidence?: string;
      thesis?: string;
      keySignals?: Array<{ signal: string; direction?: string; datum?: string }>;
    };
  };
}) {
  const lensLabel: Record<string, string> = {
    claude: "Quality",
    gpt: "Momentum",
    gemini: "Context",
  };
  const label =
    lensLabel[analysis.model ?? ""] ??
    (analysis.model ?? "Lens").toUpperCase();
  const output = analysis.output;
  const ok = analysis.status === "ok" && output;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </div>
        {ok && output.recommendation && (
          <span
            className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${
              output.recommendation === "BUY"
                ? "bg-[var(--buy)]/10 text-[var(--buy)]"
                : output.recommendation === "SELL"
                  ? "bg-[var(--sell)]/10 text-[var(--sell)]"
                  : "bg-[var(--hold)]/10 text-[var(--hold)]"
            }`}
          >
            {output.recommendation}
          </span>
        )}
      </div>
      {ok ? (
        <>
          {output.thesis && (
            <p className="mt-3 text-[13px] leading-relaxed text-foreground/90">
              {output.thesis}
            </p>
          )}
          {output.keySignals && output.keySignals.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-[12px] leading-snug">
              {output.keySignals.slice(0, 3).map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-muted-foreground/60">•</span>
                  <span className="text-muted-foreground">
                    {s.signal}
                    {s.datum && (
                      <span className="text-foreground/60"> — {s.datum}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-3 text-[12px] italic text-muted-foreground">
          This lens didn&rsquo;t produce a usable output for this run.
        </p>
      )}
    </div>
  );
}

function SupervisorBlock({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "agree" | "disagree" | "redflag";
  items: string[];
}) {
  const color =
    tone === "redflag"
      ? "text-[var(--sell)]"
      : tone === "disagree"
        ? "text-[var(--hold)]"
        : "text-[var(--buy)]";
  const ring =
    tone === "redflag"
      ? "border-[var(--sell)]/25 bg-[var(--sell)]/5"
      : tone === "disagree"
        ? "border-[var(--hold)]/25 bg-[var(--hold)]/5"
        : "border-[var(--buy)]/25 bg-[var(--buy)]/5";
  return (
    <div className={`rounded-xl border ${ring} p-5`}>
      <div
        className={`mb-3 font-mono text-[10px] uppercase tracking-[0.22em] ${color}`}
      >
        {title}
      </div>
      <ul className="space-y-1.5 text-[13px] leading-relaxed text-foreground/85">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1 text-muted-foreground/50">•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * DisagreementsBlock — renders the structured `{topic, claudeView,
 * gptView, geminiView}` disagreements from the supervisor schema.
 * Maps the model keys to lens labels (Quality / Momentum / Context)
 * to stay consistent with the rest of the marketing surface.
 */
function DisagreementsBlock({
  items,
}: {
  items: Array<{
    topic: string;
    claudeView: string;
    gptView: string;
    geminiView: string;
  }>;
}) {
  return (
    <div className="rounded-xl border border-[var(--hold)]/25 bg-[var(--hold)]/5 p-5">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--hold)]">
        Disagreements
      </div>
      <ul className="space-y-4 text-[13px] leading-relaxed text-foreground/85">
        {items.map((it, i) => (
          <li key={i} className="space-y-1.5">
            <div className="font-medium text-foreground">{it.topic}</div>
            <div className="grid gap-1.5 md:grid-cols-3">
              <LensLine lens="Quality" view={it.claudeView} />
              <LensLine lens="Momentum" view={it.gptView} />
              <LensLine lens="Context" view={it.geminiView} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LensLine({ lens, view }: { lens: string; view: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        {lens}
      </div>
      <div className="mt-0.5 text-[12px] text-foreground/85">{view}</div>
    </div>
  );
}

const WINDOW_LABEL: Record<PublicBriefWindow, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "365d": "1 year",
};

/**
 * Public retrospective card — appears below the verdict once any of the
 * four windows has been evaluated. Completed windows show the verdict
 * badge, percent move, and evaluated-at date. Pending windows are only
 * hinted at with a single "Outcomes resolve at 7d / 30d / 90d / 365d"
 * placeholder so the section doesn't look broken before any outcome
 * closes. The AGENTS.md track-record disclaimer is always rendered.
 */
function OutcomeRetrospective({
  call,
  priceAtRec,
  outcomes,
}: {
  call: string;
  priceAtRec: number | null;
  outcomes: PublicBriefOutcomeRow[];
}) {
  const completed = outcomes.filter((o) => o.status === "completed");

  return (
    <section className="border-t border-border py-14">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          <Clock className="h-3 w-3" />
          Outcome retrospective
        </div>
        <h2 className="font-heading text-[24px] leading-tight tracking-tight md:text-[30px]">
          How this call aged.
        </h2>

        {completed.length === 0 ? (
          <p className="mt-5 text-[14px] text-muted-foreground">
            Outcomes resolve at 7d / 30d / 90d / 365d. Check back after each
            window closes — each one is evaluated automatically against the
            ticker&rsquo;s actual price move.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["7d", "30d", "90d", "365d"] as PublicBriefWindow[]).map(
              (w) => {
                const row = outcomes.find((o) => o.window === w);
                return (
                  <OutcomeCard
                    key={w}
                    window={w}
                    call={call}
                    priceAtRec={priceAtRec}
                    row={row}
                  />
                );
              }
            )}
          </div>
        )}

        {/* Mandatory track-record disclaimer — AGENTS.md rule. Required
            on every track-record surface, non-negotiable. */}
        <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground/70">
          Past recommendation outcomes are informational only. Not a guarantee
          of future performance. Not investment advice.
        </p>
      </div>
    </section>
  );
}

function OutcomeCard({
  window: win,
  call,
  priceAtRec,
  row,
}: {
  window: PublicBriefWindow;
  call: string;
  priceAtRec: number | null;
  row: PublicBriefOutcomeRow | undefined;
}) {
  const label = WINDOW_LABEL[win];

  if (!row || row.status !== "completed" || !row.verdict) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/30 p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 text-[13px] text-muted-foreground/80">
          Pending — resolves on{" "}
          {row?.checkAt
            ? new Date(row.checkAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "schedule"}
          .
        </div>
      </div>
    );
  }

  const verdict = row.verdict;
  const verdictClass =
    verdict === "WIN"
      ? "border-[var(--buy)]/30 bg-[var(--buy)]/10 text-[var(--buy)]"
      : verdict === "LOSS"
        ? "border-[var(--sell)]/30 bg-[var(--sell)]/10 text-[var(--sell)]"
        : "border-[var(--hold)]/30 bg-[var(--hold)]/10 text-[var(--hold)]";

  const moveText =
    row.changePct != null
      ? `${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(2)}%`
      : "—";

  const evaluatedText = row.evaluatedAt
    ? new Date(row.evaluatedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </div>
        <span
          className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${verdictClass}`}
        >
          {verdict}
        </span>
      </div>
      <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Original call
      </div>
      <div className="text-[13px] text-foreground/85">
        {call}
        {priceAtRec != null && (
          <span className="text-muted-foreground">
            {" "}
            @ ${priceAtRec.toFixed(2)}
          </span>
        )}
      </div>
      <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Move
      </div>
      <div className="text-[13px] text-foreground/85">
        {moveText}
        {row.priceAtCheck != null && (
          <span className="text-muted-foreground">
            {" "}
            → ${row.priceAtCheck.toFixed(2)}
          </span>
        )}
      </div>
      {evaluatedText && (
        <div className="mt-3 text-[11px] text-muted-foreground/70">
          Evaluated {evaluatedText}
        </div>
      )}
    </div>
  );
}

// Reserved for future: "Similar briefs" / "Prior briefs on this ticker"
// rail. Leaving stubbed so the import exists when needed.
export const _unused = ArrowUpRight;
