"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  DrillHeader,
  DrillBody,
  DrillSection,
  StatRow,
  DrillFooterLink,
} from "./panel-shell";
import { money, moneyFull, pct, pctRawSigned, num, freshness } from "../format";

type Dossier = {
  capturedAt: string;
  asOf: string;
  headline: string;
  tone: "steady" | "watch" | "inspect" | "concern";
  signals: Array<{
    tone: "up" | "down" | "neutral" | "watch";
    text: string;
  }>;
  narrative: string;
  sourceSummary: {
    hasMarket: boolean;
    hasFundamentals: boolean;
    eventCount: number;
    sentimentCoverage: "finnhub" | "none";
  };
};

/**
 * Drill detail for a single ticker. Fetches the warehouse bundle
 * (market + fundamentals + events + sentiment) via the existing
 * /api/warehouse/ticker/[ticker] endpoint. One call, rate-limited at
 * 120/hr per user.
 */

type WarehouseBundle = {
  ticker: string;
  dossier: Dossier | null;
  market: {
    close: number | null;
    changePct: number | null;
    capturedAt: string;
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
    marketCap: number | null;
    shortInterestPct: number | null;
  } | null;
  fundamentals: {
    periodType: "quarterly" | "annual";
    periodEnding: string;
    revenue: number | null;
    grossProfit: number | null;
    operatingIncome: number | null;
    netIncome: number | null;
    ebitda: number | null;
    epsBasic: number | null;
    epsDiluted: number | null;
    grossMargin: number | null;
    operatingMargin: number | null;
    netMargin: number | null;
    roe: number | null;
    roa: number | null;
    currentRatio: number | null;
    debtToEquity: number | null;
    freeCashFlow: number | null;
    operatingCashFlow: number | null;
    capex: number | null;
    totalAssets: number | null;
    totalLiabilities: number | null;
    totalCash: number | null;
    totalDebt: number | null;
    sharesOutstanding: number | null;
  } | null;
  upcomingEvents: Array<{
    eventType: string;
    eventDate: string;
    details: Record<string, unknown>;
  }>;
  recentEvents: Array<{
    eventType: string;
    eventDate: string;
    details: Record<string, unknown>;
  }>;
  sentiment: {
    newsCount: number;
    bullishPct: number | null;
    bearishPct: number | null;
    buzzRatio: number | null;
    companyNewsScore: number | null;
    sectorAvgScore: number | null;
    topHeadlines:
      | Array<{ title: string; url: string | null; publishedAt: string | null }>
      | null;
  } | null;
};

