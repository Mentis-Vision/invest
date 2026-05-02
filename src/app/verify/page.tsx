"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import AuthLayout from "@/components/auth-layout";
import { CheckCircle2, MailWarning, Loader2 } from "lucide-react";

/**
 * /verify — landing page after the user clicks the link in their
 * verification email. Replaces the old behaviour where success and
 * failure both redirected to /app and a failed verification dumped the
 * user on /sign-in with no context.
 *
 * Three states:
 *   - "verified": no error param + we have a session → success animation,
 *     auto-redirect to /app after a beat.
 *   - "needs_login": no error param but no session yet → show "Verified!
 *     Sign in to continue" with sign-in CTA.
 *   - "error": ?error=... param present → human-readable explanation +
 *     resend affordance + sign-in fallback.
 *
 * BetterAuth's emailVerification.callbackURL points here (see
 * src/lib/auth.ts). Verification SUCCESS lands here with autoSignIn
 * already done; FAILURE lands here with `?error=invalid_token` etc.
 */

function VerifyBody() {
  const router = useRouter();
  const params = useSearchParams();
  const error = params.get("error");
  const [session, setSession] = useState<unknown>(undefined);
  const [resendStatus, setResendStatus] = useState<"idle" | "loading" | "sent" | "failed">("idle");
  const [resendEmail, setResendEmail] = useState("");

  // Fetch the session once on mount to determine which state we're in.
  useEffect(() => {
    let alive = true;
    authClient
      .getSession()
      .then((res) => {
        if (!alive) return;
        setSession(res?.data?.session ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setSession(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Auto-redirect to /app once we know the user is verified + signed in.
  useEffect(() => {
    if (!error && session && typeof session === "object") {
      const t = setTimeout(() => {
        // Full reload so any cookie that was just set lands cleanly.
        window.location.href = "/app";
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [error, session]);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!resendEmail) return;
    setResendStatus("loading");
    try {
      await authClient.sendVerificationEmail({
        email: resendEmail,
        callbackURL: "/verify",
      });
      setResendStatus("sent");
    } catch {
      setResendStatus("failed");
    }
  }

  // Loading the session — render nothing rather than flash the wrong state.
  if (session === undefined) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/80 p-8 text-center backdrop-blur">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Checking your link…</p>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/80 p-8 backdrop-blur">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--decisive)]/10">
          <MailWarning className="h-5 w-5 text-[var(--decisive)]" />
        </div>
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          Link can&rsquo;t be used
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {humanizeError(error)}
        </p>

        <form onSubmit={handleResend} className="mt-6 space-y-2">
          <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Send a new link
          </label>
          <input
            type="email"
            required
            value={resendEmail}
            onChange={(e) => setResendEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={resendStatus === "loading"}
            className="inline-flex w-full items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
          >
            {resendStatus === "loading" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : resendStatus === "sent" ? (
              "Sent — check your inbox"
            ) : resendStatus === "failed" ? (
              "Couldn't send, try again"
            ) : (
              "Resend verification email"
            )}
          </button>
        </form>

        <div className="mt-4 flex justify-center gap-4 text-xs text-muted-foreground">
          <Link href="/sign-in" className="underline underline-offset-2 hover:text-foreground">
            Sign in
          </Link>
          <span className="text-foreground/15">·</span>
          <Link href="/sign-up" className="underline underline-offset-2 hover:text-foreground">
            Create account
          </Link>
        </div>
      </div>
    );
  }

  // ── Success but not signed in — auto-sign-in didn't catch (rare) ──────
  if (session === null) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/80 p-8 text-center backdrop-blur">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--buy)]/10">
          <CheckCircle2 className="h-5 w-5 text-[var(--buy)]" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Email verified</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your email is confirmed. Sign in to continue to your dashboard.
        </p>
        <button
          onClick={() => router.push("/sign-in")}
          className="mt-5 inline-flex w-full items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90"
        >
          Sign in
        </button>
      </div>
    );
  }

  // ── Verified + signed in → success animation, redirect shortly ─────────
  return (
    <div className="rounded-lg border border-border/60 bg-card/80 p-8 text-center backdrop-blur">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--buy)]/10">
        <CheckCircle2 className="h-5 w-5 text-[var(--buy)]" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">You&rsquo;re in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Email verified. Heading to your dashboard…
      </p>
      <Loader2 className="mx-auto mt-5 h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
}

function humanizeError(code: string): string {
  switch (code) {
    case "invalid_token":
      return "This verification link has expired or was already used. Send a new one below.";
    case "expired":
      return "This link expired. Verification links are valid for 24 hours — request a fresh one below.";
    case "user_not_found":
      return "We couldn't find an account for this verification link. Try creating an account or signing in.";
    default:
      return `Something went wrong verifying this link (${code}). You can request a new one below.`;
  }
}

export default function VerifyPage() {
  return (
    <AuthLayout>
      {/* Masthead — shared with every auth page so the brand anchors
          the flow consistently regardless of which state we're in. */}
      <div className="mb-8 flex flex-col items-center gap-2.5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-16 w-16 object-contain" />
        <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.22em] text-foreground">
          ClearPath Invest
        </span>
      </div>
      <Suspense
        fallback={
          <div className="rounded-lg border border-border/60 bg-card/80 p-8 text-center backdrop-blur">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <VerifyBody />
      </Suspense>
    </AuthLayout>
  );
}
