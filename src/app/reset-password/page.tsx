"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import AuthLayout from "@/components/auth-layout";
import { Loader2 } from "lucide-react";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthLayout>{null}</AuthLayout>}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) setError("This reset link is missing its token. Request a new one.");
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (!token) return;
    setLoading(true);
    try {
      const { error: apiErr } = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (apiErr) {
        setError(apiErr.message ?? "Could not reset password.");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/sign-in"), 2000);
    } catch {
      setError("Something went wrong. Try again.");
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
          Choose a new
          <br />
          <em className="italic text-[var(--buy)]">password</em>.
        </h1>
      </div>

      {done ? (
        <div className="rounded-md border border-[var(--buy)]/30 bg-[var(--buy)]/5 p-5 text-center">
          <p className="font-medium">Password updated.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Redirecting you to sign-in…
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
                New password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoFocus
                className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-foreground/40"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Confirm new password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-foreground/40"
                placeholder="Type it again"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !token}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--buy)] px-4 py-2.5 text-[13px] font-semibold text-[var(--primary-foreground)] transition-all hover:bg-[var(--buy)]/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Update password
            </button>
          </form>
        </>
      )}

      <p className="mt-6 text-center text-[12px] text-muted-foreground">
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
