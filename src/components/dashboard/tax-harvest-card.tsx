// src/components/dashboard/tax-harvest-card.tsx
// Phase 3 Batch H — drill view for the tax_harvest queue item.
//
// Renders the harvestable losses list (one row per ticker) with:
//   - position ticker
//   - cost basis / current value / loss dollars
//   - sector
//   - suggested wash-sale-safe replacement (or "—" when none)
//
// Always followed by the wash-sale advisor disclaimer. Per the
// Batch H spec: "Suggested replacement is general guidance; verify
// wash-sale safety with your tax advisor before acting."
//
// Pure server component — receives the loader output as props.
// Renders no actions. Tax-loss harvesting is informational only;
// the user reviews, then acts inside their broker. We never wire a
// "execute trade" button (rule #5: SnapTrade access is read-only).

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HarvestableLoss } from "@/lib/dashboard/metrics/tax-loader";

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function TaxHarvestCard({
  losses,
}: {
  losses: HarvestableLoss[];
}) {
  if (losses.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tax-loss harvest</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No harvestable losses right now. We&apos;ll surface positions
            here when their unrealized loss exceeds $200.
          </p>
        </CardContent>
      </Card>
    );
  }

  const total = losses.reduce((acc, l) => acc + l.lossDollars, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Tax-loss harvest:{" "}
          <span className="text-[var(--sell)]">{fmtMoney(Math.abs(total))}</span>{" "}
          unrealized
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Ticker</th>
                <th className="py-2 pr-4 font-medium">Sector</th>
                <th className="py-2 pr-4 font-medium text-right">Cost basis</th>
                <th className="py-2 pr-4 font-medium text-right">
                  Current value
                </th>
                <th className="py-2 pr-4 font-medium text-right">Loss</th>
                <th className="py-2 font-medium">Replacement</th>
              </tr>
            </thead>
            <tbody>
              {losses.map((l) => (
                <tr
                  key={l.ticker}
                  className="border-b border-border/50 last:border-b-0"
                >
                  <td className="py-2 pr-4 font-mono font-semibold">
                    {l.ticker}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {l.sector ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {fmtMoney(l.costBasis)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {fmtMoney(l.currentValue)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-[var(--sell)]">
                    {fmtMoney(l.lossDollars)}
                  </td>
                  <td className="py-2 font-mono">
                    {l.suggestedReplacement ? (
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden>→</span>
                        <span className="font-semibold">
                          {l.suggestedReplacement}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p>
            <strong>Wash-sale notice:</strong> Suggested replacement is
            general guidance; verify wash-sale safety with your tax advisor
            before acting. The IRS wash-sale rule disallows the loss if
            you buy the same or substantially identical security within
            30 days before or after the sale.
          </p>
          <p className="mt-2">
            Past recommendation outcomes are informational only. Not a
            guarantee of future performance. Not investment advice.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
