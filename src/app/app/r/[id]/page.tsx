import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getRecommendationForUser } from "@/lib/history";
import AppShell from "@/components/app-shell";
import RecommendationClient from "./recommendation-client";

export const dynamic = "force-dynamic";

export default async function RecommendationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { id } = await params;

  // Basic UUID shape guard — avoids a pointless DB round-trip on garbage input.
  if (!/^[0-9a-fA-F-]{10,}$/.test(id)) notFound();

  const rec = await getRecommendationForUser(session.user.id, id);
  if (!rec) notFound();

  return (
    <AppShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
    >
      <RecommendationClient rec={rec} />
    </AppShell>
  );
}
