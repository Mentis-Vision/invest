"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import AuthLayout from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeInternalRedirectPath } from "@/lib/client/safe-navigation";
import { Loader2, ShieldCheck } from "lucide-react";

/**
 * Two-factor verification step, reached after successful
 * email+password sign-in when the user has TOTP enabled.
 *
 * BetterAuth's twoFactor client plugin redirects here via the
 * `onTwoFactorRedirect` callback wired into `authClient`. The URL
 * carries:
 *   ?next=...      — where to go on success (default /app)
 *   ?methods=...   — comma-separated list of enabled factor methods
 *
 * Supports:
 *   - TOTP authenticator app code (6 digits)
 *   - Fallback to backup code (single-use, 8-char alphanumeric)
 *
 * Does NOT re-prompt email+password — the intermediate session is
 * already held by BetterAuth. Verifying here completes the sign-in.
 */
export default function VerifyTwoFactorPage() {
  return (
    <Suspense fallback={null}>
      <VerifyTwoFactorInner />
    </Suspense>
  );
}

function VerifyTwoFactorInner() {
  const sp = useSearchParams();
  const next = safeInternalRedirectPath(sp.get("next"));

  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the TOTP input tight to 6 digits. Backup codes are longer
  // and allow letters — separate input mask via the mode state.
  useEffect(() => {
    const timer = setTimeout(() => {
      setCode("");
      setError(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [mode]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === "totp") {
        const { error: err } = await authClient.twoFactor.verifyTotp({
          code: code.trim(),
        });
        if (err) {
          setError(err.message ?? "Invalid code. Try again.");
          setLoading(false);
          return;
        }
      } else {
        const { error: err } = await authClient.twoFactor.verifyBackupCode({
          code: code.trim(),
        });
        if (err) {
          setError(err.message ?? "Invalid backup code. Try again.");
          setLoading(false);
          return;
        }
      }
      // Full reload so the session cookie is re-read and any stale
      // client-cached state is discarded.
      window.location.assign(next);
    } catch {
      setError("Network error. Try again.");
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-8 text-center">
        <Link
          href="/"
          aria-label="ClearPath Invest — back to home"
          className="mb-6 flex flex-col items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-16 w-16 object-contain" />
          <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.22em] text-foreground">
            ClearPath Invest
          </span>
        </Link>
        <h1 className="font-heading text-[34px] leading-[1.1] tracking-tight text-foreground">
          <ShieldCheck className="inline h-8 w-8 -translate-y-1 text-[var(--buy)]" />{" "}
          Two-factor check
        </h1>
        <p className="mx-auto mt-3 max-w-[320px] text-[13px] leading-relaxed text-muted-foreground">
          Enter the 6-digit code from your authenticator app.
        </p>
      </div>

      <form onSubmit={verify} className="space-y-4">
        <div>
          <label
            htmlFor="code"
            className="mb-1.5 block text-xs font-medium text-foreground/80"
          >
            {mode === "totp" ? "Authenticator code" : "Backup code"}
          </label>
          <Input
            id="code"
            type="text"
            autoComplete="one-time-code"
            inputMode={mode === "totp" ? "numeric" : "text"}
            pattern={mode === "totp" ? "[0-9]{6}" : undefined}
            maxLength={mode === "totp" ? 6 : 16}
            autoFocus
            required
            value={code}
            onChange={(e) =>
              setCode(
                mode === "totp"
                  ? e.target.value.replace(/[^0-9]/g, "")
                  : e.target.value.trim()
              )
            }
            placeholder={mode === "totp" ? "123456" : "backup-code"}
            className="text-center font-mono text-lg tracking-[0.2em]"
            disabled={loading}
          />
        </div>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={loading || code.length < (mode === "totp" ? 6 : 6)}
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Verify & continue
        </Button>

        <div className="text-center text-xs">
          {mode === "totp" ? (
            <button
              type="button"
              onClick={() => setMode("backup")}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Lost your device? Use a backup code
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode("totp")}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              ← Back to authenticator code
            </button>
          )}
        </div>

        <p className="pt-2 text-center text-[11px] text-muted-foreground">
          <Link
            href="/sign-in"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Sign out and start over
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
