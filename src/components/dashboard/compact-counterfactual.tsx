"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useClientNowMs } from "@/lib/client/use-client-now";

type Result = {
  ticker: string;
  recDate: string;
  deltaActual: number;
  deltaIgnored: number;
};

/**
 * Single-line impact pill shown on Dashboard AFTER the user acts on
 * today's Next Move. "You trimmed LINK 4 days ago → +$180 vs doing
 * nothing · Full review →"
 */
export function CompactCounterfactual({ recId }: { recId: string }) {
  const [data, setData] = useState<Result | null>(null);
  const nowMs = useClientNowMs();
  useEffect(() => {
    let alive = true;
    fetch(`/api/journal/counterfactual/${recId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setData(d as Result))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [recId]);

  if (!data || nowMs == null) return null;
  const days = Math.floor(
    (nowMs - new Date(data.recDate).getTime()) / 864e5
  );
  const delta = data.deltaActual - data.deltaIgnored;
  const sign = delta >= 0 ? "+" : "−";

  return (
    <Link
      href="/app/history"
      className="block rounded-md border border-border bg-card px-4 py-2 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      Your {data.ticker} action {days} day{days === 1 ? "" : "s"} ago →{" "}
      <span
        className={`font-mono ${delta >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}
      >
        {sign}${Math.abs(delta).toLocaleString("en-US", { maximumFractionDigits: 0 })}
      </span>{" "}
      vs doing nothing · <span className="underline underline-offset-4">Full review →</span>
    </Link>
  );
}
