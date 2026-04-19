import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserProfile } from "@/lib/user-profile";
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

async function getWeeklyDigestOptOut(userId: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ weeklyDigestOptOut: boolean | null }>(
      `SELECT "weeklyDigestOptOut" FROM "user" WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return Boolean(rows[0]?.weeklyDigestOptOut);
  } catch {
    return false;
  }
}

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [profile, twoFactorEnabled, weeklyDigestOptOut] = await Promise.all([
    getUserProfile(session.user.id),
    getTwoFactorEnabled(session.user.id),
    getWeeklyDigestOptOut(session.user.id),
  ]);

  return (
    <AppShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
    >
      <SettingsClient
        initialProfile={profile}
        twoFactorEnabled={twoFactorEnabled}
        weeklyDigestOptOut={weeklyDigestOptOut}
        user={{ name: session.user.name ?? "", email: session.user.email }}
      />
    </AppShell>
  );
}
