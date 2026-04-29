import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import { ArrowRight, ShieldCheck } from "lucide-react";
import {
  getPublicTrackRecord,
  type PublicTrackRecord,
} from "@/lib/public-track-record";

/**
 * /track-record — public transparency page.
 *
 * Publishes aggregate hit-rate and confidence-calibration stats across
 * all beta users' evaluated 30-day outcomes. Zero PII — strictly
 * aggregate counts and percentages.
 *
 * Nobody in the space publishes their misses. That's the wedge here:
 * pure transparency is the product story, and this page is the proof.
 *
 * Revalidates every 6 hours — outcomes resolve nightly so faster
 * refresh is wasted work.
 */

export const revalidate = 21600;

export const metadata: Metadata = {
  title: "Public track record",
  description:
    "ClearPath Invest's public 30-day hit rate, confidence calibration, and outcome distribution. Wins and losses, both published. Aggregate stats only — no user data.",
  alternates: { canonical: "/track-record" },
  openGraph: {
    title: "Public track record — ClearPath Invest",
    description:
      "30-day hit rate, confidence calibration, and outcome distribution. We publish our misses too.",
    url: "/track-record",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClearPath Invest — Public track record",
    description:
      "We publish our hit rate and our misses. Aggregate stats, no user data.",
  },
};

