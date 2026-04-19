"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, Info, Trash2, AlertTriangle, Mail } from "lucide-react";
import TwoFactorSection from "./two-factor-section";
import type {
  UserProfile,
  RiskTolerance,
  Horizon,
  InvestmentGoal,
} from "@/lib/user-profile";

const RISK_OPTIONS: { value: RiskTolerance; label: string; desc: string }[] = [
  {
    value: "conservative",
    label: "Conservative",
    desc: "Capital preservation first. Willing to accept lower returns for lower volatility.",
  },
  {
    value: "moderate",
    label: "Moderate",
    desc: "Balanced risk / return. Comfortable with normal market drawdowns.",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    desc: "Willing to accept meaningful drawdowns in pursuit of higher long-term returns.",
  },
];

const HORIZON_OPTIONS: { value: Horizon; label: string; desc: string }[] = [
  { value: "short", label: "Short", desc: "Less than 2 years." },
  { value: "medium", label: "Medium", desc: "2 to 7 years." },
  { value: "long", label: "Long", desc: "7+ years." },
];

const GOAL_OPTIONS: { value: InvestmentGoal; label: string }[] = [
  { value: "retirement", label: "Retirement" },
  { value: "growth", label: "Long-term growth" },
  { value: "income", label: "Income / dividends" },
  { value: "preservation", label: "Capital preservation" },
  { value: "speculation", label: "Speculation" },
];

