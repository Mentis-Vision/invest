"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  AlertCircle,
  Landmark,
  Loader2,
  Settings,
  Bell,
  Download,
  KeyRound,
  Mail,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { getHoldings } from "@/lib/client/holdings-cache";

/**
 * Account & connections — the admin hub.
 *
 * Stripped down from the previous "Data & APIs" listing. The data-source
 * transparency that used to live here (Yahoo / SEC / FRED / Finnhub /
 * AI panel / infrastructure cards) was removed at user request — those
 * are platform implementation details, not user-facing controls.
 *
 * What lives here now:
 *   - Linked brokerage accounts (compact)
 *   - Account info (email, tier, password)
 *   - Notification preferences
 *   - Data export / delete
 *   - Support links
 */

type LinkedAccount = {
  institution: string;
  positions: number;
  status: "linked" | "not_linked" | "unknown";
};

export default function IntegrationsView() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getHoldings()
      .then((d) => {
        if (!alive) return;
        setConnected(!!d.connected);
        const counts: Record<string, number> = {};
        for (const h of d.holdings ?? []) {
          const inst =
            h.institutionName ?? h.accountName ?? "Linked account";
          counts[inst] = (counts[inst] ?? 0) + 1;
        }
        const next: LinkedAccount[] = Object.entries(counts).map(
          ([institution, positions]) => ({
            institution,
            positions,
            status: "linked",
          })
        );
        setAccounts(next);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Account
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Manage your linked brokerages, preferences, and data.
        </p>
      </div>

      <Section
        title="Linked accounts"
        description="Brokerages we sync read-only. Add a new connection any time."
        action={
          <Link
            href="/app?view=portfolio"
            className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline underline-offset-4"
          >
            Manage from Portfolio
            <ExternalLink className="h-3 w-3" />
          </Link>
        }
      >
        {loading ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {[...Array(2)].map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-md border border-[var(--border)] bg-[var(--secondary)]/40"
              />
            ))}
          </div>
        ) : connected && accounts.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {accounts.map((a) => (
              <CompactCard
                key={a.institution}
                title={a.institution}
                subtitle={`${a.positions} position${a.positions === 1 ? "" : "s"}`}
                icon={Landmark}
                status="linked"
              />
            ))}
            <Link
              href="/app?view=portfolio"
              className="flex h-full items-center justify-center rounded-md border border-dashed border-[var(--border)] bg-[var(--background)] px-3 py-3 text-xs text-[var(--muted-foreground)] hover:border-[var(--foreground)]/30 hover:text-[var(--foreground)]"
            >
              + Link another account
            </Link>
          </div>
        ) : (
          <CompactCard
            title="No accounts linked yet"
            subtitle="Link a brokerage to sync holdings, trades, and balances."
            icon={Landmark}
            status="not_linked"
            action={
              <Link
                href="/app?view=portfolio"
                className="inline-flex items-center rounded-md bg-[var(--buy)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90"
              >
                Link an account
              </Link>
            }
          />
        )}
      </Section>

      <Section
        title="Account"
        description="Profile, password, and preferences."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          <AdminTile
            href="/app/settings"
            icon={Settings}
            title="Profile & preferences"
            subtitle="Risk, horizon, dashboard density"
          />
          <AdminTile
            href="/forgot-password"
            icon={KeyRound}
            title="Change password"
            subtitle="Email-based reset"
          />
          <AdminTile
            icon={Bell}
            title="Notification preferences"
            subtitle="Soon — alert + brief delivery"
            disabled
          />
        </div>
      </Section>

      <Section
        title="Data & privacy"
        description="Export everything we have on you, or delete your account."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <AdminTile
            icon={Download}
            title="Export your data"
            subtitle="Soon — JSON download of holdings + research history"
            disabled
          />
          <AdminTile
            icon={Trash2}
            title="Delete account"
            subtitle="Soon — permanent removal + 30-day grace"
            disabled
            destructive
          />
        </div>
      </Section>

      <Section title="Support" description="Reach us when you need to.">
        <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <p className="text-[var(--muted-foreground)]">
            Questions, issues, or feedback?{" "}
            <a
              href="mailto:hello@clearpathinvest.app"
              className="text-[var(--foreground)] underline underline-offset-4 hover:text-[var(--buy)]"
            >
              hello@clearpathinvest.app
            </a>
          </p>
          <div className="mt-3 flex gap-3 text-xs text-[var(--muted-foreground)]">
            <Link
              href="/disclosures"
              className="underline underline-offset-4 hover:text-[var(--foreground)]"
            >
              Disclosures
            </Link>
            <Link
              href="/terms"
              className="underline underline-offset-4 hover:text-[var(--foreground)]"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="underline underline-offset-4 hover:text-[var(--foreground)]"
            >
              Privacy
            </Link>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between border-b border-[var(--border)] pb-2">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-[var(--foreground)]">
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
      {children}
    </section>
  );
}

function CompactCard({
  title,
  subtitle,
  icon: Icon,
  status,
  action,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  status: "linked" | "not_linked" | "unknown";
  action?: ReactNode;
}) {
  const StatusBadge = () => {
    if (status === "linked")
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--buy)]">
          <CheckCircle2 className="h-3 w-3" /> Linked
        </span>
      );
    if (status === "not_linked")
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
          <AlertCircle className="h-3 w-3" /> Not linked
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--foreground)]">
            {title}
          </div>
          <div className="truncate text-[11px] text-[var(--muted-foreground)]">
            {subtitle}
          </div>
        </div>
      </div>
      <div className="shrink-0">{action ?? <StatusBadge />}</div>
    </div>
  );
}

function AdminTile({
  href,
  icon: Icon,
  title,
  subtitle,
  disabled,
  destructive,
}: {
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const cls = `flex items-start gap-2.5 rounded-md border border-[var(--border)] bg-[var(--card)] p-3 transition-colors ${
    disabled
      ? "opacity-60"
      : destructive
        ? "hover:border-[var(--sell)]/40 hover:bg-[var(--sell)]/5"
        : "hover:border-[var(--foreground)]/30 hover:bg-[var(--secondary)]/40"
  }`;
  const inner = (
    <>
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          destructive
            ? "text-[var(--sell)]"
            : "text-[var(--muted-foreground)]"
        }`}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--foreground)]">
          {title}
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
          {subtitle}
        </div>
      </div>
    </>
  );
  if (disabled || !href) {
    return <div className={cls}>{inner}</div>;
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}
