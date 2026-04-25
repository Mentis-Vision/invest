/**
 * Landing page for the List-Unsubscribe header URL and for the
 * per-newsletter opt-out links in weekly emails.
 *
 * Two modes, driven by the `type` query param:
 *
 *   (no type)
 *     Generic RFC 8058 landing — we don't operate a marketing list;
 *     transactional mail (password reset, verification) can't be
 *     opted out of without deleting the account. We explain that.
 *
 *   type=weekly-brief
 *     The Monday bull-vs-bear brief email. The /api/unsubscribe
 *     redirect that brought the user here has already flipped the
 *     opt-out flag on the user / waitlist row (validated via a
 *     signed token). We just confirm what happened.
 */
import Link from "next/link";

export const metadata = {
  title: "Unsubscribe — ClearPath Invest",
  description:
    "Email preferences for ClearPath Invest. Manage which messages you receive.",
};

export default async function UnsubscribePage(props: {
  searchParams: Promise<{
    to?: string;
    type?: string;
    applied?: string;
  }>;
}) {
  const { to, type, applied } = await props.searchParams;
  const isWeeklyBrief = type === "weekly-brief";
  const appliedFlag = applied === "1";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
          ClearPath Invest
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          {isWeeklyBrief ? "Weekly brief unsubscribed" : "Email preferences"}
        </h1>
        {to && (
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            For: <span className="font-mono">{to}</span>
          </p>
        )}

        {isWeeklyBrief ? (
          <div className="mt-6 space-y-4 text-sm leading-relaxed text-[var(--foreground)]/85">
            {appliedFlag ? (
              <p>
                You&rsquo;ve been unsubscribed from the Monday weekly brief.
                You won&rsquo;t receive the next one. Account emails
                (password reset, verification) still come through as
                usual — those are required to operate your account.
              </p>
            ) : (
              <p>
                We couldn&rsquo;t verify the unsubscribe link. It may have
                expired or been copied incorrectly. If you&rsquo;re signed
                in, you can turn the weekly brief off directly from
                Account Settings. Otherwise, just reply to any ClearPath
                email and we&rsquo;ll take care of it for you.
              </p>
            )}
            <p className="text-xs text-[var(--muted-foreground)]">
              Informational only. Not investment advice.
            </p>
          </div>
        ) : (
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
        )}

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
