import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ensureSubscriptionRecord } from "@/lib/subscription";
import DashboardClient from "@/components/dashboard-client";

export default async function Home() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  // Lazy-create the trial subscription row on first /app load. Idempotent
  // (ON CONFLICT DO NOTHING). Doing it here rather than in a BetterAuth
  // signup callback avoids tangling with the verification-email flow —
  // the trial timer starts the first time the user actually lands in the
  // app, not the moment they create the account, which is more
  // forgiving for users who sign up days before they verify.
  await ensureSubscriptionRecord(session.user.id);

  return (
    <DashboardClient
      user={{ name: session.user.name, email: session.user.email }}
    />
  );
}
