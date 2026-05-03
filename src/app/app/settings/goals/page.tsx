// src/app/app/settings/goals/page.tsx
// Full-page goals editor at /app/settings/goals. Renders inside the
// existing AppShell so the user sees the same chrome as the rest of
// the app. Goals come from `getUserGoals` (defaults to all-nulls if no
// user_profile row exists yet).

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AppShell from "@/components/app-shell";
import GoalsForm from "@/components/dashboard/goals-form";
import { getUserGoals } from "@/lib/dashboard/goals-loader";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const goals = await getUserGoals(session.user.id);

  return (
    <AppShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
    >
      <div className="max-w-3xl mx-auto space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Goals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Personal targets that drive your dashboard&apos;s pacing and
            rebalance prompts.
          </p>
        </div>
        <GoalsForm initialGoals={goals} />
      </div>
    </AppShell>
  );
}
