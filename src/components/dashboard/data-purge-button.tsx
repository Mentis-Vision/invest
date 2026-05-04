// src/components/dashboard/data-purge-button.tsx
// Per-connection delete-history button on /app/settings/data.
// Spec §8 — user must be able to purge transaction history per
// broker connection without disconnecting the broker itself.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function DataPurgeButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function purge() {
    if (
      !confirm(
        "Delete all stored transactions and reconstructed history from this connection? Your current holdings remain. This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/user/transactions/${encodeURIComponent(accountId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`purge failed: ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      alert(`Couldn't purge: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={purge}
      disabled={busy}
      className="text-[10px] border border-[var(--sell)] text-[var(--sell)] px-2 py-0.5 rounded disabled:opacity-50 flex-shrink-0"
    >
      {busy ? "Deleting…" : "Delete history"}
    </button>
  );
}
