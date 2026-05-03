// src/app/app/settings/chips/page.tsx
// Phase 3 Batch H — settings page mounting the ChipPrefsSection
// component. Mirrors the structure of /app/settings/goals so the user
// gets the same chrome and back-link behavior.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppShell from "@/components/app-shell";
import ChipPrefsSection from "@/components/dashboard/chip-prefs-section";
import { getChipPrefs } from "@/lib/dashboard/chip-prefs";

export const dynamic = "force-dynamic";

export default async function ChipPrefsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const prefs = await getChipPrefs(session.user.id);

  return (
    <AppShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
    >
      <div className="max-w-3xl mx-auto space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Chip preferences</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customize which metric chips appear on your Decision Queue
            and Daily Headline rows.
          </p>
        </div>
        <ChipPrefsSection initialPrefs={prefs} />
      </div>
    </AppShell>
  );
}
