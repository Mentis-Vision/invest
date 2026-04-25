"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, Info, Trash2, AlertTriangle, Mail, Leaf } from "lucide-react";
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
  weeklyBriefOptOut,
  user,
}: {
  initialProfile: UserProfile;
  twoFactorEnabled: boolean;
  weeklyDigestOptOut: boolean;
  weeklyBriefOptOut: boolean;
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

      {/* Row 1 — Account-level controls. 2FA (security) on the left.
          The right column stacks two ToggleListCards (Notifications +
          Investment values) — both share the same toggle pattern, so
          stacking them here builds the visual language of "this column
          is your boolean preferences" while 2FA sits alone as the
          security card. */}
      <div className="grid gap-4 md:grid-cols-2">
        <TwoFactorSection
          initialEnabled={twoFactorEnabled}
          className="h-full"
        />
        <div className="flex flex-col gap-4">
          <NotificationsSection
            initialOptOuts={{
              weeklyDigestOptOut,
              weeklyBriefOptOut,
            }}
          />
          <InvestmentValuesSection
            profile={profile}
            onProfileSaved={(saved) => setProfile(saved)}
          />
        </div>
      </div>

      {/* Row 2 — Investing profile. Risk tolerance (tall, 3 stacked
          options) on the left; Time horizon + Goals stacked on the
          right so the column heights match. Inner stack uses h-full
          + flex-1 cards so they grow to fill whatever height Risk
          tolerance establishes — keeps the left/right halves
          symmetrical regardless of content length. */}
      <div className="grid gap-4 md:grid-cols-2">
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

        <div className="flex h-full flex-col gap-4">
          <Card className="flex flex-1 flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Time horizon</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 items-center">
              <div className="grid w-full gap-2 sm:grid-cols-3">
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

          <Card className="flex flex-1 flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Goals</CardTitle>
              <p className="text-xs text-muted-foreground">
                Pick any that apply. No limit.
              </p>
            </CardHeader>
            <CardContent className="flex flex-1 items-center">
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
        </div>
      </div>

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

          {/* ESG checkbox previously lived here. Moved to a dedicated
              "Investment values" card alongside Notifications so the
              toggle pattern is consistent and the card scales naturally
              when sin-stock / climate / governance flags get added. */}

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

      {/* Notifications + 2FA now live in the row-1 right column above —
          no duplicate render here. Danger zone stays full-width and last
          so destructive actions are visually isolated. */}

      {/* ─── Danger zone ─────────────────────────────────────────── */}
      <DeleteAccountSection userEmail={user.email} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ToggleListCard — generic, future-proof toggle pattern.
//
// Used by NotificationsSection AND InvestmentValuesSection (and any
// future "list of boolean prefs" card). Standardises the visual
// language so toggle UIs stay consistent across the app — adding a
// new toggle card is one component definition + a typed flag list,
// no new UI primitives.
//
// `interpretation` controls how the checked state maps to the underlying
// boolean — opt-out flags read CHECKED-meaning-subscribed (so a user
// glancing at the card sees "yes I want this"), while preference flags
// read CHECKED-meaning-enabled (the natural mapping). Eliminates a
// recurring "wait, is this inverted?" UX trap.
// ─────────────────────────────────────────────────────────────────────

type ToggleItem<K extends string> = {
  key: K;
  title: string;
  description: string;
};

type ToggleListCardProps<K extends string> = {
  /** Card header label, e.g. "Notifications" or "Investment values". */
  cardTitle: string;
  /** Lucide icon component to render in the header. */
  icon: React.ComponentType<{ className?: string }>;
  /** Items to render — order is render order. */
  items: ReadonlyArray<ToggleItem<K>>;
  /** Current values keyed by item.key. */
  values: Record<K, boolean>;
  /**
   * "subscribed" → checkbox shows checked when value is FALSE (opt-out
   *   semantics — used by Notifications). "enabled" → checkbox shows
   *   checked when value is TRUE (natural — used by preferences).
   */
  interpretation: "subscribed" | "enabled";
  /** Async save. Receives the item key and the NEW underlying value. */
  onToggle: (key: K, nextValue: boolean) => Promise<void>;
  /** Which item is currently saving (for spinner + disable-others). */
  savingKey: K | null;
  /** Inline error string (rendered red below the list). */
  error: string | null;
  className?: string;
};

function ToggleListCard<K extends string>({
  cardTitle,
  icon: Icon,
  items,
  values,
  interpretation,
  onToggle,
  savingKey,
  error,
  className,
}: ToggleListCardProps<K>) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" />
          {cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5 text-sm">
        {items.map((item) => {
          const value = values[item.key];
          // For opt-out flags, "checked" reads "yes I want this email,"
          // so we invert the underlying boolean for display.
          const checked = interpretation === "subscribed" ? !value : value;
          const isSaving = savingKey === item.key;
          return (
            <label
              key={item.key}
              htmlFor={`toggle-${item.key}`}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background/60 px-3 py-3 hover:border-primary/40"
            >
              <input
                id={`toggle-${item.key}`}
                type="checkbox"
                checked={checked}
                onChange={() => {
                  // Map UI "checked" back to the underlying value.
                  const nextChecked = !checked;
                  const nextValue =
                    interpretation === "subscribed" ? !nextChecked : nextChecked;
                  void onToggle(item.key, nextValue);
                }}
                disabled={savingKey !== null}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">{item.title}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {item.description}
                </div>
              </div>
              {isSaving && (
                <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground" />
              )}
            </label>
          );
        })}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// NotificationsSection — uses ToggleListCard with opt-out semantics.
// Adding a new email is one entry in NOTIFICATION_FLAGS + the matching
// column in "user" + the SUPPORTED_FLAGS mirror in
// /api/user/notifications/route.ts.
// ─────────────────────────────────────────────────────────────────────

type NotificationFlag = "weeklyDigestOptOut" | "weeklyBriefOptOut";

const NOTIFICATION_FLAGS: ReadonlyArray<ToggleItem<NotificationFlag>> = [
  {
    key: "weeklyDigestOptOut",
    title: "Monday weekly digest",
    description:
      "Personal recap every Monday: your week's portfolio change, biggest movers, new alerts, research you ran, and upcoming earnings.",
  },
  {
    key: "weeklyBriefOptOut",
    title: "Monday research brief",
    description:
      "The week's public bull-vs-bear ticker brief — three-lens analysis on a high-interest stock — delivered Monday morning. Same content as /research, just in your inbox.",
  },
];

function NotificationsSection({
  initialOptOuts,
  className,
}: {
  initialOptOuts: Record<NotificationFlag, boolean>;
  className?: string;
}) {
  const [optOuts, setOptOuts] = useState(initialOptOuts);
  const [savingKey, setSavingKey] = useState<NotificationFlag | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleToggle(key: NotificationFlag, nextValue: boolean) {
    setSavingKey(key);
    setErr(null);
    // Optimistic — flip UI first, revert on failure.
    setOptOuts((prev) => ({ ...prev, [key]: nextValue }));
    try {
      const res = await fetch("/api/user/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: nextValue }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error ?? "Could not save. Try again.");
        setOptOuts((prev) => ({ ...prev, [key]: !nextValue }));
        return;
      }
      const data = (await res.json()) as Partial<
        Record<NotificationFlag, boolean>
      >;
      // Trust the server's echoed value rather than our optimistic guess.
      setOptOuts((prev) => ({
        ...prev,
        [key]: typeof data[key] === "boolean" ? data[key]! : nextValue,
      }));
    } catch {
      setErr("Network error. Try again.");
      setOptOuts((prev) => ({ ...prev, [key]: !nextValue }));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <ToggleListCard
      cardTitle="Notifications"
      icon={Mail}
      items={NOTIFICATION_FLAGS}
      values={optOuts}
      interpretation="subscribed"
      onToggle={handleToggle}
      savingKey={savingKey}
      error={err}
      className={className}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// InvestmentValuesSection — research-shaping preferences (currently
// just ESG; future: sin-stock filter, climate, governance).
//
// These flags shape how the AI lenses analyse, NOT email behaviour —
// kept distinct from Notifications because mixing those concerns
// would be misleading to the user.
//
// Save semantics: writes back through /api/user/profile with the
// FULL current `preferences` blob merged with the changed flag —
// the profile endpoint replaces the whole preferences JSON, so a
// partial save would wipe excludedSectors / notes / density.
// ─────────────────────────────────────────────────────────────────────

type InvestmentValueFlag = "esgPreference";

const INVESTMENT_VALUE_FLAGS: ReadonlyArray<ToggleItem<InvestmentValueFlag>> = [
  {
    key: "esgPreference",
    title: "Prefer ESG-aligned investments",
    description:
      "Tilts the analysis toward environmental / social / governance signals when scoring tickers. Doesn't filter — analyses still surface non-ESG names; they're just contextualised against this preference.",
  },
];

function InvestmentValuesSection({
  profile,
  onProfileSaved,
  className,
}: {
  profile: UserProfile;
  /** Called with the saved profile so the parent can update its state. */
  onProfileSaved: (profile: UserProfile) => void;
  className?: string;
}) {
  // Local mirror so the toggle reflects optimistic state independent of
  // the parent's save cycle. Re-syncs whenever the parent's profile
  // updates (e.g. after a "Save preferences" button press elsewhere).
  const [values, setValues] = useState<Record<InvestmentValueFlag, boolean>>({
    esgPreference: !!profile.preferences.esgPreference,
  });
  const [savingKey, setSavingKey] = useState<InvestmentValueFlag | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleToggle(key: InvestmentValueFlag, nextValue: boolean) {
    setSavingKey(key);
    setErr(null);
    setValues((prev) => ({ ...prev, [key]: nextValue }));
    try {
      // Send the full preferences object — the profile endpoint
      // overwrites the whole blob, so partial sends would wipe
      // excludedSectors / notes / density.
      const body = {
        preferences: {
          ...profile.preferences,
          [key]: nextValue,
        },
      };
      const res = await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error ?? "Could not save. Try again.");
        setValues((prev) => ({ ...prev, [key]: !nextValue }));
        return;
      }
      const data = (await res.json()) as { profile: UserProfile };
      onProfileSaved(data.profile);
      setValues({
        esgPreference: !!data.profile.preferences.esgPreference,
      });
    } catch {
      setErr("Network error. Try again.");
      setValues((prev) => ({ ...prev, [key]: !nextValue }));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <ToggleListCard
      cardTitle="Investment values"
      icon={Leaf}
      items={INVESTMENT_VALUE_FLAGS}
      values={values}
      interpretation="enabled"
      onToggle={handleToggle}
      savingKey={savingKey}
      error={err}
      className={className}
    />
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
