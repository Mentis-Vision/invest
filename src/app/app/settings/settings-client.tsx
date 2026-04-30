"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Check,
  Info,
  Trash2,
  AlertTriangle,
  Mail,
  Leaf,
  CreditCard,
  ArrowUpRight,
} from "lucide-react";
import TwoFactorSection from "./two-factor-section";
import { useClientNowMs } from "@/lib/client/use-client-now";
import { safeExternalHttpsUrl } from "@/lib/client/safe-navigation";
import type {
  UserProfile,
  RiskTolerance,
  Horizon,
  InvestmentGoal,
} from "@/lib/user-profile";

export type BillingProps = {
  tier: "trial" | "free" | "individual" | "active" | "advisor";
  // Effective tier widened to include "trial" and "expired" alongside
  // the paid tiers — matches EffectiveTier in subscription.ts after
  // the hard-wall transition. "free" stays in the union for legacy
  // compatibility but new code paths emit "expired" instead.
  effectiveTier:
    | "trial"
    | "individual"
    | "active"
    | "advisor"
    | "expired"
    | "free";
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeConfigured: boolean;
};

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
  billing,
  user,
}: {
  initialProfile: UserProfile;
  twoFactorEnabled: boolean;
  weeklyDigestOptOut: boolean;
  weeklyBriefOptOut: boolean;
  billing: BillingProps;
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

      {/* Account status — billing and 2FA are the highest-signal
          account controls, so keep them paired above the preference
          editor instead of letting billing dominate the full row. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <BillingSection billing={billing} className="h-full" />
        <TwoFactorSection
          initialEnabled={twoFactorEnabled}
          className="h-full"
        />
      </div>

      <NotificationsSection
        initialOptOuts={{
          weeklyDigestOptOut,
          weeklyBriefOptOut,
        }}
        layout="grid"
      />

      {/* Investment profile — Preferences carries the broader research
          context on the left. The right column holds risk, horizon, and
          goals as one scan path, keeping profile decisions together. */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
        <Card className="h-full">
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
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium">
                <Leaf className="h-3.5 w-3.5 text-primary" />
                Investment values
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                {INVESTMENT_VALUE_FLAGS.map((item) => {
                  const checked = !!profile.preferences[item.key];
                  return (
                    <label
                      key={item.key}
                      htmlFor={`preference-${item.key}`}
                      className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background/60 px-3 py-3 text-sm hover:border-primary/40"
                    >
                      <input
                        id={`preference-${item.key}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setProfile((p) => ({
                            ...p,
                            preferences: {
                              ...p.preferences,
                              [item.key]: !checked,
                            },
                          }))
                        }
                        className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">
                          {item.title}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                These are context settings, not filters. ClearPath still
                surfaces the full analysis and flags preference mismatches.
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

        <div className="flex h-full flex-col gap-4">
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
                      <div className="text-xs text-muted-foreground">
                        {r.desc}
                      </div>
                    </div>
                  </label>
                );
              })}
            </CardContent>
          </Card>

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

      {/* Danger zone stays full-width and last so destructive actions
          are visually isolated from everyday preferences. */}

      {/* ─── Danger zone ─────────────────────────────────────────── */}
      <DeleteAccountSection userEmail={user.email} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ToggleListCard — generic, future-proof toggle pattern.
//
// Used by NotificationsSection. Standardises the visual language for
// list-style toggle UIs without creating one-off checkbox cards.
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
  layout?: "stack" | "grid";
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
  layout = "stack",
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
      <CardContent
        className={
          layout === "grid"
            ? "grid gap-2.5 text-sm lg:grid-cols-2"
            : "space-y-2.5 text-sm"
        }
      >
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
  layout,
  className,
}: {
  initialOptOuts: Record<NotificationFlag, boolean>;
  layout?: "stack" | "grid";
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
      layout={layout}
      className={className}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Investment-value preference flags. These live inside the broader
// Preferences card because they shape analysis context, not account
// security or email delivery.
// ─────────────────────────────────────────────────────────────────────

type InvestmentValueFlag =
  | "esgPreference"
  | "governancePreference"
  | "climatePreference"
  | "controversialSectorsPreference";

const INVESTMENT_VALUE_FLAGS: ReadonlyArray<ToggleItem<InvestmentValueFlag>> = [
  {
    key: "esgPreference",
    title: "Prefer ESG-aligned investments",
    description:
      "Tilts the analysis toward environmental, social, and governance signals when scoring tickers.",
  },
  {
    key: "governancePreference",
    title: "Emphasize governance quality",
    description:
      "Highlights management, accounting quality, shareholder alignment, and governance risks when data is available.",
  },
  {
    key: "climatePreference",
    title: "Surface climate transition risk",
    description:
      "Adds attention to environmental regulation, transition risk, and sector exposure where relevant.",
  },
  {
    key: "controversialSectorsPreference",
    title: "Flag controversial-sector exposure",
    description:
      "Calls out sectors such as tobacco, firearms, gambling, or weapons when relevant without hiding the analysis.",
  },
];

// ─────────────────────────────────────────────────────────────────────
// BillingSection — current plan + trial countdown + upgrade / manage
// CTAs.
//
// Three states:
//   1. Trial active (tier='trial', timer in the future) — show days
//      left and an "Upgrade" CTA that creates a Checkout Session.
//   2. Paid (status='active' on individual/active/advisor) — show
//      tier + next renewal date + "Manage billing" portal CTA.
//   3. Free (trial expired, no paid sub) — show "Trial ended"
//      headline and a primary "Upgrade" CTA.
//
// All buttons POST to our API routes which return Stripe-hosted URLs
// we redirect to. We never collect card data ourselves.
// ─────────────────────────────────────────────────────────────────────

function BillingSection({
  billing,
  className,
}: {
  billing: BillingProps;
  className?: string;
}) {
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const nowMs = useClientNowMs();

  const trialActive =
    nowMs != null &&
    billing.tier === "trial" &&
    billing.trialEndsAt &&
    new Date(billing.trialEndsAt).getTime() > nowMs;

  const trialDaysLeft = billing.trialEndsAt && nowMs != null
    ? Math.max(
        0,
        Math.ceil(
          (new Date(billing.trialEndsAt).getTime() - nowMs) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 0;

  const isPaid =
    billing.status === "active" &&
    (billing.tier === "individual" ||
      billing.tier === "active" ||
      billing.tier === "advisor");

  async function startCheckout(tier: "individual" | "active") {
    setBusy("checkout");
    setErr(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, interval: "monthly" }),
      });
      const data = await res.json();
      const checkoutUrl = safeExternalHttpsUrl(data.url, [
        "checkout.stripe.com",
      ]);
      if (!res.ok || !checkoutUrl) {
        setErr(data.error ?? "Could not start checkout.");
        setBusy(null);
        return;
      }
      window.location.assign(checkoutUrl);
    } catch {
      setErr("Network error. Try again.");
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    setErr(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      const portalUrl = safeExternalHttpsUrl(data.url, ["billing.stripe.com"]);
      if (!res.ok || !portalUrl) {
        setErr(data.error ?? "Could not open billing portal.");
        setBusy(null);
        return;
      }
      window.location.assign(portalUrl);
    } catch {
      setErr("Network error. Try again.");
      setBusy(null);
    }
  }

  // Stripe-not-configured state — show the card but with a disabled
  // CTA so user knows where billing will live, and ops sees we're
  // pre-launch on this surface.
  if (!billing.stripeConfigured) {
    return (
      <Card id="billing" className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4 text-primary" />
            Billing
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Billing isn&rsquo;t live yet — you&rsquo;re on the early-access
          plan with full feature access. We&rsquo;ll prompt you here when
          paid plans turn on.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="billing" className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4 text-primary" />
          Billing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Status row */}
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-medium">Current plan:</span>
          <span className="font-mono uppercase text-foreground">
            {tierLabel(billing.tier)}
          </span>
          {trialActive && (
            <Badge
              variant="outline"
              className="border-[var(--buy)]/40 text-[var(--buy)]"
            >
              Trial · {trialDaysLeft}{" "}
              {trialDaysLeft === 1 ? "day" : "days"} left
            </Badge>
          )}
          {isPaid && billing.cancelAtPeriodEnd && (
            <Badge
              variant="outline"
              className="border-[var(--sell)]/40 text-[var(--sell)]"
            >
              Cancels {formatDate(billing.currentPeriodEnd)}
            </Badge>
          )}
          {billing.status === "past_due" && (
            <Badge
              variant="outline"
              className="border-[var(--sell)]/40 text-[var(--sell)]"
            >
              Past due
            </Badge>
          )}
        </div>

        {/* Context line */}
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {trialActive ? (
            <>
              Your free 30-day trial of every Individual-tier feature is
              active until{" "}
              <strong className="text-foreground">
                {formatDate(billing.trialEndsAt)}
              </strong>
              . No credit card on file — you won&rsquo;t be charged
              automatically.
            </>
          ) : isPaid ? (
            <>
              Renews on{" "}
              <strong className="text-foreground">
                {formatDate(billing.currentPeriodEnd)}
              </strong>
              . Update payment method, switch tiers, or cancel anytime
              from the billing portal.
            </>
          ) : billing.status === "past_due" ? (
            <>
              Your most recent payment failed. Update your card to
              restore full access.
            </>
          ) : (
            <>
              Trial ended. You&rsquo;re on the Free plan — limited
              research access. Upgrade to restore the full three-lens
              pipeline.
            </>
          )}
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap gap-2 pt-1">
          {isPaid ? (
            <Button onClick={openPortal} disabled={busy !== null}>
              {busy === "portal" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Manage billing
              <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          ) : (
            <>
              <Button
                onClick={() => startCheckout("individual")}
                disabled={busy !== null}
              >
                {busy === "checkout" && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Upgrade to Individual · $29/mo
              </Button>
              <Button
                variant="outline"
                onClick={() => startCheckout("active")}
                disabled={busy !== null}
              >
                Upgrade to Active · $79/mo
              </Button>
              {/* Even non-paid users should be able to open the
                  portal once a Stripe customer exists — handy if a
                  prior subscription was canceled and the user wants
                  to view past invoices. */}
              <Button
                variant="outline"
                onClick={openPortal}
                disabled={busy !== null}
              >
                Billing portal
              </Button>
            </>
          )}
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

function tierLabel(tier: BillingProps["tier"]): string {
  switch (tier) {
    case "trial":
      return "Free trial";
    case "free":
      return "Free";
    case "individual":
      return "Individual";
    case "active":
      return "Active";
    case "advisor":
      return "Advisor";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
