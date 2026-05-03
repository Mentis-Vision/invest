// src/components/dashboard/year-outlook/damodaran-cost-of-capital-card.tsx
//
// Server component. Renders the Damodaran market-implied ERP, the
// 10-year risk-free anchor, and (when a focusTicker is supplied) the
// per-stock implied cost of equity + spread vs the market.
//
// Why on year-outlook:
//   The user originally deferred Shiller CAPE because no stable
//   free source existed. Damodaran's monthly implied ERP is the
//   credible alternative. Surfacing it on the year-outlook surface
//   keeps the "forward-looking valuation anchor" question on the
//   same page as the regime / Buffett indicator chips.
//
// Empty-state: if neither a market ERP nor a focusTicker resolved
// to anything, the card renders a small note. We do not throw.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getDamodaranERP,
  getStockImpliedCOE,
  type StockCostOfCapital,
} from "@/lib/dashboard/metrics/damodaran-loader";
import { AsOfFootnote } from "@/components/dashboard/as-of-footnote";

interface DamodaranCardProps {
  /** Optional ticker to surface the per-stock COE callout. */
  focusTicker?: string | null;
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtSignedPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

interface CellProps {
  label: string;
  value: string;
  hint?: string;
  colorVar?: string;
}

function Cell({ label, value, hint, colorVar }: CellProps) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className="text-lg font-bold tabular-nums"
        style={colorVar ? { color: `var(${colorVar})` } : undefined}
      >
        {value}
      </div>
      {hint ? (
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

function spreadColor(s: number): string {
  if (s > 0.02) return "--buy";
  if (s < -0.02) return "--sell";
  return "--foreground";
}

export async function DamodaranCard({ focusTicker }: DamodaranCardProps) {
  // Live ERP fetch + (optional) per-stock COE in parallel — both are
  // independent, so don't serialize the network round-trips.
  const [erp, stock] = await Promise.all([
    getDamodaranERP(),
    focusTicker && focusTicker.trim().length > 0
      ? getStockImpliedCOE(focusTicker.trim()).catch(
          () => null as StockCostOfCapital | null,
        )
      : Promise.resolve<StockCostOfCapital | null>(null),
  ]);

  const sourceLabel =
    erp.source === "live"
      ? "Damodaran (live)"
      : erp.source === "cached"
        ? "Damodaran (cached)"
        : "Damodaran (anchor)";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          Cost of capital (Damodaran)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Cell
            label="S&P 500 implied ERP"
            value={fmtPct(erp.erp)}
            hint={`${erp.source} — ${erp.asOf}`}
          />
          {stock ? (
            <Cell
              label={`${stock.ticker} risk-free`}
              value={fmtPct(stock.riskFreeRate)}
              hint="10-yr Treasury"
            />
          ) : (
            <Cell
              label="market hurdle"
              value={fmtPct(erp.erp + 0.04)}
              hint="ERP + ~4% rf approx"
            />
          )}
        </div>
        {stock ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Cell
                label={`${stock.ticker} implied COE`}
                value={fmtPct(stock.result.costOfEquity)}
                hint={
                  stock.result.method === "gordon"
                    ? "Gordon Growth: D₁/P + g"
                    : "CAPM: rf + β·ERP"
                }
              />
              <Cell
                label="spread vs market"
                value={fmtSignedPct(stock.spreadVsMarket)}
                hint={
                  stock.spreadVsMarket > 0
                    ? "richer hurdle than index"
                    : stock.spreadVsMarket < 0
                      ? "easier hurdle than index"
                      : "in line"
                }
                colorVar={spreadColor(stock.spreadVsMarket)}
              />
            </div>
            {stock.result.method === "capm" ? (
              <p className="text-[10px] text-muted-foreground">
                CAPM fallback used — no dividend stream to anchor the
                Gordon model. β = {stock.result.inputs.beta?.toFixed(2) ?? "—"}.
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Dividend yield {fmtPct(stock.result.inputs.dividendYield, 2)} +
                growth {fmtPct(stock.result.inputs.growthRate, 1)}.
              </p>
            )}
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Damodaran&apos;s S&amp;P 500 implied ERP — the equity premium
            embedded in current index prices given forward earnings and
            payout assumptions. The credible alternative to Shiller CAPE
            we ship here. Updated monthly from the NYU Stern data file.
          </p>
        )}
        <AsOfFootnote source={sourceLabel} asOf={erp.asOf} />
      </CardContent>
    </Card>
  );
}
