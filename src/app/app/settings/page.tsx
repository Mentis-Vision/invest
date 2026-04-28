import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserProfile } from "@/lib/user-profile";
import {
  ensureSubscriptionRecord,
  getSubscription,
  effectiveTierFor,
} from "@/lib/subscription";
import { stripeConfigured } from "@/lib/stripe";
import { pool } from "@/lib/db";
import AppShell from "@/components/app-shell";
import SettingsClient from "./settings-client";

export const dynamic = "force-dynamic";

async function getTwoFactorEnabled(userId: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ twoFactorEnabled: boolean | null }>(
      `SELECT "twoFactorEnabled" FROM "user" WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return Boolean(rows[0]?.twoFactorEnabled);
  } catch {
    // If the column doesn't exist yet (pre-migration) or the read
    // fails, default to "not enabled" — the Settings page still
    // renders; user just sees the enrollment CTA.
    return false;
  }
}

/**
 * Both opt-out flags fetched in one round-trip. If the column doesn't
 * exist yet (pre-migration) or the read fails, default to "subscribed"
 * (opt-out = false) so a DB issue doesn't unsubscribe everyone.
 */
async function getNotificationOptOuts(
  userId: string
): Promise<{ weeklyDigestOptOut: boolean; weeklyBriefOptOut: boolean }> {
  try {
    const { rows } = await pool.query<{
      weeklyDigestOptOut: boolean | null;
      weeklyBriefOptOut: boolean | null;
    }>(
      `SELECT "weeklyDigestOptOut", "weeklyBriefOptOut" FROM "user" WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return {
      weeklyDigestOptOut: Boolean(rows[0]?.weeklyDigestOptOut),
      weeklyBriefOptOut: Boolean(rows[0]?.weeklyBriefOptOut),
    };
  } catch {
    return { weeklyDigestOptOut: false, weeklyBriefOptOut: false };
  }
}

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  // ensureSubscriptionRecord covers the case where the user lands on
  // /app/settings BEFORE /app — without it, billing card would render
  // a "no subscription" empty state on direct navigation to settings.
  await ensureSubscriptionRecord(session.user.id);

  const [profile, twoFactorEnabled, optOuts, subscription] = await Promise.all([
    getUserProfile(session.user.id),
    getTwoFactorEnabled(session.user.id),
    getNotificationOptOuts(session.user.id),
    getSubscription(session.user.id),
  ]);

  return (
    <AppShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
    >
      <SettingsClient
        initialProfile={profile}
        twoFactorEnabled={twoFactorEnabled}
        weeklyDigestOptOut={optOuts.weeklyDigestOptOut}
        weeklyBriefOptOut={optOuts.weeklyBriefOptOut}
        billing={{
          tier: subscription?.tier ?? "trial",
          effectiveTier: effectiveTierFor(subscription),
          status: subscription?.status ?? "trialing",
          trialEndsAt: subscription?.trialEndsAt ?? null,
          currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
          stripeConfigured: stripeConfigured(),
        }}
        user={{ name: session.user.name ?? "", email: session.user.email }}
      />
    </AppShell>
  );
}
