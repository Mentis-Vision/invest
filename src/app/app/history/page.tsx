import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getUserHistory,
  getUserTrackRecord,
  getUserPatternInsights,
} from "@/lib/history";
import AppShell from "@/components/app-shell";
import HistoryClient from "./history-client";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  // Three parallel reads: journal rows, 30-day aggregate, 90-day
  // pattern insights. Each query is indexed on (userId, createdAt) or
  // (userId, userAction) so fan-out is cheap.
  const [items, trackRecord, patterns] = await Promise.all([
    getUserHistory(session.user.id, 100),
    getUserTrackRecord(session.user.id, 30),
    getUserPatternInsights(session.user.id, 90),
  ]);

  return (
    <AppShell user={{ name: session.user.name ?? "", email: session.user.email }}>
      <HistoryClient
        items={items}
        trackRecord={trackRecord}
        patterns={patterns}
      />
    </AppShell>
  );
}