export default function SettingsClient({
  initialProfile,
  twoFactorEnabled,
  weeklyDigestOptOut,
  user,
}: {
  initialProfile: UserProfile;
  twoFactorEnabled: boolean;
  weeklyDigestOptOut: boolean;
  user: { name: string; email: string };
}) {
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [excludedInput, setExcludedInput] = useState<string>(
    (initialProfile.preferences.excludedSectors ?? []).join(", ")
  );
  const [notesInput, setNotesInput] = useState<string>(
    initialProfile.preferences.notes ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleGoal(g: InvestmentGoal) {
    setProfile((p) => {
      const has = p.investmentGoals.includes(g);
      return {
        ...p,
        investmentGoals: has
          ? p.investmentGoals.filter((x) => x !== g)
          : [...p.investmentGoals, g],
      };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const excludedSectors = excludedInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const body = {
      riskTolerance: profile.riskTolerance,
      horizon: profile.horizon,
      investmentGoals: profile.investmentGoals,
      preferences: {
        ...profile.preferences,
        excludedSectors,
        notes: notesInput.trim() || undefined,
      },
    };
    try {
      const res = await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save.");
        return;
      }
      const data: { profile: UserProfile } = await res.json();
      setProfile(data.profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium">{user.email}</span>.
          These preferences tilt how ClearPath&rsquo;s three analytical lenses
          (value, growth, macro) weigh their analysis — they do{" "}
          <em>not</em> filter what ClearPath shows you.
        </p>
      </div>

      <Card className="border-[var(--hold)]/30 bg-[var(--hold)]/5">
        <CardContent className="flex items-start gap-3 py-3 text-xs">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--hold)]" />
          <div>
            <span className="font-medium">Informational tool, not advice.</span>{" "}
            These preferences are used to contextualize generic analysis —
            they do not create a fiduciary relationship, a personalized
            investment plan, or an advisor-client engagement. Consult a
            licensed advisor for tailored guidance.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Risk tolerance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {RISK_OPTIONS.map((r) => {
            const active = profile.riskTolerance === r.value;
            return (
              <label
                key={r.value}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                  active
                    ? "border-[var(--buy)]/40 bg-[var(--buy)]/5"
                    : "border-border hover:bg-accent/40"
                }`}
              >
                <input
                  type="radio"
                  name="risk"
                  className="mt-0.5"
                  checked={active}
                  onChange={() =>
                    setProfile((p) => ({ ...p, riskTolerance: r.value }))
                  }
                />
                <div>
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="text-xs text-muted-foreground">{r.desc}</div>
                </div>
              </label>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Time horizon</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3">
            {HORIZON_OPTIONS.map((h) => {
              const active = profile.horizon === h.value;
              return (
                <button
                  key={h.value}
                  type="button"
                  onClick={() =>
                    setProfile((p) => ({ ...p, horizon: h.value }))
                  }
                  className={`flex flex-col items-start rounded-md border p-3 text-left text-sm transition-colors ${
                    active
                      ? "border-[var(--buy)]/40 bg-[var(--buy)]/5"
                      : "border-border hover:bg-accent/40"
                  }`}
                >
                  <span className="font-medium">{h.label}</span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    {h.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Goals</CardTitle>
          <p className="text-xs text-muted-foreground">
            Pick any that apply. No limit.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {GOAL_OPTIONS.map((g) => {
              const active = profile.investmentGoals.includes(g.value);
              return (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => toggleGoal(g.value)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? "border-[var(--buy)] bg-[var(--buy)]/10 text-[var(--buy)]"
                      : "border-border text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium">
              Dashboard density
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  {
                    value: "basic",
                    label: "Basic",
                    desc: "Price, P/E, yield, top headlines — calm and digestible.",
                  },
                  {
                    value: "standard",
                    label: "Standard",
                    desc: "Adds forward P/E, P/B, 50d/200d MA, beta, sentiment %.",
                  },
                  {
                    value: "advanced",
                    label: "Advanced",
                    desc: "Everything — RSI/MACD/Bollinger, full fundamentals, Form 4 trail.",
                  },
                ] as const
              ).map((opt) => {
                const active =
                  (profile.preferences.density ?? "basic") === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setProfile((p) => ({
                        ...p,
                        preferences: {
                          ...p.preferences,
                          density: opt.value,
                        },
                      }))
                    }
                    className={`flex flex-col items-start rounded-md border p-3 text-left text-sm transition-colors ${
                      active
                        ? "border-[var(--buy)]/40 bg-[var(--buy)]/5"
                        : "border-border hover:bg-accent/40"
                    }`}
                  >
                    <span className="font-medium">{opt.label}</span>
                    <span className="mt-1 text-xs text-muted-foreground">
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Analyst prompts always receive the full warehouse view —
              this only changes what you see on the dashboard.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium">
              Excluded sectors
              <span className="ml-2 font-normal text-muted-foreground">
                comma-separated, e.g. <em>Tobacco, Firearms, Gambling</em>
              </span>
            </label>
            <Input
              value={excludedInput}
              onChange={(e) => setExcludedInput(e.target.value)}
              placeholder="Leave blank for no exclusions"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Analysts will note when a ticker falls in these sectors.
              They will <em>not</em> skip the analysis — ClearPath still
              shows you the full view.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="esg"
              checked={!!profile.preferences.esgPreference}
              onChange={(e) =>
                setProfile((p) => ({
                  ...p,
                  preferences: {
                    ...p.preferences,
                    esgPreference: e.target.checked,
                  },
                }))
              }
            />
            <label htmlFor="esg" className="text-sm">
              Prefer ESG-aligned investments
            </label>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium">
              Notes for the analysts{" "}
              <span className="font-normal text-muted-foreground">
                (optional, up to 500 chars)
              </span>
            </label>
            <textarea
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value.slice(0, 500))}
              rows={3}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-foreground/40"
              placeholder="Any context that should shade the analysis (e.g. 'retired, rely on dividends', 'concentrated in employer stock')"
            />
            <div className="mt-1 text-[10px] text-muted-foreground">
              {notesInput.length} / 500
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-3 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {saved && !saving ? (
            <>
              <Check className="mr-2 h-4 w-4" /> Saved
            </>
          ) : (
            "Save preferences"
          )}
        </Button>
        {profile.updatedAt && !saved && (
          <span className="text-xs text-muted-foreground">
            Last updated {new Date(profile.updatedAt).toLocaleString()}
          </span>
        )}
        {profile.riskTolerance && (
          <Badge variant="outline" className="ml-auto text-xs">
            Active profile
          </Badge>
        )}
      </div>

      {/* ─── Notifications ──────────────────────────────────────── */}
      <NotificationsSection initialOptOut={weeklyDigestOptOut} />

      {/* ─── Two-factor authentication ──────────────────────────── */}
      <TwoFactorSection initialEnabled={twoFactorEnabled} />

      {/* ─── Danger zone ─────────────────────────────────────────── */}
      <DeleteAccountSection userEmail={user.email} />
    </div>
  );
}

/**
 * Notifications section — right now just a single toggle for the
 * Monday weekly digest. Scales to more prefs as we add them (one
 * `/api/user/notifications` endpoint handles all of them).
 */
function NotificationsSection({
  initialOptOut,
}: {
  initialOptOut: boolean;
}) {
  const [optOut, setOptOut] = useState(initialOptOut);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    const next = !optOut;
    setSaving(true);
    setErr(null);
    // Optimistic — flip UI first, revert on failure.
    setOptOut(next);
    try {
      const res = await fetch("/api/user/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklyDigestOptOut: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error ?? "Could not save. Try again.");
        setOptOut(!next);
        return;
      }
      const data = (await res.json()) as { weeklyDigestOptOut: boolean };
      setOptOut(data.weeklyDigestOptOut);
    } catch {
      setErr("Network error. Try again.");
      setOptOut(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-primary" />
          Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <label
          htmlFor="weekly-digest-toggle"
          className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background/60 px-3 py-3 hover:border-primary/40"
        >
          <input
            id="weekly-digest-toggle"
            type="checkbox"
            checked={!optOut}
            onChange={toggle}
            disabled={saving}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
          />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">
              Monday weekly digest
            </div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
              A short recap every Monday morning: your week&rsquo;s
              portfolio change, biggest movers, new alerts, research
              you ran, and upcoming earnings. Skippable anytime.
            </div>
          </div>
          {saving && (
            <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground" />
          )}
        </label>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Account deletion with a "type DELETE to confirm" guard.
 *
 * We purposefully render this inline in the Settings flow rather than
 * buried under a submenu — the whole point of the right-to-delete is
 * that it's self-service, one click away, and doesn't require an
 * email or a support ticket. The two-step confirmation (toggle +
 * literal text match) is the only safeguard against accidental
 * destruction.
 */
function DeleteAccountSection({ userEmail }: { userEmail: string }) {
  const [expanded, setExpanded] = useState(false);
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const confirmed = typed === "DELETE";
  const isDemo = userEmail.toLowerCase() === "demo@clearpathinvest.app";

  async function doDelete() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/user/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error ?? "Could not delete account. Try again.");
        setLoading(false);
        return;
      }
      // Full page reload clears any cached state + lands on sign-in.
      window.location.href = "/sign-in?deleted=1";
    } catch {
      setErr("Network error. Try again.");
      setLoading(false);
    }
  }

  return (
    <Card className="mt-8 border-destructive/30 bg-destructive/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Danger zone
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="leading-relaxed text-foreground/85">
          Deleting your account wipes your holdings, brokerage
          connections, research history, journal notes, and every other
          piece of data we hold tied to you. This is immediate and can
          not be undone.
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Some backup copies may persist up to 7 days in Neon&rsquo;s
          point-in-time recovery window. Past that, your data is gone
          for good.
        </p>

        {isDemo && (
          <p className="rounded-md border border-[var(--hold)]/30 bg-[var(--hold)]/10 px-3 py-2 text-xs text-[var(--hold)]">
            The shared demo account can&rsquo;t be deleted. Sign up for
            your own account to get a deletable profile.
          </p>
        )}

        {!expanded ? (
          <Button
            variant="outline"
            onClick={() => setExpanded(true)}
            disabled={isDemo}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete my account
          </Button>
        ) : (
          <div className="space-y-3 rounded-md border border-destructive/30 bg-background/60 p-3">
            <div>
              <label
                htmlFor="delete-confirm"
                className="mb-1.5 block text-xs font-medium"
              >
                Type{" "}
                <span className="font-mono font-semibold text-destructive">
                  DELETE
                </span>{" "}
                (all caps) to confirm:
              </label>
              <Input
                id="delete-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
                className="font-mono"
                disabled={loading}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setExpanded(false);
                  setTyped("");
                  setErr(null);
                }}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onClick={doDelete}
                disabled={!confirmed || loading}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Trash2 className="mr-2 h-4 w-4" />
                Delete my account permanently
              </Button>
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