export function DrillTicker({ ticker }: { ticker: string }) {
  const [data, setData] = useState<WarehouseBundle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/warehouse/ticker/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WarehouseBundle | null) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ticker]);

  const m = data?.market;
  const f = data?.fundamentals;
  const changeTone =
    m?.changePct == null ? "neutral" : m.changePct > 0 ? "up" : "down";

  return (
    <>
      <DrillHeader
        eyebrow="Ticker"
        title={<span className="font-mono tracking-tight">{ticker}</span>}
        subtitle={
          loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> loading warehouse…
            </span>
          ) : m ? (
            <span>
              {moneyFull(m.close)}{" "}
              <span
                className={
                  changeTone === "up"
                    ? "text-[var(--buy)]"
                    : changeTone === "down"
                      ? "text-[var(--sell)]"
                      : ""
                }
              >
                {pctRawSigned(m.changePct)}
              </span>{" "}
              <span className="text-[10px] uppercase tracking-widest opacity-70">
                as of {m.capturedAt}
              </span>
            </span>
          ) : (
            "No warehouse data yet — cron hasn't seen this ticker. Check back tomorrow."
          )
        }
        action={
          <div className="flex gap-2">
            <DrillFooterLink
              href={`/app?view=research&ticker=${encodeURIComponent(ticker)}`}
            >
              Run full research
            </DrillFooterLink>
            <DrillFooterLink
              href={`/app/history?filter=${encodeURIComponent(ticker)}`}
            >
              Recommendation history
            </DrillFooterLink>
          </div>
        }
      />
      <DrillBody>
        {!loading && data?.dossier && (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/50 p-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-2 w-2 rounded-full ${toneDot(data.dossier.tone)}`}
                  aria-hidden
                />
                <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
                  Overnight brief
                </span>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Fresh · {freshness(data.dossier.asOf)}
              </span>
            </div>
            <p className="text-base font-medium leading-snug text-[var(--foreground)]">
              {data.dossier.headline}
            </p>
            {data.dossier.signals.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {data.dossier.signals.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm leading-relaxed"
                  >
                    <span
                      className={`mt-1.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${signalDot(s.tone)}`}
                      aria-hidden
                    />
                    <span className="text-[var(--foreground)]/90">
                      {s.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.dossier.narrative && (
              <div className="mt-3 whitespace-pre-line text-xs leading-relaxed text-[var(--muted-foreground)] border-t border-[var(--border)] pt-3">
                {data.dossier.narrative}
              </div>
            )}
            <p className="mt-3 text-[10px] italic text-[var(--muted-foreground)]">
              Generated overnight from warehouse data — no AI, no external
              fetches. The detailed tables below show the source signals.
            </p>
          </section>
        )}

        {!loading && m && (
          <DrillSection
            label="Valuation"
            description={`warehouse · ${m.capturedAt}`}
          >
            <StatRow label="Market cap" value={money(m.marketCap)} />
            <StatRow label="P/E (trailing)" value={num(m.peTrailing)} />
            <StatRow label="P/E (forward)" value={num(m.peForward)} />
            <StatRow label="P/B" value={num(m.priceToBook)} />
            <StatRow label="P/S" value={num(m.priceToSales)} />
            <StatRow label="EV/EBITDA" value={num(m.evToEbitda)} />
            <StatRow
              label="Dividend yield"
              value={m.dividendYield != null ? pct(m.dividendYield) : "—"}
            />
            <StatRow label="EPS (TTM)" value={money(m.epsTtm, 2)} />
            <StatRow label="Beta" value={num(m.beta)} />
          </DrillSection>
        )}

        {!loading && m && (
          <DrillSection label="Range & technicals">
            <StatRow
              label="52-week range"
              value={
                m.low52w != null && m.high52w != null
                  ? `${moneyFull(m.low52w)} — ${moneyFull(m.high52w)}`
                  : "—"
              }
            />
            <StatRow label="50-day MA" value={moneyFull(m.ma50)} />
            <StatRow label="200-day MA" value={moneyFull(m.ma200)} />
            <StatRow label="RSI (14d)" value={num(m.rsi14)} />
            <StatRow
              label="MACD"
              value={`${num(m.macd, 4)} / ${num(m.macdSignal, 4)}`}
              hint="macd/signal"
            />
            <StatRow
              label="Bollinger"
              value={
                m.bollingerLower != null && m.bollingerUpper != null
                  ? `${moneyFull(m.bollingerLower)} — ${moneyFull(m.bollingerUpper)}`
                  : "—"
              }
            />
            <StatRow label="VWAP (20d)" value={moneyFull(m.vwap20d)} />
            <StatRow
              label="Relative strength vs SPY (30d)"
              value={pctRawSigned(m.relStrengthSpy30d)}
              tone={
                m.relStrengthSpy30d == null
                  ? "neutral"
                  : m.relStrengthSpy30d > 0
                    ? "up"
                    : "down"
              }
            />
            {m.shortInterestPct != null && (
              <StatRow
                label="Short interest"
                value={pct(m.shortInterestPct)}
                tone={
                  m.shortInterestPct > 0.2
                    ? "warn"
                    : m.shortInterestPct > 0.1
                      ? "neutral"
                      : "neutral"
                }
                hint={
                  m.shortInterestPct > 0.2
                    ? "elevated"
                    : undefined
                }
              />
            )}
          </DrillSection>
        )}

        {!loading && m && (
          <DrillSection label="Analyst consensus">
            <StatRow
              label="Target (mean)"
              value={moneyFull(m.analystTargetMean)}
              hint={
                m.analystTargetMean != null && m.close != null
                  ? pctRawSigned(
                      ((m.analystTargetMean - m.close) / m.close) * 100
                    )
                  : undefined
              }
            />
            <StatRow label="Coverage" value={num(m.analystCount, 0)} />
            <StatRow label="Rating" value={m.analystRating ?? "—"} />
          </DrillSection>
        )}

        {!loading && f && (
          <DrillSection
            label={`Fundamentals · ${f.periodType}`}
            description={`period ending ${f.periodEnding}`}
          >
            <StatRow label="Revenue" value={money(f.revenue)} />
            <StatRow label="Gross profit" value={money(f.grossProfit)} />
            <StatRow label="Operating income" value={money(f.operatingIncome)} />
            <StatRow label="Net income" value={money(f.netIncome)} />
            <StatRow label="EBITDA" value={money(f.ebitda)} />
            <StatRow
              label="EPS (basic / diluted)"
              value={`${num(f.epsBasic)} / ${num(f.epsDiluted)}`}
            />
            <StatRow label="Gross margin" value={pct(f.grossMargin)} />
            <StatRow label="Operating margin" value={pct(f.operatingMargin)} />
            <StatRow label="Net margin" value={pct(f.netMargin)} />
            <StatRow label="ROE" value={pct(f.roe)} />
            <StatRow label="ROA" value={pct(f.roa)} />
            <StatRow
              label="Current ratio"
              value={num(f.currentRatio)}
              hint={
                f.currentRatio != null && f.currentRatio < 1
                  ? "tight"
                  : undefined
              }
              tone={
                f.currentRatio != null && f.currentRatio < 1
                  ? "warn"
                  : "neutral"
              }
            />
            <StatRow label="Debt / Equity" value={num(f.debtToEquity)} />
            <StatRow label="Operating cash flow" value={money(f.operatingCashFlow)} />
            <StatRow label="Free cash flow" value={money(f.freeCashFlow)} />
            <StatRow label="Capex" value={money(f.capex)} />
            <StatRow label="Total assets" value={money(f.totalAssets)} />
            <StatRow label="Total liabilities" value={money(f.totalLiabilities)} />
            <StatRow label="Total cash" value={money(f.totalCash)} />
            <StatRow label="Total debt" value={money(f.totalDebt)} />
            <StatRow
              label="Shares outstanding"
              value={money(f.sharesOutstanding, 0).replace("$", "")}
            />
          </DrillSection>
        )}

        {!loading && data && data.upcomingEvents.length > 0 && (
          <DrillSection
            label="Upcoming events"
            description={`${data.upcomingEvents.length} scheduled`}
          >
            <ul className="space-y-1.5 text-sm">
              {data.upcomingEvents.slice(0, 6).map((e, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-4"
                >
                  <span className="text-[var(--muted-foreground)]">
                    {humanEventType(e.eventType)}
                  </span>
                  <span className="font-mono tabular-nums">{e.eventDate}</span>
                </li>
              ))}
            </ul>
          </DrillSection>
        )}

        {!loading && data && data.recentEvents.length > 0 && (
          <DrillSection
            label="Recent events"
            description="last 90 days"
          >
            <ul className="space-y-1.5 text-sm">
              {data.recentEvents.slice(0, 6).map((e, i) => {
                const acc = e.details?.accession as string | undefined;
                const url = e.details?.url as string | undefined;
                return (
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <span className="text-[var(--muted-foreground)]">
                      {humanEventType(e.eventType)}
                      {acc && (
                        <span className="ml-2 text-[10px] font-mono tabular-nums opacity-60">
                          {acc}
                        </span>
                      )}
                    </span>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono tabular-nums hover:underline underline-offset-4"
                      >
                        {e.eventDate} ↗
                      </a>
                    ) : (
                      <span className="font-mono tabular-nums">
                        {e.eventDate}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </DrillSection>
        )}

        {!loading && data?.sentiment && (
          <DrillSection
            label="Sentiment"
            description={
              data.sentiment.newsCount > 0
                ? `${data.sentiment.newsCount} headlines`
                : "no Finnhub key — news feed unavailable"
            }
          >
            {data.sentiment.bullishPct != null && (
              <>
                <StatRow
                  label="Bullish %"
                  value={pct(data.sentiment.bullishPct)}
                  tone="up"
                />
                <StatRow
                  label="Bearish %"
                  value={pct(data.sentiment.bearishPct)}
                  tone="down"
                />
                <StatRow
                  label="Buzz ratio"
                  value={num(data.sentiment.buzzRatio)}
                  hint="vs weekly avg"
                />
                {data.sentiment.companyNewsScore != null && (
                  <StatRow
                    label="News score"
                    value={num(data.sentiment.companyNewsScore, 2)}
                    tone={
                      data.sentiment.companyNewsScore > 0.1
                        ? "up"
                        : data.sentiment.companyNewsScore < -0.1
                          ? "down"
                          : "neutral"
                    }
                    hint="range -1 … +1"
                  />
                )}
                {data.sentiment.sectorAvgScore != null && (
                  <StatRow
                    label="Sector avg score"
                    value={num(data.sentiment.sectorAvgScore, 2)}
                    hint="peer baseline"
                  />
                )}
              </>
            )}
            {data.sentiment.topHeadlines &&
              data.sentiment.topHeadlines.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-xs">
                  {data.sentiment.topHeadlines.slice(0, 5).map((h, i) => (
                    <li key={i}>
                      {h.url ? (
                        <a
                          href={h.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline underline-offset-4"
                        >
                          {h.title}
                        </a>
                      ) : (
                        h.title
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </DrillSection>
        )}

        {!loading && !m && (
          <div className="rounded-md border border-[var(--border)] bg-[var(--secondary)] px-4 py-5 text-sm text-[var(--muted-foreground)]">
            The warehouse hasn&rsquo;t captured this ticker yet. The nightly
            cron populates it from Yahoo the next time it runs. You can
            still run AI research on it directly.
          </div>
        )}
      </DrillBody>
    </>
  );
}

function toneDot(t: "steady" | "watch" | "inspect" | "concern"): string {
  switch (t) {
    case "steady":
      return "bg-[var(--buy)]";
    case "concern":
      return "bg-[var(--sell)]";
    case "inspect":
      return "bg-[var(--decisive)]";
    default:
      return "bg-[var(--hold)]";
  }
}

function signalDot(t: "up" | "down" | "neutral" | "watch"): string {
  switch (t) {
    case "up":
      return "bg-[var(--buy)]";
    case "down":
      return "bg-[var(--sell)]";
    case "watch":
      return "bg-[var(--decisive)]";
    default:
      return "bg-[var(--muted-foreground)]/50";
  }
}

function humanEventType(t: string): string {
  switch (t) {
    case "earnings":
      return "Earnings call";
    case "dividend_ex":
      return "Ex-dividend date";
    case "dividend_pay":
      return "Dividend pay date";
    case "filing_8k":
      return "8-K filing";
    case "filing_10q":
      return "10-Q filing";
    case "filing_10k":
      return "10-K filing";
    case "split":
      return "Stock split";
    default:
      return t;
  }
}
