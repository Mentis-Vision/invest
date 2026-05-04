// src/app/app/settings/data/page.tsx
// Data & Privacy settings page. Spec §8 — user-control surface:
// per-connection summary (count + earliest stored date), CSV export,
// per-connection purge.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import AppShell from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { DataPurgeButton } from "@/components/dashboard/data-purge-button";

export const dynamic = "force-dynamic";

interface ConnectionRow {
  account_id: string;
  source: string;
  earliest_txn_date: string | null;
  txn_count: number;
}

export default async function DataPrivacyPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/sign-in");
  const userId = session.user.id;

  const { rows } = await pool.query<ConnectionRow>(
    `SELECT account_id, source,
            MIN(txn_date)::text AS earliest_txn_date,
            COUNT(*)::int       AS txn_count
     FROM broker_transactions
     WHERE "userId" = $1
     GROUP BY account_id, source
     ORDER BY earliest_txn_date NULLS LAST`,
    [userId],
  );

  return (
    <AppShell
      user={{ name: session.user.name ?? "", email: session.user.email }}
    >
      <main className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Data &amp; Privacy</h1>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Connection summary</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No transaction history stored yet. Backfill runs in the
              background after you connect a broker.
            </p>
          ) : (
            <ul className="text-sm space-y-2">
              {rows.map((r) => (
                <li
                  key={`${r.source}-${r.account_id}`}
                  className="flex justify-between items-baseline gap-2"
                >
                  <span className="flex-1 min-w-0 truncate">
                    <b>{r.source === "snaptrade" ? "SnapTrade" : "Plaid"}</b> ·
                    earliest {r.earliest_txn_date ?? "—"} · {r.txn_count} stored
                  </span>
                  <DataPurgeButton accountId={r.account_id} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-2">Export</h2>
          <p className="text-xs text-[var(--muted-foreground)] mb-3">
            Download all stored transactions as CSV. Includes: date, source,
            account_id, action, ticker, qty, price, amount, fees. Excludes
            encrypted broker memos.
          </p>
          <a
            href="/api/user/transactions/export"
            className="inline-block bg-[var(--foreground)] text-[var(--background)] text-xs font-bold px-3 py-1.5 rounded"
          >
            Download CSV
          </a>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-2">About this data</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Transaction history is encrypted at rest. We never store your
            broker login credentials or account numbers. See{" "}
            <a href="/privacy" className="underline">
              Privacy Policy
            </a>{" "}
            for full details.
          </p>
        </Card>
      </main>
    </AppShell>
  );
}
