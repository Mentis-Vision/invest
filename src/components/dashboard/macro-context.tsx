"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type Macro = Array<{
  indicator: string;
  value: string;
  date: string;
  deltaLabel?: string;
}>;

/**
 * Today's macro context — promotes 4 key indicators to the top of the
 * dashboard for at-a-glance read on the rate / inflation / volatility
 * regime. Delta badges show 12-month change so direction is obvious.
 *
 * Picks indicators intentionally:
 *   - 10Y yield: rate regime
 *   - Fed Funds: policy stance
 *   - CPI YoY: inflation
 *   - VIX: volatility / fear
 */
const PRIORITY_ORDER = [
  "10-Year Treasury Yield",
  "Fed Funds Rate",
  "CPI YoY Inflation",
  "VIX Volatility Index",
];

function DeltaBadge({ delta }: { delta: string }) {
  const isPos = delta.startsWith("+");
  const isNeg = delta.startsWith("-");
  const Icon = isPos ? TrendingUp : isNeg ? TrendingDown : Minus;
  const variant = isPos ? "default" : isNeg ? "destructive" : "secondary";
  return (
    <Badge
      variant={variant}
      className="text-[10px] font-mono px-1.5 py-0 h-4"
    >
      <Icon className="mr-0.5 h-2.5 w-2.5" />
      {delta}
    </Badge>
  );
}

export default function MacroContext({
  macro,
  loading,
}: {
  macro: Macro | null;
  loading: boolean;
}) {
  const ordered = (macro ?? [])
    .slice()
    .sort(
      (a, b) =>
        PRIORITY_ORDER.indexOf(a.indicator) -
        PRIORITY_ORDER.indexOf(b.indicator)
    )
    .filter((m) => PRIORITY_ORDER.includes(m.indicator));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Today&rsquo;s macro</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Rate, inflation, and volatility context.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-24 animate-pulse rounded-md bg-muted/40" />
        ) : ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Macro data unavailable.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {ordered.map((m) => (
              <div key={m.indicator} className="space-y-0.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {shortLabel(m.indicator)}
                </div>
                <div className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-tight">
                  {m.value}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  {m.deltaLabel && <DeltaBadge delta={firstToken(m.deltaLabel)} />}
                  <span className="truncate">{m.date}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[10px] text-muted-foreground">
          Source: FRED (Federal Reserve Economic Data). Not financial advice.
        </p>
      </CardContent>
    </Card>
  );
}

function shortLabel(indicator: string): string {
  switch (indicator) {
    case "10-Year Treasury Yield":
      return "10Y yield";
    case "Fed Funds Rate":
      return "Fed funds";
    case "CPI YoY Inflation":
      return "Inflation YoY";
    case "VIX Volatility Index":
      return "VIX";
    default:
      return indicator;
  }
}

// deltaLabel is like "+0.52pp vs 12mo ago" — show just the first token on the badge
function firstToken(label: string): string {
  return label.split(" ")[0];
}