export default async function TrackRecordPage() {
  const tr = await getPublicTrackRecord(30);

  // Pre-beta state: no closed outcomes yet. Render the methodology page
  // transparently rather than showing misleading zeroes as if they were
  // performance stats.
  const hasData = tr.evaluated > 0;

  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Public track record · {tr.windowDays}-day window
          </div>
          <h1 className="font-heading text-[44px] leading-[1.05] tracking-tight md:text-[60px]">
            We publish our{" "}
            <em className="italic text-[var(--buy)]">misses</em> too.
          </h1>
          <p className="mx-auto mt-6 max-w-[640px] text-[17px] leading-relaxed text-muted-foreground">
            Every brief ClearPath issues is evaluated against the ticker&rsquo;s
            actual price movement on a 7d / 30d / 90d / 365d schedule. The
            stats below are aggregate across all early-access members —
            no userId, no individual briefs, just the honest win / loss
            / flat distribution.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-5xl px-6">
          {hasData ? (
            <HasDataView tr={tr} />
          ) : (
            <NoDataYetView tr={tr} />
          )}
        </div>
      </section>

      <MethodologySection />

      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="font-heading text-[30px] leading-tight tracking-tight md:text-[38px]">
            See a live brief.
          </h2>
          <p className="mx-auto mt-3 max-w-[500px] text-[15px] leading-relaxed text-muted-foreground">
            Run a three-lens analysis on any US equity. Free 30-day trial,
            no credit card. Every claim traces to its source.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href="/sign-up?src=track-record"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background transition-colors hover:bg-foreground/85"
            >
              Start your free trial
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-5 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:border-primary/40"
            >
              How it works
            </Link>
          </div>
          <p className="mt-6 text-[11px] text-muted-foreground/70">
            Past outcomes are informational only. Not a guarantee of future
            performance. Not investment advice.
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

// ── data views ──────────────────────────────────────────────────────

function HasDataView({ tr }: { tr: PublicTrackRecord }) {
  return (
    <div className="space-y-10">
      {/* Hero stat row */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Briefs issued"
          value={tr.totalBriefs.toLocaleString()}
          sub={`Last ${tr.windowDays}d`}
        />
        <StatCard
          label="Evaluated"
          value={tr.evaluated.toLocaleString()}
          sub="30d-window resolved"
        />
        <StatCard
          label="Overall hit rate"
          value={tr.hitRate.overall == null ? "—" : `${tr.hitRate.overall}%`}
          sub="Wins ÷ evaluated"
          tone="primary"
        />
        <StatCard
          label="Outcomes"
          value={`${tr.outcomes.wins}W · ${tr.outcomes.losses}L · ${tr.outcomes.flats}F`}
          sub="Wins / losses / flats"
        />
      </div>

      {/* Hit rate by call */}
      <div className="rounded-xl border border-border bg-card p-6 md:p-8">
        <div className="mb-5 flex items-center gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Hit rate by recommendation type
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <CallRateTile
            call="BUY"
            rate={tr.hitRate.buy}
            count={tr.byCall.buy}
            tone="buy"
          />
          <CallRateTile
            call="HOLD"
            rate={tr.hitRate.hold}
            count={tr.byCall.hold}
            tone="hold"
          />
          <CallRateTile
            call="SELL"
            rate={tr.hitRate.sell}
            count={tr.byCall.sell}
            tone="sell"
          />
        </div>
      </div>

      {/* Confidence calibration — the interesting stat */}
      <div className="rounded-xl border border-border bg-card p-6 md:p-8">
        <div className="mb-5">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Confidence calibration
          </div>
          <h2 className="font-heading text-[22px] leading-tight tracking-tight">
            Are HIGH-confidence calls actually better?
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            If our calibration works, HIGH-confidence briefs should outperform
            LOW-confidence ones. If they don&rsquo;t, we&rsquo;re posting it
            here anyway — that&rsquo;s the promise.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <ConfidenceTile bucket="HIGH" data={tr.byConfidence.high} />
          <ConfidenceTile bucket="MEDIUM" data={tr.byConfidence.medium} />
          <ConfidenceTile bucket="LOW" data={tr.byConfidence.low} />
        </div>
      </div>

      {tr.benchmark && (
        <div className="rounded-xl border border-border bg-card p-6 md:p-8">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Benchmark context
          </div>
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="rounded-md border border-border bg-background/60 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Avg alpha vs {tr.benchmark.benchmarkTicker}
              </div>
              <div className="mt-2 font-heading text-[26px] leading-none tracking-tight">
                {tr.benchmark.averageAlphaPct == null
                  ? "—"
                  : `${tr.benchmark.averageAlphaPct > 0 ? "+" : ""}${tr.benchmark.averageAlphaPct}%`}
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">
                {tr.benchmark.evaluated.toLocaleString()} benchmarked
              </div>
            </div>
            <p className="self-center text-[13px] leading-relaxed text-muted-foreground">
              {tr.benchmark.note} Benchmark comparison is backward-looking
              context, not a forecast or promise.
            </p>
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-muted-foreground/70">
        Stats as of {new Date(tr.asOf).toLocaleString()}. Aggregate only.
        No individual briefs, tickers, or user data are surfaced on this
        page.
      </p>
    </div>
  );
}

function NoDataYetView({ tr }: { tr: PublicTrackRecord }) {
  return (
    <div className="rounded-xl border border-border bg-card p-8 text-center md:p-12">
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--buy)]/10">
        <ShieldCheck className="h-5 w-5 text-[var(--buy)]" />
      </div>
      <h2 className="font-heading text-[28px] leading-tight tracking-tight md:text-[34px]">
        Priming.
      </h2>
      <p className="mx-auto mt-3 max-w-[560px] text-[15px] leading-relaxed text-muted-foreground">
        ClearPath is in early access. The first 30-day outcomes resolve on a
        rolling basis — this page will publish real hit-rate and calibration
        stats as soon as the first window closes.{" "}
        {tr.totalBriefs > 0 && (
          <>
            <strong className="text-foreground">
              {tr.totalBriefs.toLocaleString()} briefs
            </strong>{" "}
            issued in the last {tr.windowDays} days, none yet at the 30-day
            outcome mark.
          </>
        )}
      </p>
      <p className="mx-auto mt-5 max-w-[520px] text-[13px] leading-relaxed text-muted-foreground/80">
        When it goes live, this page will show: hit rate by BUY / HOLD /
        SELL; whether HIGH-confidence calls outperform LOW; and the raw
        win / loss / flat distribution. Misses published, same as wins.
      </p>
    </div>
  );
}

function MethodologySection() {
  return (
    <section className="border-t border-border bg-secondary/20 py-16">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-8">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Methodology
          </div>
          <h2 className="font-heading text-[28px] leading-tight tracking-tight md:text-[36px]">
            How we score outcomes.
          </h2>
        </div>

        <div className="space-y-6 text-[15px] leading-relaxed text-foreground/85">
          <div>
            <h3 className="font-heading text-[18px]">1. Windows</h3>
            <p className="mt-1 text-muted-foreground">
              Every brief is evaluated on four windows: 7 days, 30 days, 90
              days, and 365 days. The 30-day column is what we highlight
              here — it&rsquo;s the shortest window that survives
              single-session noise.
            </p>
          </div>

          <div>
            <h3 className="font-heading text-[18px]">2. Win / loss / flat</h3>
            <p className="mt-1 text-muted-foreground">
              A BUY wins if the ticker closes higher than the price at the
              time of the brief by more than the neutral threshold. SELL is
              the mirror. HOLD wins when the ticker stays within a narrow
              band. Flat is an outcome inside the neutral zone. Benchmark
              comparison is shown separately when SPY data is available.
            </p>
          </div>

          <div>
            <h3 className="font-heading text-[18px]">
              3. Confidence calibration
            </h3>
            <p className="mt-1 text-muted-foreground">
              Every brief carries HIGH / MEDIUM / LOW confidence. If the
              three-lens consensus is unanimous, we keep the confidence the
              supervisor assigns. Split decisions get downgraded. A
              well-calibrated system shows HIGH outperforming LOW over
              enough evaluated briefs — if ours doesn&rsquo;t, the chart above
              makes that visible.
            </p>
          </div>

          <div>
            <h3 className="font-heading text-[18px]">4. Aggregate only</h3>
            <p className="mt-1 text-muted-foreground">
              All stats are summed across every member&rsquo;s evaluated
              briefs. We never publish individual briefs, tickers, or user
              identifiers here. The underlying warehouse tables are
              ticker-keyed and hold no userId — that privacy constraint is
              enforced at the schema level.
            </p>
          </div>

          <div>
            <h3 className="font-heading text-[18px]">5. Refresh cadence</h3>
            <p className="mt-1 text-muted-foreground">
              Outcomes resolve via a nightly cron job. This page
              re-queries the aggregates every six hours. Stats are a
              snapshot of that most-recent window.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── tiles ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "primary";
}) {
  const ring =
    tone === "primary"
      ? "border-[var(--buy)]/30 bg-[var(--buy)]/5"
      : "border-border bg-card";
  const textColor =
    tone === "primary" ? "text-[var(--buy)]" : "text-foreground";
  return (
    <div className={`rounded-xl border ${ring} p-5`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-2 font-heading text-[28px] leading-none tracking-tight ${textColor}`}
      >
        {value}
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground/85">{sub}</div>
    </div>
  );
}

function CallRateTile({
  call,
  rate,
  count,
  tone,
}: {
  call: "BUY" | "HOLD" | "SELL";
  rate: number | null;
  count: number;
  tone: "buy" | "hold" | "sell";
}) {
  const color =
    tone === "buy"
      ? "text-[var(--buy)]"
      : tone === "sell"
        ? "text-[var(--sell)]"
        : "text-[var(--hold)]";
  return (
    <div className="rounded-md border border-border bg-background/60 p-4">
      <div className={`font-mono text-[11px] uppercase tracking-[0.18em] ${color}`}>
        {call}
      </div>
      <div className="mt-2 font-heading text-[26px] leading-none tracking-tight">
        {rate == null ? "—" : `${rate}%`}
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        {count.toLocaleString()} issued
      </div>
    </div>
  );
}

function ConfidenceTile({
  bucket,
  data,
}: {
  bucket: "HIGH" | "MEDIUM" | "LOW";
  data: { evaluated: number; winRate: number | null };
}) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {bucket} confidence
      </div>
      <div className="mt-2 font-heading text-[26px] leading-none tracking-tight">
        {data.winRate == null ? "—" : `${data.winRate}%`}
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        {data.evaluated.toLocaleString()} evaluated
      </div>
    </div>
  );
}
