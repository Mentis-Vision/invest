import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/marketing/nav";
import MarketingFooter from "@/components/marketing/footer";

export const metadata: Metadata = {
  title: "Privacy Policy — ClearPath Invest",
  description:
    "How ClearPath Invest collects, uses, protects, and shares your information.",
};

export default function PrivacyPage() {
  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
        <div className="mb-8 rounded-md border border-[var(--hold)]/40 bg-[var(--hold)]/5 p-4 text-sm">
          <p className="font-medium">Draft for attorney review.</p>
          <p className="mt-1 text-muted-foreground">
            This policy reflects our intended privacy practices but has not
            been finalized by licensed counsel. It should be reviewed by a
            qualified attorney, particularly for GDPR/CCPA compliance, before
            ClearPath Invest accepts paying customers.
          </p>
        </div>

        <h1 className="font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Effective date: 2026-04-15. Last updated: 2026-04-15.
        </p>

        <div className="prose prose-sm mt-10 max-w-none leading-relaxed dark:prose-invert [&_h2]:mt-10 [&_h2]:font-[family-name:var(--font-display)] [&_h2]:text-2xl [&_h2]:font-medium [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_p]:mt-3 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mt-1">
          <h2>1. Our principles</h2>
          <p>
            We collect the minimum information needed to run the Service and
            we do not sell or rent your personal data. Specifically:
          </p>
          <ul>
            <li>
              <strong>We do not sell your data.</strong> Not to advertisers,
              not to data brokers, not to &ldquo;partners.&rdquo;
            </li>
            <li>
              <strong>We do not train AI models on your personal data.</strong>{" "}
              Your portfolios, queries, and research history are not used to
              train any model, ours or our providers&apos;.
            </li>
            <li>
              <strong>We do not share your data with third parties for
              marketing purposes.</strong>
            </li>
            <li>
              <strong>Brokerage access is read-only.</strong> We cannot and do
              not initiate trades or move money.
            </li>
          </ul>

          <h2>2. Information we collect</h2>
          <h3>a. You provide directly</h3>
          <ul>
            <li>Email address, name, and password (hashed) on sign-up.</li>
            <li>
              Waitlist entries (email, optional name and portfolio size).
            </li>
            <li>
              Profile preferences: risk tolerance, goals, horizon (optional).
            </li>
            <li>
              Research queries (tickers you analyze) and portfolio review
              requests.
            </li>
          </ul>
          <h3>b. Automatically collected</h3>
          <ul>
            <li>
              IP address, browser/user-agent, device type — for security, rate
              limiting, and abuse prevention.
            </li>
            <li>
              Session cookies — to keep you signed in. We do not use
              third-party tracking or advertising cookies.
            </li>
            <li>
              Rate-limit counters keyed by user ID and IP.
            </li>
            <li>
              Usage counters (token consumption, estimated spend, query
              volume) for plan-limit enforcement.
            </li>
          </ul>
          <h3>c. From brokerage integrations (if you link)</h3>
          <ul>
            <li>
              Via SnapTrade: account balances, holdings, positions, and
              transactions.
            </li>
            <li>
              We never receive your brokerage login credentials. SnapTrade
              holds the authorization on your behalf; we store an encrypted
              user secret that lets us query your data.
            </li>
          </ul>
          <h3>d. From AI providers</h3>
          <ul>
            <li>
              We send prompt content (including your queried ticker and the
              verified public data block) to Anthropic, OpenAI, and Google
              Cloud for inference. We do not send your email, name, or other
              identifiers in these prompts.
            </li>
          </ul>

          <h2>3. How we use your information</h2>
          <ul>
            <li>
              To operate the Service — authentication, running analyses,
              syncing holdings, rendering the UI.
            </li>
            <li>
              To protect the Service — rate limiting, abuse detection, fraud
              prevention.
            </li>
            <li>
              To enforce usage caps — stopping a user from accidentally running
              up a large AI bill.
            </li>
            <li>
              To maintain a personal track record — every recommendation is
              stored so we can show you how our past calls played out.
            </li>
            <li>
              To contact you about your account, security issues, or
              material Service changes.
            </li>
            <li>To comply with law and respond to valid legal process.</li>
          </ul>

          <h2>4. Sub-processors we rely on</h2>
          <p>
            We share information with the following processors solely to run
            the Service:
          </p>
          <ul>
            <li>
              <strong>Neon</strong> — Postgres database hosting.
            </li>
            <li>
              <strong>Vercel</strong> — web hosting, serverless compute, logs.
            </li>
            <li>
              <strong>Anthropic</strong> — Claude model inference.
            </li>
            <li>
              <strong>OpenAI</strong> — GPT model inference.
            </li>
            <li>
              <strong>Google Cloud (Vertex AI)</strong> — Gemini model
              inference.
            </li>
            <li>
              <strong>SnapTrade</strong> — brokerage account linking and data.
            </li>
            <li>
              <strong>Resend</strong> — transactional email (verification,
              password reset).
            </li>
            <li>
              <strong>SEC, FRED, Yahoo Finance</strong> — public data sources.
              These providers do not receive identifying information from us.
            </li>
          </ul>
          <p>
            Each processor&apos;s own privacy policy governs how they handle
            data on our behalf.
          </p>

          <h2>5. Security</h2>
          <ul>
            <li>Encrypted connections (HTTPS) for all traffic.</li>
            <li>
              Passwords are hashed using industry-standard algorithms (Better
              Auth default: scrypt).
            </li>
            <li>
              Brokerage user secrets are encrypted at rest using AES-256-GCM.
            </li>
            <li>Rate limiting and authentication on all sensitive endpoints.</li>
            <li>
              Access to production data is limited to authorized engineering
              staff.
            </li>
          </ul>
          <p>
            No system is perfectly secure. In the event of a breach that
            affects your information, we will notify you as required by
            applicable law.
          </p>

          <h2>6. Retention</h2>
          <ul>
            <li>
              Account data is retained for as long as your account is active.
            </li>
            <li>
              Recommendations and outcome history are retained indefinitely
              (they are the core track-record product). You can request
              deletion (see §10).
            </li>
            <li>
              Logs (server, rate-limit buckets) are retained for no more than
              90 days.
            </li>
            <li>
              Inactive accounts may be purged after 24 months of inactivity
              following a notice email.
            </li>
          </ul>

          <h2>7. Cookies</h2>
          <p>
            We use only essential cookies needed for session management and
            security. We do not use third-party advertising, analytics, or
            fingerprinting cookies. By default we respect &ldquo;Do Not
            Track&rdquo; signals.
          </p>

          <h2>8. Children</h2>
          <p>
            The Service is not directed to individuals under 18. We do not
            knowingly collect personal information from children. If you
            believe a minor has provided information, contact us and we will
            delete it.
          </p>

          <h2>9. International users</h2>
          <p>
            The Service is hosted in the United States. If you access it from
            outside the U.S., you consent to the transfer of your information
            to the U.S. for processing as described in this Policy. We do not
            currently offer the Service in the European Economic Area or the
            United Kingdom in a manner targeting residents there.
          </p>

          <h2>10. Your rights</h2>
          <p>You have the right to:</p>
          <ul>
            <li>
              <strong>Access</strong> — request a copy of the personal data we
              hold.
            </li>
            <li>
              <strong>Correction</strong> — ask us to correct inaccurate data.
            </li>
            <li>
              <strong>Deletion</strong> — ask us to delete your account and
              associated personal data (subject to limited retention for legal
              or fraud-prevention reasons).
            </li>
            <li>
              <strong>Export</strong> — receive a machine-readable export of
              your portfolio, history, and preferences.
            </li>
            <li>
              <strong>Opt-out of marketing</strong> — at any time via the
              unsubscribe link in any email.
            </li>
          </ul>
          <p>
            Exercise any of these rights by emailing{" "}
            <a href="mailto:privacy@clearpath-invest.com" className="underline">
              privacy@clearpath-invest.com
            </a>
            .
          </p>

          <h2>11. California residents (CCPA)</h2>
          <p>
            California residents may request (a) the categories and specific
            pieces of personal information we have collected about them, (b)
            the categories of sources, (c) the business purposes for
            collection, and (d) the categories of third parties with whom we
            share. We do not sell personal information. California residents
            may also ask us to delete personal information, subject to legal
            exceptions.
          </p>

          <h2>12. Changes</h2>
          <p>
            We may update this Policy. If changes are material, we will notify
            you by email or via the Service. The date at the top reflects the
            most recent update.
          </p>

          <h2>13. Contact</h2>
          <p>
            Questions?{" "}
            <a href="mailto:privacy@clearpath-invest.com" className="underline">
              privacy@clearpath-invest.com
            </a>
            . See also our{" "}
            <Link href="/terms" className="underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/disclosures" className="underline">
              Disclosures
            </Link>
            .
          </p>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}
