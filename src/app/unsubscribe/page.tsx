/**
 * Landing page for the List-Unsubscribe header URL.
 *
 * Why this page exists at all:
 *   Major mail providers (Gmail / Yahoo / Outlook) downrank senders that
 *   ship the `List-Unsubscribe` header pointing at a 404. The header is
 *   on every transactional email we send (see src/lib/email.ts). This
 *   page makes it real.
 *
 * Why it's mostly informational:
 *   We don't send marketing email — only password resets, verification,
 *   and one day account-activity alerts. Those are essential to a user
 *   account and can't be opted out of without deleting the account.
 *   So the page explains that and points to account deletion / settings.
 *
 *   When we add genuine optional notifications (weekly digest, etc.)
 *   we'll switch this to a real preference toggle keyed by the `to`
 *   query param. For now, an honest explanation beats a fake checkbox.
 */

import Link from "next/link";

export const metadata = {
  title: "Unsubscribe — ClearPath Invest",
  description:
    "Email preferences for ClearPath Invest. Manage which messages you receive.",
};

export default async function UnsubscribePage(props: {
  searchParams: Promise<{ to?: string }>;
}) {
  const { to } = await props.searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
          ClearPath Invest
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          Email preferences
        </h1>
        {to && (
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            For: <span className="font-mono">{to}</span>
          </p>
        )}

        <div className="mt-6 space-y-4 text-sm leading-relaxed text-[var(--foreground)]/85">
          <p>
            ClearPath Invest only sends emails that are essential to your
            account: password resets, email verification, and (rarely)
            critical security notices. We don&rsquo;t send marketing or
            promotional mail.
          </p>
          <p>
            Because these messages are required to operate your account,
            there&rsquo;s nothing here to unsubscribe from. If you no longer
            want to receive any email from us, the right step is to delete
            your account from settings — that revokes all transactional
            mail along with everything else.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:gap-3">
          <Link
            href="/app/settings"
            className="inline-flex flex-1 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--secondary)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--secondary)]/70"
          >
            Open account settings
          </Link>
          <Link
            href="/"
            className="inline-flex flex-1 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]"
          >
            Back to home
          </Link>
        </div>

        <p className="mt-6 text-xs text-[var(--muted-foreground)]">
          Questions? Reply to any of our emails or write to{" "}
          <a
            href="mailto:support@clearpathinvest.app"
            className="underline underline-offset-2"
          >
            support@clearpathinvest.app
          </a>
          .
        </p>
      </div>
    </main>
  );
}
