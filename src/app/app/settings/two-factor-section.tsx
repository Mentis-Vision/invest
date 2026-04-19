"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ShieldCheck,
  ShieldOff,
  Copy,
  Check,
  KeyRound,
  AlertTriangle,
} from "lucide-react";

/**
 * Two-factor authentication management UI, lives inside the Settings
 * page.
 *
 * States:
 *   1. disabled      — show "Enable 2FA" button + explainer
 *   2. enrolling     — collected password, server returned totpURI +
 *                       backupCodes; show QR + codes; user enters TOTP
 *                       to verify (BetterAuth's `verifyTotp` is what
 *                       flips `verified` on the twoFactor row; until
 *                       then the second factor is latent.)
 *   3. enabled       — show status + "View backup codes" + "Disable"
 *   4. disabling     — collected password, calling disable endpoint
 *
 * Safety note: enabling/disabling requires the user's current password.
 * The password is never persisted client-side; it stays in this
 * component's state only until the network request completes.
 */

type Props = {
  initialEnabled: boolean;
};

type TotpData = {
  totpURI: string;
  backupCodes: string[];
};

export default function TwoFactorSection({ initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [stage, setStage] = useState<
    "idle" | "enable-password" | "enable-verify" | "disable-password"
  >("idle");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [totpData, setTotpData] = useState<TotpData | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Clear sensitive state when leaving a stage.
  useEffect(() => {
    if (stage === "idle") {
      setPassword("");
      setVerifyCode("");
      setErr(null);
    }
  }, [stage]);

  async function startEnable(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await authClient.twoFactor.enable({
        password,
        issuer: "ClearPath Invest",
      });
      if (error || !data) {
        setErr(error?.message ?? "Could not start 2FA enrollment.");
        setLoading(false);
        return;
      }
      setTotpData({
        totpURI: data.totpURI,
        backupCodes: data.backupCodes,
      });
      setStage("enable-verify");
      setPassword("");
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function finishEnable(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: verifyCode.trim(),
      });
      if (error) {
        setErr(error.message ?? "Invalid code. Try the current 6-digit value.");
        setLoading(false);
        return;
      }
      setEnabled(true);
      setStage("idle");
      setTotpData(null);
      setVerifyCode("");
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const { error } = await authClient.twoFactor.disable({
        password,
      });
      if (error) {
        setErr(error.message ?? "Could not disable 2FA.");
        setLoading(false);
        return;
      }
      setEnabled(false);
      setStage("idle");
      setPassword("");
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function copyCode(c: string) {
    navigator.clipboard.writeText(c).then(() => {
      setCopiedCode(c);
      setTimeout(
        () => setCopiedCode((cur) => (cur === c ? null : cur)),
        1200
      );
    });
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Two-factor authentication
          </CardTitle>
          {enabled && (
            <Badge
              variant="outline"
              className="border-[var(--buy)]/30 bg-[var(--buy)]/10 text-[var(--buy)]"
            >
              Enabled
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="leading-relaxed text-muted-foreground">
          Add a second factor using any authenticator app — Google
          Authenticator, Authy, 1Password, Bitwarden. Once enabled,
          you&rsquo;ll need the app on every sign-in.
        </p>

        {stage === "idle" && !enabled && (
          <Button
            variant="outline"
            onClick={() => setStage("enable-password")}
            className="border-primary/40 text-primary hover:bg-primary/10"
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            Enable two-factor auth
          </Button>
        )}

        {stage === "idle" && enabled && (
          <Button
            variant="outline"
            onClick={() => setStage("disable-password")}
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            <ShieldOff className="mr-2 h-4 w-4" />
            Disable two-factor auth
          </Button>
        )}

        {/* ── Stage: enroll, confirm password ─────────────────────── */}
        {stage === "enable-password" && (
          <form
            onSubmit={startEnable}
            className="space-y-3 rounded-md border border-border bg-background/60 p-3"
          >
            <div>
              <label
                htmlFor="pw-enable"
                className="mb-1.5 block text-xs font-medium"
              >
                Confirm your password to enroll
              </label>
              <Input
                id="pw-enable"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStage("idle")}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!password || loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Continue
              </Button>
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
          </form>
        )}

        {/* ── Stage: show QR + backup codes, verify TOTP ──────────── */}
        {stage === "enable-verify" && totpData && (
          <div className="space-y-4 rounded-md border border-primary/30 bg-primary/5 p-4">
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                Step 1 · Scan this QR code
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                {/* QR code rendered via an external image service. The
                    totpURI is the otpauth:// URL; the API below
                    encodes it and renders a 180×180 PNG. Using
                    Google Charts because it's stable, free, and
                    doesn't require a QR dep. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totpData.totpURI)}`}
                  alt="2FA QR code"
                  className="h-[180px] w-[180px] rounded border border-border bg-white p-2"
                />
                <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                  <p className="mb-2 leading-relaxed">
                    Open your authenticator app and scan this code.
                    If scanning doesn&rsquo;t work, paste the setup
                    secret directly:
                  </p>
                  <div className="flex items-start gap-2">
                    <code className="block flex-1 break-all rounded border border-border bg-card px-2 py-1.5 font-mono text-[11px]">
                      {extractSecret(totpData.totpURI)}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        copyCode(extractSecret(totpData.totpURI))
                      }
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border hover:bg-secondary"
                      aria-label="Copy setup secret"
                    >
                      {copiedCode === extractSecret(totpData.totpURI) ? (
                        <Check className="h-3.5 w-3.5 text-[var(--buy)]" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                <KeyRound className="mr-1 inline h-3 w-3" />
                Step 2 · Save these backup codes somewhere safe
              </div>
              <p className="rounded-md border border-[var(--hold)]/30 bg-[var(--hold)]/10 px-3 py-2 text-xs leading-relaxed text-[var(--hold)]">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                You&rsquo;ll only see these once. Each code works exactly
                one time. If you lose your authenticator device, a
                backup code is how you sign back in.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {totpData.backupCodes.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => copyCode(c)}
                    className="rounded border border-border bg-card px-2 py-1.5 text-center font-mono text-[11px] tracking-wide hover:bg-secondary"
                    title="Click to copy"
                  >
                    {copiedCode === c ? (
                      <span className="text-[var(--buy)]">
                        <Check className="mr-1 inline h-3 w-3" />
                        copied
                      </span>
                    ) : (
                      c
                    )}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={finishEnable} className="space-y-3">
              <div>
                <label
                  htmlFor="verify-code"
                  className="mb-1.5 block text-xs font-medium"
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Step 3 ·
                  </span>{" "}
                  Enter the current 6-digit code from your app
                </label>
                <Input
                  id="verify-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) =>
                    setVerifyCode(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  className="font-mono text-lg tracking-[0.25em]"
                  placeholder="123456"
                  required
                  disabled={loading}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setStage("idle");
                    setTotpData(null);
                  }}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={verifyCode.length !== 6 || loading}
                >
                  {loading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Turn on 2FA
                </Button>
              </div>
              {err && <p className="text-xs text-destructive">{err}</p>}
            </form>
          </div>
        )}

        {/* ── Stage: disable, confirm password ────────────────────── */}
        {stage === "disable-password" && (
          <form
            onSubmit={disable}
            className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3"
          >
            <p className="text-xs text-muted-foreground">
              Disabling removes your TOTP key and all unused backup codes.
              You can re-enroll later if you change your mind.
            </p>
            <div>
              <label
                htmlFor="pw-disable"
                className="mb-1.5 block text-xs font-medium"
              >
                Confirm your password to disable
              </label>
              <Input
                id="pw-disable"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStage("idle")}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!password || loading}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Disable 2FA
              </Button>
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** otpauth://totp/Label?secret=XYZ&issuer=ClearPath → XYZ */
function extractSecret(totpURI: string): string {
  try {
    const url = new URL(totpURI);
    return url.searchParams.get("secret") ?? totpURI;
  } catch {
    return totpURI;
  }
}
