import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";
import {
  Lock,
  ShieldCheck,
  KeyRound,
  Database,
  AlertOctagon,
  Eye,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Security — ClearPath Invest",
  description:
    "How we protect your data: encryption, access controls, MFA, incident response, and our sub-processor program.",
};

export default function SecurityPage() {
  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight">
          Security
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated: 2026-04-19
        </p>

        <p className="mt-6 text-[17px] leading-relaxed text-foreground/90">
          Your account holds things that matter — your portfolio, your
          research, your journal. Here&rsquo;s how we protect it.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Tile
            icon={Lock}
            title="Encryption everywhere"
            body="HTTPS for every request. AES-256 encryption at rest in our database. Brokerage secrets encrypted with AES-256-GCM at the application layer — they're unusable even if the database is ever compromised."
          />
          <Tile
            icon={KeyRound}
            title="Optional two-factor authentication"
            body="Enroll in TOTP-based 2FA from Account Settings. Works with any authenticator app (Google Authenticator, Authy, 1Password, Bitwarden)."
          />
          <Tile
            icon={ShieldCheck}
            title="Read-only brokerage access"
            body="We cannot trade on your behalf. We cannot move money. Plaid (our primary connector) and SnapTrade (used only where Plaid doesn't cover your broker) both enforce read-only scopes at the brokerage level. Even if our servers were breached, there's no trade path."
          />
          <Tile
            icon={Database}
            title="No data selling, no AI training on your data"
            body="Your portfolio, research queries, and journal notes are never sold, never shared with advertisers, never used to train AI models — ours or our providers'."
          />
          <Tile
            icon={Eye}
            title="Minimum data by design"
            body="Plaid scope is limited to Investments — we never see your bank accounts, credit cards, or loan data. SnapTrade access is per-user-secret with no account credentials on our servers."
          />
          <Tile
            icon={AlertOctagon}
            title="72-hour breach notification"
            body="If a breach ever affects your data, we notify you by email within 72 hours of confirmed material impact. We also commit to a full written post-mortem within 7 days."
          />
        </div>

        <div className="mt-12 rounded-lg border border-border bg-secondary/30 p-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-medium">
            The full technical policy
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Our complete information-security program — access control,
            key management, sub-processor vetting, incident response,
            retention, and compliance posture — is documented in our
            Information Security Policy. It&rsquo;s the reference
            Plaid, SnapTrade, and Resend use during due diligence, and
            it&rsquo;s public.
          </p>
          <p className="mt-4">
            <a
              href="https://github.com/Mentis-Vision/invest/blob/main/docs/security/info-sec-policy.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background hover:bg-foreground/85"
            >
              Read the full policy →
            </a>
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Hosted under our parent company&rsquo;s engineering org (Mentis
            Vision) for version control.
          </p>
        </div>

        <div className="mt-12">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-medium">
            Report a security issue
          </h2>
          <p className="mt-2 text-sm leading-relaxed">
            If you&rsquo;ve found a security vulnerability, please email{" "}
            <a
              href="mailto:security@clearpathinvest.app"
              className="underline underline-offset-4"
            >
              security@clearpathinvest.app
            </a>
            . Acknowledged within 24 hours. We&rsquo;re a small team but we
            take reports seriously — good-faith disclosure gets a
            thank-you and a commit in the changelog.
          </p>
        </div>

        <div className="mt-12 text-sm text-muted-foreground">
          See also:{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          {" · "}
          <Link href="/terms" className="underline">
            Terms
          </Link>
          {" · "}
          <Link href="/disclosures" className="underline">
            Disclosures
          </Link>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}

function Tile({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Lock;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <Icon className="h-5 w-5 text-primary" />
      <h3 className="mt-3 text-[15px] font-semibold tracking-tight">
        {title}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
