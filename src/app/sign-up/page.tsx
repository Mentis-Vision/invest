"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import AuthLayout from "@/components/auth-layout";
import { Loader2 } from "lucide-react";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [verificationSent, setVerificationSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resentAt, setResentAt] = useState<number | null>(null);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Kill any existing session BEFORE creating the new account. Without
    // this, a user signing up while a prior cookie (e.g. the demo account
    // or someone else's session on a shared device) is still valid would
    // get redirected to /app still authenticated as the old identity —
    // especially when verification is required and autoSignIn returns
    // token:null. Best-effort: a missing/expired session is fine.
    try {
      await authClient.signOut();
    } catch {
      /* no-op — no prior session */
    }

    const { error } = await authClient.signUp.email({ name, email, password });
    if (error) {
      setError(error.message ?? "Sign up failed");
      setLoading(false);
      return;
    }
    // In production, BetterAuth triggers the verification email. Show the
    // "check your email" state. In dev/without verification, the session is
    // created immediately and we can redirect to /app.
    const { data: session } = await authClient.getSession();
    if (session?.user && session.user.email === email) {
      // Only redirect if the current session truly matches the user we
      // just created — otherwise we're still on a stale session that
      // signOut didn't clear. Falling through to verificationSent is safer.
      window.location.href = "/app";
    } else {
      setVerificationSent(true);
      setLoading(false);
    }
  }

  async function handleGoogleSignUp() {
    // Same guard as the email path: clear stale sessions before the OAuth
    // handoff so we don't round-trip back into someone else's identity.
    try {
      await authClient.signOut();
    } catch {
      /* no-op */
    }
    await authClient.signIn.social({ provider: "google", callbackURL: "/app" });
  }

  return (
    <AuthLayout>
      <div className="mb-8 text-center">
        <div className="mb-5 inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.25em] text-[var(--buy)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-6 w-6 object-contain" />
          <span>ClearPath</span>
        </div>
        <h1 className="font-heading text-[36px] leading-[1.05] tracking-tight text-foreground">
          Request
          <br />
          <em className="italic text-[var(--buy)]">access.</em>
        </h1>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-[var(--destructive)]/20 bg-[var(--destructive)]/[0.04] px-3.5 py-2.5 text-[13px] text-[var(--destructive)]">
          {error}
        </div>
      )}

      {verificationSent ? (
        <div className="rounded-md border border-border bg-card p-5 text-center">
          <p className="font-medium">Check your email</p>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a verification link to <strong>{email}</strong>. Click it
            to activate your account.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              disabled={resending || resentAt !== null}
              onClick={async () => {
                setResending(true);
                try {
                  await authClient.sendVerificationEmail({
                    email,
                    callbackURL: "/app",
                  });
                  setResentAt(Date.now());
                  // Re-enable after 60s so a second retry is still possible
                  setTimeout(() => setResentAt(null), 60_000);
                } catch {
                  /* swallow — button re-enables on the timer */
                } finally {
                  setResending(false);
                }
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent/50 disabled:opacity-50"
            >
              {resending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : resentAt !== null ? (
                <>Sent &mdash; try again in 60s</>
              ) : (
                <>Resend verification email</>
              )}
            </button>
            <p className="text-[11px] text-muted-foreground">
              Or check spam, or{" "}
              <Link href="/sign-in" className="underline hover:text-foreground">
                try signing in
              </Link>
              &nbsp;&mdash; we may already have verified you.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Google */}
          <button
            type="button"
            onClick={handleGoogleSignUp}
            className="group mb-5 flex w-full items-center justify-center gap-2.5 rounded-md border border-border bg-card px-4 py-2.5 text-[13px] font-medium text-foreground/80 shadow-sm transition-all hover:border-foreground/30 hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          <div className="mb-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/60">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSignUp} className="space-y-3">
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Full Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-foreground/40"
            placeholder="Jane Doe"
          />
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-foreground/40"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-foreground/40"
            placeholder="Minimum 8 characters"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--buy)] px-4 py-2.5 text-[13px] font-semibold text-[var(--primary-foreground)] transition-all hover:bg-[var(--buy)]/90 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Create Account
        </button>
          </form>

          <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
            By creating an account you agree to our{" "}
            <Link href="/terms" className="underline hover:text-foreground">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </>
      )}

      <p className="mt-6 text-center text-[12px] text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline decoration-[var(--buy)] decoration-2 underline-offset-[5px] transition-colors hover:text-[var(--buy)]">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
