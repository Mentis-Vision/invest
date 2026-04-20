import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getUserHistory,
  getUserTrackRecord,
  getUserPatternInsights,
  getActionOutcomeMatrix,
  getReflectionPrompts,
} from "@/lib/history";
import AppShell from "@/components/app-shell";
import HistoryClient from "./history-client";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  // Five parallel reads. All indexed; fan-out is cheap.
  const [items, trackRecord, patterns, matrix, reflections] =
    await Promise.all([
      getUserHistory(session.user.id, { limit: 100, onlyActioned: true }),
      getUserTrackRecord(session.user.id, 30),
      getUserPatternInsights(session.user.id, 90),
      getActionOutcomeMatrix(session.user.id, 90),
      getReflectionPrompts(session.user.id, 3),
    ]);

  return (
    <AppShell user={{ name: session.user.name ?? "", email: session.user.email }}>
      <HistoryClient
        items={items}
        trackRecord={trackRecord}
        patterns={patterns}
        matrix={matrix}
        reflections={reflections}
      />
    </AppShell>
  );
}
