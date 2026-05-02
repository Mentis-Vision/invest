"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import AuthLayout from "@/components/auth-layout";
import { Loader2 } from "lucide-react";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Clear any stale session before the new sign-in — avoids identity
    // confusion when the device previously held a different user's cookie
    // (e.g. shared laptop with an old demo session still live).
    try {
      await authClient.signOut();
    } catch {
      /* no-op */
    }

    const { data, error } = await authClient.signIn.email({ email, password });
    if (error) {
      setError(error.message ?? "Sign in failed");
      setLoading(false);
      return;
    }
    // If the account has 2FA enabled, BetterAuth's server returns
    //   data: { twoFactorRedirect: true, twoFactorMethods: [...] }
    // and the twoFactorClient plugin (wired in auth-client.ts) fires
    // onTwoFactorRedirect, which sets window.location.href to
    // /verify-2fa. If we follow up with window.location.href = "/app"
    // here, we override the plugin's redirect and land on /app WITHOUT
    // a fully-established session — proxy.ts bounces the user back to
    // /sign-in, producing the "login recycles" loop.
    //
    // Detect the 2FA-required response and bail out; the plugin's
    // redirect will carry the browser to /verify-2fa.
    if (
      data &&
      typeof data === "object" &&
      "twoFactorRedirect" in data &&
      (data as { twoFactorRedirect?: unknown }).twoFactorRedirect
    ) {
      // Keep loading=true — the page is already navigating away.
      return;
    }
    // Full page reload ensures the Set-Cookie from sign-in is sent with the next request.
    // router.push() races the cookie commit and can fail auth check on /app.
    window.location.href = "/app";
  }

  async function handleGoogleSignIn() {
    try {
      await authClient.signOut();
    } catch {
      /* no-op */
    }
    await authClient.signIn.social({ provider: "google", callbackURL: "/app" });
  }

  return (
    <AuthLayout>
      {/* Masthead — prominent stacked hero so the brand reads as the
          primary anchor of the page. Logo is 64px (h-16), wordmark is
          a 13px spaced uppercase label that supports it without
          competing with the headline below. */}
      <div className="mb-10 text-center">
        <div className="mb-6 flex flex-col items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-16 w-16 object-contain" />
          <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.22em] text-foreground">
            ClearPath Invest
          </span>
        </div>
        <h1 className="font-heading text-[42px] leading-[1.05] tracking-tight text-foreground">
          The Investor&rsquo;s
          <br />
          <em className="italic text-[var(--buy)]">considered</em> brief.
        </h1>
        <p className="mx-auto mt-4 max-w-[280px] text-[13px] leading-relaxed text-muted-foreground">
          Three independent analysts cross-verify every recommendation. Every
          claim traces to a source.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md border border-[var(--destructive)]/20 bg-[var(--destructive)]/[0.04] px-3.5 py-2.5 text-[13px] text-[var(--destructive)]">
          {error}
        </div>
      )}

      {/* Google */}
      <button
        onClick={handleGoogleSignIn}
        className="group flex w-full items-center justify-center gap-2.5 rounded-md border border-border bg-card px-4 py-2.5 text-[13px] font-medium text-foreground/80 shadow-sm transition-all hover:border-foreground/30 hover:text-foreground"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Continue with Google
      </button>

      {/* Divider */}
      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/60">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Email form */}
      <form onSubmit={handleEmailSignIn} className="space-y-3">
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
            className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-foreground/40"
            placeholder="••••••••"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--buy)] px-4 py-2.5 text-[13px] font-semibold text-[var(--primary-foreground)] transition-all hover:bg-[var(--buy)]/90 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Sign In
        </button>
      </form>

      {/* Forgot password */}
      <p className="mt-3 text-center text-[12px] text-muted-foreground">
        <Link
          href="/forgot-password"
          className="underline-offset-[5px] hover:underline"
        >
          Forgot your password?
        </Link>
      </p>

      {/* Footer */}
      <p className="mt-6 text-center text-[12px] text-muted-foreground">
        No account?{" "}
        <Link href="/sign-up" className="font-medium text-foreground underline decoration-[var(--buy)] decoration-2 underline-offset-[5px] transition-colors hover:text-[var(--buy)]">
          Start your free trial
        </Link>
      </p>
    </AuthLayout>
  );
}
