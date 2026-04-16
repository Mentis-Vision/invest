import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserHistory, getUserTrackRecord } from "@/lib/history";
import AppShell from "@/components/app-shell";
import HistoryClient from "./history-client";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [items, trackRecord] = await Promise.all([
    getUserHistory(session.user.id, 100),
    getUserTrackRecord(session.user.id, 30),
  ]);

  return (
    <AppShell userName={session.user.name ?? session.user.email}>
      <HistoryClient items={items} trackRecord={trackRecord} />
    </AppShell>
  );
}
