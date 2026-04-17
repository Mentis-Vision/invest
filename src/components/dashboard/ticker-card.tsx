"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * Ticker card with three display tiers:
 *   - Basic: price, 52w range, P/E, div yield, analyst target, headline
 *   - Standard: +forward P/E, P/B, P/S, EV/EBITDA, 50d/200d MA, beta, sentiment
 *   - Advanced: +RSI, MACD, Bollinger, VWAP, rel-strength, full fundamentals
 *
 * Density prop controls the default tier; user can always expand via More.
 */

type Market = {
  close: number | null;
  changePct: number | null;
  peTrailing: number | null;
  peForward: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;
  dividendYield: number | null;
  epsTtm: number | null;
  high52w: number | null;
  low52w: number | null;
  ma50: number | null;
  ma200: number | null;
  beta: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  vwap20d: number | null;
  relStrengthSpy30d: number | null;
  analystTargetMean: number | null;
  analystCount: number | null;
  analystRating: string | null;
} | null;

type Sentiment = {
  bullishPct: number | null;
  bearishPct: number | null;
  buzzRatio: number | null;
} | null;

type Fundamentals = {
  revenue: number | null;
  netIncome: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  roe: number | null;
  debtToEquity: number | null;
  freeCashFlow: number | null;
} | null;

export type TickerCardDensity = "basic" | "standard" | "advanced";

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(2)}`;
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function pctRaw(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  return n.toFixed(digits);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

export default function TickerCard({
  ticker,
  market,
  sentiment,
  fundamentals,
  density = "basic",
}: {
  ticker: string;
  market: Market;
  sentiment: Sentiment;
  fundamentals: Fundamentals;
  density?: TickerCardDensity;
}) {
  // Start at the user's default tier; they can still toggle further.
  const [tier, setTier] = useState<TickerCardDensity>(density);

  const showStandard = tier === "standard" || tier === "advanced";
  const showAdvanced = tier === "advanced";

  const netMarginComputed =
    fundamentals?.netIncome != null && fundamentals?.revenue
      ? fundamentals.netIncome / fundamentals.revenue
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between">
          <CardTitle className="font-mono text-base">{ticker}</CardTitle>
          {market?.changePct != null && (
            <span
              className={`font-mono text-xs ${
                market.changePct >= 0
                  ? "text-[var(--buy)]"
                  : "text-[var(--sell)]"
              }`}
            >
              {market.changePct >= 0 ? "+" : ""}
              {pctRaw(market.changePct)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {/* Basic tier */}
        <Row label="Price" value={money(market?.close)} />
        <Row
          label="52-wk range"
          value={
            market?.low52w != null && market.high52w != null
              ? `${money(market.low52w)} – ${money(market.high52w)}`
              : "—"
          }
        />
        <Row label="P/E (TTM)" value={fmt(market?.peTrailing)} />
        <Row label="Div yield" value={pct(market?.dividendYield)} />
        <Row label="Analyst target" value={money(market?.analystTargetMean)} />

        {/* Standard tier */}
        {showStandard && (
          <>
            <div className="my-2 h-px bg-border/60" />
            <Row label="P/E (Fwd)" value={fmt(market?.peForward)} />
            <Row label="P/B" value={fmt(market?.priceToBook)} />
            <Row label="P/S" value={fmt(market?.priceToSales)} />
            <Row label="EV/EBITDA" value={fmt(market?.evToEbitda)} />
            <Row label="50d MA" value={money(market?.ma50)} />
            <Row label="200d MA" value={money(market?.ma200)} />
            <Row label="Beta" value={fmt(market?.beta)} />
            <Row label="Bullish %" value={pct(sentiment?.bullishPct)} />
            <Row label="Bearish %" value={pct(sentiment?.bearishPct)} />
          </>
        )}

        {/* Advanced tier */}
        {showAdvanced && (
          <>
            <div className="my-2 h-px bg-border/60" />
            <Row label="RSI (14d)" value={fmt(market?.rsi14)} />
            <Row label="MACD" value={fmt(market?.macd, 4)} />
            <Row label="MACD signal" value={fmt(market?.macdSignal, 4)} />
            <Row
              label="Bollinger"
              value={
                market?.bollingerLower != null && market.bollingerUpper != null
                  ? `${money(market.bollingerLower)} – ${money(market.bollingerUpper)}`
                  : "—"
              }
            />
            <Row label="VWAP (20d)" value={money(market?.vwap20d)} />
            <Row
              label="RS vs SPY (30d)"
              value={pctRaw(market?.relStrengthSpy30d)}
            />
            <Row label="Revenue" value={money(fundamentals?.revenue)} />
            <Row label="Gross margin" value={pct(fundamentals?.grossMargin)} />
            <Row label="Net margin" value={pct(netMarginComputed)} />
            <Row label="ROE" value={pct(fundamentals?.roe)} />
            <Row label="Debt/Equity" value={fmt(fundamentals?.debtToEquity)} />
            <Row
              label="Free cash flow"
              value={money(fundamentals?.freeCashFlow)}
            />
          </>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="mt-2 h-7 w-full text-[11px]"
          onClick={() =>
            setTier((t) =>
              t === "basic"
                ? "standard"
                : t === "standard"
                  ? "advanced"
                  : "basic"
            )
          }
        >
          {tier === "advanced" ? (
            <>
              <ChevronUp className="mr-1 h-3 w-3" />
              Collapse
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-3 w-3" />
              Show more
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
