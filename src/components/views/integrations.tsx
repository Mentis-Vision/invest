"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  CheckCircle2,
  AlertCircle,
  BookOpen,
  Landmark,
  LineChart,
  FileText,
  BarChart3,
  Newspaper,
  Database,
  Mail,
  Shield,
  Cpu,
  Server,
  Loader2,
} from "lucide-react";
import { getHoldings } from "@/lib/client/holdings-cache";

/**
 * Data & APIs page — full transparency on every data source that powers
 * ClearPath. Organized by role so users understand what's "always on"
 * versus what's linked to their account.
 *
 * Previously this page showed a small hardcoded list that included Plaid
 * (removed months ago) and omitted half the real sources. Fixed.
 */

type SourceCategory =
  | "always_on"
  | "optional"
  | "user_linked"
  | "ai_panel"
  | "infrastructure";

type Source = {
  name: string;
  role: string;
  description: string;
  docsUrl?: string;
  icon: React.ComponentType<{ className?: string }>;
  category: SourceCategory;
  /** Optional runtime status; when null we fall back to category default */
  status?: "active" | "linked" | "not_linked" | "optional" | "unknown";
  /** Optional status detail — freshness timestamp, username, etc. */
  detail?: string;
};

export default function IntegrationsView() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [institutions, setInstitutions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getHoldings()
      .then((d) => {
        if (!alive) return;
        setConnected(!!d.connected);
        setInstitutions(d.institutions ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const sources: Source[] = [
    // Always-on public data
    {
      name: "Yahoo Finance",
      role: "Quotes, charts, company snapshot",
      description:
        "Live and historical prices, 52-week ranges, quote-summary modules for valuation & analyst targets, calendar events.",
      docsUrl: "https://finance.yahoo.com",
      icon: LineChart,
      category: "always_on",
    },
    {
      name: "SEC EDGAR",
      role: "Regulatory filings & insider",
      description:
        "10-K/10-Q/8-K filings, Form 4 insider transactions, company facts. Official primary source — no intermediary.",
      docsUrl: "https://www.sec.gov/edgar",
      icon: FileText,
      category: "always_on",
    },
    {
      name: "FRED",
      role: "Macro indicators",
      description:
        "Federal Reserve Economic Data: Treasury yields, Fed Funds, CPI YoY, unemployment, VIX. Updates daily at release cadence.",
      docsUrl: "https://fred.stlouisfed.org",
      icon: BarChart3,
      category: "always_on",
    },
    {
      name: "Finnhub",
      role: "News headlines & sentiment",
      description:
        "Per-ticker news feed with bullish/bearish sentiment scoring. Optional — when unconfigured, news features degrade gracefully.",
      docsUrl: "https://finnhub.io",
      icon: Newspaper,
      category: "optional",
    },

    // User-linked
    {
      name: "SnapTrade",
      role: "Brokerage read-only",
      description:
        "Secure read-only access to holdings, positions, and trade history across 15+ brokerages (Coinbase, Robinhood, Fidelity, Schwab, etc.). You never share credentials — SnapTrade handles OAuth.",
      docsUrl: "https://snaptrade.com",
      icon: Landmark,
      category: "user_linked",
      status: loading ? "unknown" : connected ? "linked" : "not_linked",
      detail:
        !loading && connected && institutions.length > 0
          ? institutions.slice(0, 3).join(", ") +
            (institutions.length > 3 ? ` +${institutions.length - 3}` : "")
          : undefined,
    },

    // AI analyst panel — transparency
    {
      name: "Anthropic Claude",
      role: "Analyst · value lens",
      description:
        "Independent analyst with a value-investor lens. One of three AI models that analyze each research query in parallel.",
      docsUrl: "https://www.anthropic.com",
      icon: Cpu,
      category: "ai_panel",
    },
    {
      name: "OpenAI GPT",
      role: "Analyst · growth lens",
      description:
        "Independent analyst with a growth-investor lens. Runs in parallel with Claude and Gemini for cross-verification.",
      docsUrl: "https://openai.com",
      icon: Cpu,
      category: "ai_panel",
    },
    {
      name: "Google Vertex (Gemini)",
      role: "Analyst · macro lens",
      description:
        "Independent analyst with a macro-aware lens. Third member of the panel; supervisor compares all three verdicts.",
      docsUrl: "https://cloud.google.com/vertex-ai",
      icon: Cpu,
      category: "ai_panel",
    },

    // Infrastructure — lower priority but mentioned for transparency
    {
      name: "Neon Postgres",
      role: "Database",
      description:
        "Your holdings, research history, alerts, and the nightly warehouse all live in a serverless Neon Postgres instance. Backups: 7-day PITR.",
      docsUrl: "https://neon.tech",
      icon: Database,
      category: "infrastructure",
    },
    {
      name: "Vercel",
      role: "Hosting & cron",
      description:
        "Serverless compute, nightly cron jobs, CDN. Fluid Compute keeps cold starts negligible.",
      docsUrl: "https://vercel.com",
      icon: Server,
      category: "infrastructure",
    },
    {
      name: "Resend",
      role: "Transactional email",
      description:
        "Verification emails, password reset, receipts. Domain-verified for clearpathinvest.app.",
      docsUrl: "https://resend.com",
      icon: Mail,
      category: "infrastructure",
    },
    {
      name: "BetterAuth + Google OAuth",
      role: "Authentication",
      description:
        "Session management, email/password, Google sign-in. Sessions stored in Neon; no third-party session provider.",
      docsUrl: "https://www.better-auth.com",
      icon: Shield,
      category: "infrastructure",
    },
  ];

  const grouped: Record<SourceCategory, Source[]> = {
    always_on: [],
    optional: [],
    user_linked: [],
    ai_panel: [],
    infrastructure: [],
  };
  for (const s of sources) grouped[s.category].push(s);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-serif text-3xl tracking-tight text-[var(--foreground)]">
          Data &amp; sources
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Every signal that touches your research — public feeds we pull on
          your behalf, brokerages you link, the AI analyst panel, and the
          infrastructure underneath.
        </p>
      </div>

      <Group
        title="Always on"
        description="Public data we pull automatically — no setup, no credentials from you."
      >
        {grouped.always_on.map((s) => (
          <SourceCard key={s.name} s={s} />
        ))}
      </Group>

      {grouped.optional.length > 0 && (
        <Group
          title="Optional"
          description="Wired in when the operator configures the API key — feature degrades gracefully when absent."
        >
          {grouped.optional.map((s) => (
            <SourceCard key={s.name} s={s} />
          ))}
        </Group>
      )}

      <Group
        title="Your linked accounts"
        description="Read-only connections to your brokerages. You control them from here."
        action={
          <Link
            href="/app?view=portfolio"
            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline underline-offset-4"
          >
            Manage connections →
          </Link>
        }
      >
        {grouped.user_linked.map((s) => (
          <SourceCard key={s.name} s={s} />
        ))}
      </Group>

      <Group
        title="AI analyst panel"
        description="Three independent models cross-verify every research call. Disagreement between them is reported — it's often the most informative outcome."
      >
        {grouped.ai_panel.map((s) => (
          <SourceCard key={s.name} s={s} />
        ))}
      </Group>

      <Group
        title="Platform infrastructure"
        description="The pipes. Listed for transparency — you don't configure these."
      >
        {grouped.infrastructure.map((s) => (
          <SourceCard key={s.name} s={s} />
        ))}
      </Group>

      <Card className="border-[var(--hold)]/30 bg-[var(--hold)]/5">
        <CardContent className="flex items-start gap-3 py-3 text-xs">
          <BookOpen className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--hold)]" />
          <div className="text-[var(--muted-foreground)]">
            ClearPath is informational only — we don&rsquo;t execute trades,
            don&rsquo;t hold custody of funds, and don&rsquo;t receive
            brokerage credentials. Every data source listed above is audited
            in our{" "}
            <Link
              href="/disclosures"
              className="underline underline-offset-4 hover:text-[var(--foreground)]"
            >
              disclosures
            </Link>
            .
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Group({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between border-b border-[var(--border)] pb-2">
        <div>
          <h3 className="font-serif text-lg tracking-tight text-[var(--foreground)]">
            {title}
          </h3>
          {description && (
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {description}
            </p>
          )}
        </div>
        {action}
      </header>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function SourceCard({ s }: { s: Source }) {
  const Icon = s.icon;
  const status = s.status ?? (s.category === "optional" ? "optional" : "active");

  const StatusBadge = () => {
    if (status === "linked") {
      return (
        <Badge className="gap-1 bg-[var(--buy)]/15 text-[var(--buy)] border-[var(--buy)]/30">
          <CheckCircle2 className="h-3 w-3" />
          Linked
        </Badge>
      );
    }
    if (status === "not_linked") {
      return (
        <Badge
          variant="outline"
          className="gap-1 text-[var(--muted-foreground)]"
        >
          <AlertCircle className="h-3 w-3" />
          Not linked
        </Badge>
      );
    }
    if (status === "optional") {
      return (
        <Badge variant="outline" className="text-[var(--muted-foreground)]">
          Optional
        </Badge>
      );
    }
    if (status === "unknown") {
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          checking
        </Badge>
      );
    }
    return (
      <Badge className="gap-1 bg-[var(--buy)]/15 text-[var(--buy)] border-[var(--buy)]/30">
        <CheckCircle2 className="h-3 w-3" />
        Active
      </Badge>
    );
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Icon className="h-4 w-4 text-[var(--muted-foreground)]" />
            {s.name}
          </CardTitle>
          <StatusBadge />
        </div>
        <p className="mt-0.5 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
          {s.role}
        </p>
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
          {s.description}
        </p>
        {s.detail && (
          <p className="mt-1.5 text-[11px] font-mono text-[var(--foreground)]/80">
            {s.detail}
          </p>
        )}
        {s.docsUrl && (
          <a
            href={s.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline underline-offset-4"
          >
            Docs ↗
          </a>
        )}
      </CardContent>
    </Card>
  );
}
