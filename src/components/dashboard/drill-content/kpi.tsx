"use client";

import { DrillHeader, DrillBody, DrillSection } from "./panel-shell";

/**
 * Per-KPI explanation + "how this is computed" + a pointer to where to
 * change the behavior. Keeps users oriented when they click a big
 * number on the hero/KPI strip and want to understand it.
 */

type Metric =
  | "total_value"
  | "day_change"
  | "period_change"
  | "hit_rate"
  | "positions"
  | "alerts_active"
  | "cash_share"
  | "brokerage_balance"
  | "institution_count"
  | "largest_position_pct";

const COPY: Record<
  Metric,
  { title: string; method: string; depends: string; action: string }
> = {
  total_value: {
    title: "Total portfolio value",
    method:
      "Sum of market value across every connected brokerage account. " +
      "Market value for each holding is shares × last synced price; if " +
      "the broker didn't supply a price, we fall back to average cost × shares.",
    depends:
      "SnapTrade syncs holdings every night. If your connection is stale, the " +
      "number here is stale too — reconnect at Integrations.",
    action: "Open Integrations to reconnect or add accounts.",
  },
  day_change: {
    title: "Today's change",
    method:
      "Current quote − last synced price, summed across holdings, weighted by " +
      "share count. The underlying quotes come from the warehouse (populated " +
      "nightly) and fall back to Yahoo live when a ticker isn't yet in the warehouse.",
    depends:
      "Crypto price coverage is currently unreliable via Yahoo — crypto holdings " +
      "are excluded from day-change alerts until the CoinGecko integration lands.",
    action: "See ticker drill-down for per-security delta.",
  },
  period_change: {
    title: "Period change",
    method:
      "Change in total portfolio value across the chosen window, measured from " +
      "the daily portfolio_snapshot rows captured by the nightly cron. First " +
      "snapshot is day 1 of your account — earlier is not reconstructable.",
    depends:
      "Only appears once you have ≥2 snapshots. After one night of cron, the " +
      "1D value becomes available.",
    action: "Toggle timeframe in the hero strip.",
  },
  hit_rate: {
    title: "Recommendation hit rate",
    method:
      "Wins ÷ evaluated. A rec is a win if, at its check date (N days after " +
      "the call), the price moved in the recommended direction by ≥3%. " +
      "Skips count in evaluated but not in wins.",
    depends:
      "Requires at least one evaluated rec. New accounts see 0/0 until their " +
      "first outcome lands — usually ~30 days after the first BUY/SELL.",
    action: "Open Track Record for the full list of evaluated recs.",
  },
  positions: {
    title: "Position count",
    method:
      "Distinct holdings across all connected brokerage accounts. Two accounts " +
      "holding the same ticker count as one position for this stat; the " +
      "allocation donut shows them pooled.",
    depends: "Pulled at request time from /api/snaptrade/holdings.",
    action: "Visit Portfolio view for the full list.",
  },
  alerts_active: {
    title: "Active alerts",
    method:
      "Overnight changes we flagged and you haven't dismissed yet: ≥5% price " +
      "moves on held tickers, material Form 4 insider transactions, and " +
      "positions above concentration thresholds (25% warn / 40% material).",
    depends:
      "Generated nightly. Re-runs skip already-alerted events via a dedup key so " +
      "the same move never fires twice.",
    action: "Dismiss from the alert feed.",
  },
  cash_share: {
    title: "Cash share of portfolio",
    method:
      "Sum of holdings flagged by SnapTrade as cash or money-market, divided by " +
      "total portfolio value. Uninvested cash is meaningful context when the " +
      "market looks frothy.",
    depends:
      "Only what the broker reports as cash positions — sweep balances not held " +
      "as line items will be missing.",
    action:
      "Check your broker's cash-sweep settings to make sure cash shows up as " +
      "a holding.",
  },
  brokerage_balance: {
    title: "Brokerage balance",
    method:
      "Total balance reported by your broker — includes invested positions, " +
      "uninvested cash, settlement balances, and pending dividends. Differs " +
      "from positions value when there's idle cash sitting on the side.",
    depends:
      "SnapTrade syncs balances every night. Cash drag (balance − positions) " +
      "shows up underneath the value when material.",
    action: "Compare to Positions value to see your cash drag.",
  },
  institution_count: {
    title: "Linked institutions",
    method:
      "Distinct brokerages we sync from. Two accounts at the same broker " +
      "(taxable + IRA) count as one institution; the position table shows " +
      "them grouped under their account labels.",
    depends:
      "Each connection is read-only via SnapTrade. We never initiate trades " +
      "or move money — link as many as you want for a unified view.",
    action: "Open Portfolio to link another account.",
  },
  largest_position_pct: {
    title: "Largest position",
    method:
      "Single biggest holding as a % of total portfolio value. Concentration " +
      "matters for risk: a 40%+ single position means one bad earnings " +
      "report can take the whole portfolio with it.",
    depends:
      "Computed at request time from your latest synced holdings. Updates " +
      "with each SnapTrade sync.",
    action:
      "If concentration > 25%, the alerts feed surfaces it as a watch item. " +
      "Above 40% it becomes a material concentration alert.",
  },
};

export function DrillKpi({
  metric,
  label,
  valueLabel,
}: {
  metric: Metric;
  label: string;
  valueLabel: string;
}) {
  const copy = COPY[metric];
  return (
    <>
      <DrillHeader
        eyebrow="Metric"
        title={<span>{copy.title}</span>}
        subtitle={
          <span className="font-mono tabular-nums text-lg">{valueLabel}</span>
        }
      />
      <DrillBody>
        <DrillSection label="How this is computed">
          <p className="text-sm leading-relaxed text-[var(--foreground)]">
            {copy.method}
          </p>
        </DrillSection>

        <DrillSection label="Data dependencies">
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            {copy.depends}
          </p>
        </DrillSection>

        <DrillSection label="Next step">
          <p className="text-sm leading-relaxed text-[var(--foreground)]">
            {copy.action}
          </p>
        </DrillSection>

        <p className="mt-4 text-[10px] italic text-[var(--muted-foreground)]">
          ClearPath is informational only. Not investment advice.
          {label && <span> · metric label: {label}</span>}
        </p>
      </DrillBody>
    </>
  );
}
