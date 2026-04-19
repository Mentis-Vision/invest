"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import AuthLayout from "@/components/auth-layout";
import { Loader2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      // Even if the address isn't on file, we show the same confirmation
      // to avoid account enumeration.
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-10 text-center">
        <div className="mb-5 inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.25em] text-[var(--buy)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-4 w-4" />
          <span>ClearPath</span>
        </div>
        <h1 className="font-heading text-[36px] leading-[1.1] tracking-tight text-foreground">
          Reset your
          <br />
          <em className="italic text-[var(--buy)]">password</em>.
        </h1>
      </div>

      {submitted ? (
        <div className="rounded-md border border-border bg-card p-5 text-center">
          <p className="font-medium">Check your email</p>
          <p className="mt-2 text-sm text-muted-foreground">
            If an account exists for <strong>{email}</strong>, we&rsquo;ve sent
            a password-reset link. It expires in one hour.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            No email yet? Check your spam folder, then{" "}
            <button
              onClick={() => setSubmitted(false)}
              className="underline hover:text-foreground"
            >
              try again
            </button>
            .
          </p>
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-4 rounded-md border border-[var(--destructive)]/20 bg-[var(--destructive)]/[0.04] px-3.5 py-2.5 text-[13px] text-[var(--destructive)]">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-foreground/40"
                placeholder="you@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--buy)] px-4 py-2.5 text-[13px] font-semibold text-[var(--primary-foreground)] transition-all hover:bg-[var(--buy)]/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Send reset link
            </button>
          </form>
        </>
      )}

      <p className="mt-6 text-center text-[12px] text-muted-foreground">
        Remembered it?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-foreground underline decoration-[var(--buy)] decoration-2 underline-offset-[5px]"
        >
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
