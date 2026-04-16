import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserProfile } from "@/lib/user-profile";
import AppShell from "@/components/app-shell";
import SettingsClient from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const profile = await getUserProfile(session.user.id);

  return (
    <AppShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
    >
      <SettingsClient
        initialProfile={profile}
        user={{ name: session.user.name ?? "", email: session.user.email }}
      />
    </AppShell>
  );
}
