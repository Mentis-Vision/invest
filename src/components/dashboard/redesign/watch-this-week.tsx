import Link from "next/link";
import type { QueueItem, ItemTypeKey } from "@/lib/dashboard/types";

const BADGE: Record<string, { label: string; bg: string }> = {
  catalyst_prep_imminent: { label: "EARNINGS", bg: "var(--decisive)" },
  catalyst_prep_upcoming: { label: "EARNINGS", bg: "var(--decisive)" },
  outcome_action_mark: { label: "REVIEW", bg: "var(--hold)" },
  cash_idle: { label: "DEPLOY", bg: "var(--hold)" },
  stale_rec_held: { label: "REVIEW", bg: "var(--hold)" },
  stale_rec_watched: { label: "REVIEW", bg: "var(--hold)" },
  concentration_breach_severe: { label: "RISK", bg: "var(--sell)" },
  concentration_breach_moderate: { label: "RISK", bg: "var(--sell)" },
  broker_reauth: { label: "RECONNECT", bg: "var(--sell)" },
  rebalance_drift: { label: "REBALANCE", bg: "var(--hold)" },
  goals_setup: { label: "SETUP", bg: "var(--hold)" },
  tax_harvest: { label: "TAX", bg: "var(--buy)" },
  quality_decline: { label: "QUALITY", bg: "var(--sell)" },
  cluster_buying: { label: "INSIDER", bg: "var(--buy)" },
  year_pace_review: { label: "PACE", bg: "var(--buy)" },
};

function badge(itemType: ItemTypeKey): { label: string; bg: string } {
  return BADGE[itemType] ?? { label: "WATCH", bg: "var(--muted-foreground)" };
}

function buildSecondaryText(item: QueueItem): string {
  return item.chips
    .slice(0, 2)
    .map((c) => `${c.label} ${c.value}`)
    .join(" · ");
}

export function WatchThisWeek({
  items,
  totalCount,
}: {
  items: QueueItem[];
  totalCount: number;
}) {
  if (items.length === 0) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-4">
        <div className="text-[10px] tracking-widest uppercase text-[var(--hold)] font-bold">
          Watch this week
        </div>
        <div className="text-xs text-[var(--muted-foreground)] mt-2">
          Nothing to watch this week. Quiet weeks are normal.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-md p-4">
      <div className="flex justify-between items-baseline mb-2">
        <div className="text-[10px] tracking-widest uppercase text-[var(--hold)] font-bold">
          Watch this week · {items.length}
        </div>
        {totalCount > items.length && (
          <Link
            href="/app/history"
            className="text-[10px] text-[var(--decisive)]"
          >
            View all →
          </Link>
        )}
      </div>
      <div className="text-xs leading-relaxed">
        {items.map((item, i) => {
          const b = badge(item.itemType);
          const isLast = i === items.length - 1;
          return (
            <Link
              key={item.itemKey}
              href={item.primaryActionHref}
              className={`flex justify-between items-baseline gap-2 py-1.5 ${
                isLast ? "" : "border-b border-dashed border-[var(--border)] mb-1.5"
              } hover:bg-[var(--background)]`}
            >
              <div className="min-w-0 flex-1">
                <span className="font-bold">
                  {item.ticker ? `${item.ticker} · ` : ""}
                  {item.title.replace(/^[A-Z]+ · /, "")}
                </span>{" "}
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  {buildSecondaryText(item)}
                </span>
              </div>
              <span
                className="text-[8px] text-white px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                style={{ backgroundColor: b.bg }}
              >
                {b.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
