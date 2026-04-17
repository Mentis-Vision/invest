import { pool } from "../db";
import { log, errorInfo } from "../log";
import type {
  TickerMarketRow,
  TickerFundamentalsRow,
  TickerEventRow,
  TickerSentimentRow,
} from "./types";

/**
 * Heuristic (zero-AI) nightly dossier generator.
 *
 * Takes the warehouse rows we already populate nightly and composes a
 * human-readable brief: headline, 3–8 bullet signals, prose narrative.
 * No LLM call, no external fetch — pure TypeScript reading columns we
 * already have. Cost to run per ticker: effectively $0.
 *
 * The product thesis: "ClearPath analyzes your portfolio once, at night.
 * Wake up to a considered brief." This file IS that promise.
 */

export type DossierTone = "steady" | "watch" | "inspect" | "concern";
export type SignalTone = "up" | "down" | "neutral" | "watch";

export type DossierSignal = {
  tone: SignalTone;
  text: string;
};

export type TickerDossier = {
  ticker: string;
  capturedAt: string; // ISO date
  asOf: string;
  headline: string;
  tone: DossierTone;
  signals: DossierSignal[];
  narrative: string;
  sourceSummary: {
    hasMarket: boolean;
    hasFundamentals: boolean;
    eventCount: number;
    sentimentCoverage: "finnhub" | "none";
  };
};

export type DossierInputs = {
  market: TickerMarketRow | null;
  fundamentals: TickerFundamentalsRow | null;
  upcomingEvents: TickerEventRow[];
  recentEvents: TickerEventRow[];
  sentiment: TickerSentimentRow | null;
};

/**
 * Pure compute: inputs → dossier. Doesn't touch DB, doesn't fetch anything.
 * Trivially unit-testable (once we have a test harness).
 */
export function buildDossier(
  ticker: string,
  inputs: DossierInputs
): TickerDossier {
  const { market, fundamentals, upcomingEvents, recentEvents, sentiment } =
    inputs;

  const signals: DossierSignal[] = [];

  // --- Price action ---
  if (market?.close != null && market.changePct != null) {
    if (Math.abs(market.changePct) >= 5) {
      signals.push({
        tone: market.changePct > 0 ? "up" : "down",
        text: `Price ${market.changePct > 0 ? "up" : "down"} ${Math.abs(market.changePct).toFixed(2)}% in the last session — a material single-day move.`,
      });
    } else if (Math.abs(market.changePct) >= 2) {
      signals.push({
        tone: market.changePct > 0 ? "up" : "down",
        text: `Moved ${market.changePct > 0 ? "+" : ""}${market.changePct.toFixed(2)}% yesterday.`,
      });
    }
  }

  // --- 52-week positioning ---
  if (
    market?.close != null &&
    market.high52w != null &&
    market.low52w != null &&
    market.high52w > market.low52w
  ) {
    const range = market.high52w - market.low52w;
    const pos = ((market.close - market.low52w) / range) * 100;
    if (pos >= 90) {
      signals.push({
        tone: "watch",
        text: `Trading at ${pos.toFixed(0)}% of its 52-week range — near the top of the band.`,
      });
    } else if (pos <= 15) {
      signals.push({
        tone: "watch",
        text: `Trading at ${pos.toFixed(0)}% of its 52-week range — deep in the lower band.`,
      });
    }
  }

  // --- Moving averages ---
  if (market?.close != null && market.ma50 != null && market.ma200 != null) {
    if (market.ma50 > market.ma200 * 1.001 && market.close > market.ma50) {
      signals.push({
        tone: "up",
        text: `50-day MA above 200-day MA (golden-cross regime); price above both.`,
      });
    } else if (market.ma50 < market.ma200 * 0.999 && market.close < market.ma50) {
      signals.push({
        tone: "down",
        text: `50-day MA below 200-day MA (death-cross regime); price below both.`,
      });
    } else if (market.close < market.ma50 * 0.97) {
      signals.push({
        tone: "watch",
        text: `Trading >3% below the 50-day MA — short-term weakness.`,
      });
    }
  }

  // --- RSI ---
  if (market?.rsi14 != null) {
    if (market.rsi14 >= 70) {
      signals.push({
        tone: "watch",
        text: `RSI at ${market.rsi14.toFixed(0)} — technically overbought.`,
      });
    } else if (market.rsi14 <= 30) {
      signals.push({
        tone: "watch",
        text: `RSI at ${market.rsi14.toFixed(0)} — technically oversold.`,
      });
    }
  }

  // --- Relative strength vs SPY ---
  if (market?.relStrengthSpy30d != null) {
    if (market.relStrengthSpy30d >= 8) {
      signals.push({
        tone: "up",
        text: `Outperforming SPY by ${market.relStrengthSpy30d.toFixed(1)}pp over 30 days.`,
      });
    } else if (market.relStrengthSpy30d <= -8) {
      signals.push({
        tone: "down",
        text: `Underperforming SPY by ${Math.abs(market.relStrengthSpy30d).toFixed(1)}pp over 30 days.`,
      });
    }
  }

  // --- Valuation ---
  if (market?.peTrailing != null && market.peTrailing > 0) {
    if (market.peTrailing > 60) {
      signals.push({
        tone: "watch",
        text: `P/E of ${market.peTrailing.toFixed(0)} — priced for high growth; little margin of safety.`,
      });
    } else if (market.peTrailing > 0 && market.peTrailing < 12) {
      signals.push({
        tone: "up",
        text: `P/E of ${market.peTrailing.toFixed(1)} — trading at a value multiple.`,
      });
    }
  } else if (market && market.peTrailing == null && fundamentals?.netIncome != null && fundamentals.netIncome < 0) {
    signals.push({
      tone: "watch",
      text: `Currently unprofitable on a trailing basis — no P/E multiple available.`,
    });
  }

  // --- Analyst consensus gap ---
  if (
    market?.analystTargetMean != null &&
    market?.close != null &&
    market.close > 0 &&
    market.analystCount != null &&
    market.analystCount >= 3
  ) {
    const gap = ((market.analystTargetMean - market.close) / market.close) * 100;
    if (gap >= 15) {
      signals.push({
        tone: "up",
        text: `Analyst mean target $${market.analystTargetMean.toFixed(2)} — ${gap.toFixed(0)}% above current (${market.analystCount} analysts).`,
      });
    } else if (gap <= -10) {
      signals.push({
        tone: "down",
        text: `Analyst mean target $${market.analystTargetMean.toFixed(2)} — ${Math.abs(gap).toFixed(0)}% below current (${market.analystCount} analysts).`,
      });
    }
  }

  // --- Fundamentals snapshot ---
  if (fundamentals) {
    if (fundamentals.freeCashFlow != null && fundamentals.freeCashFlow < 0) {
      signals.push({
        tone: "watch",
        text: `Negative free cash flow last ${fundamentals.periodType} (${formatBig(fundamentals.freeCashFlow)}).`,
      });
    }
    if (
      fundamentals.debtToEquity != null &&
      fundamentals.debtToEquity > 2
    ) {
      signals.push({
        tone: "watch",
        text: `Debt-to-equity of ${fundamentals.debtToEquity.toFixed(1)} — balance-sheet-heavy.`,
      });
    }
    if (fundamentals.roe != null && fundamentals.roe > 0.2) {
      signals.push({
        tone: "up",
        text: `Return on equity ${(fundamentals.roe * 100).toFixed(0)}% — strong capital efficiency.`,
      });
    }
  }

  // --- Recent events ---
  const recentFilings = recentEvents.filter((e) =>
    e.eventType.startsWith("filing_")
  );
  const recentEarnings = recentEvents.filter((e) => e.eventType === "earnings");
  if (recentFilings.length > 0) {
    const last = recentFilings[0];
    signals.push({
      tone: "neutral",
      text: `${humanEventType(last.eventType)} filed ${last.eventDate}.`,
    });
  }
  if (recentEarnings.length > 0) {
    const last = recentEarnings[0];
    signals.push({
      tone: "neutral",
      text: `Reported earnings on ${last.eventDate}.`,
    });
  }

  // --- Upcoming events ---
  const upcomingEarnings = upcomingEvents.find(
    (e) => e.eventType === "earnings"
  );
  if (upcomingEarnings) {
    const daysOut = daysBetween(upcomingEarnings.eventDate);
    if (daysOut <= 7) {
      signals.push({
        tone: "watch",
        text: `Earnings in ${daysOut <= 0 ? "today" : daysOut + " day" + (daysOut === 1 ? "" : "s")} (${upcomingEarnings.eventDate}).`,
      });
    } else if (daysOut <= 30) {
      signals.push({
        tone: "neutral",
        text: `Earnings scheduled ${upcomingEarnings.eventDate}.`,
      });
    }
  }

  const upcomingExDiv = upcomingEvents.find(
    (e) => e.eventType === "dividend_ex"
  );
  if (upcomingExDiv) {
    const daysOut = daysBetween(upcomingExDiv.eventDate);
    if (daysOut >= 0 && daysOut <= 14) {
      signals.push({
        tone: "neutral",
        text: `Ex-dividend date ${upcomingExDiv.eventDate}.`,
      });
    }
  }

  // --- Sentiment ---
  if (sentiment && sentiment.newsCount > 0) {
    if (sentiment.bullishPct != null && sentiment.bullishPct >= 0.65) {
      signals.push({
        tone: "up",
        text: `${Math.round(sentiment.bullishPct * 100)}% bullish headlines across ${sentiment.newsCount} recent articles.`,
      });
    } else if (sentiment.bearishPct != null && sentiment.bearishPct >= 0.5) {
      signals.push({
        tone: "down",
        text: `${Math.round(sentiment.bearishPct * 100)}% bearish headlines across ${sentiment.newsCount} recent articles.`,
      });
    }
  }

  // --- Compose tone + headline + narrative ---
  const tone = resolveTone(signals);
  const headline = composeHeadline(ticker, signals, market);
  const narrative = composeNarrative(ticker, signals, market, fundamentals, upcomingEvents);

  return {
    ticker,
    capturedAt: new Date().toISOString().slice(0, 10),
    asOf: new Date().toISOString(),
    headline,
    tone,
    signals: signals.slice(0, 8),
    narrative,
    sourceSummary: {
      hasMarket: !!market,
      hasFundamentals: !!fundamentals,
      eventCount: upcomingEvents.length + recentEvents.length,
      sentimentCoverage: sentiment && sentiment.newsCount > 0 ? "finnhub" : "none",
    },
  };
}

function resolveTone(signals: DossierSignal[]): DossierTone {
  const concerns = signals.filter(
    (s) => s.tone === "down" || s.tone === "watch"
  ).length;
  const ups = signals.filter((s) => s.tone === "up").length;
  if (concerns >= 4) return "concern";
  if (concerns >= 2) return "inspect";
  if (ups >= 2 && concerns <= 1) return "steady";
  return "watch";
}

function composeHeadline(
  ticker: string,
  signals: DossierSignal[],
  market: TickerMarketRow | null
): string {
  // Prefer the two most-interesting signals when available.
  const primary = signals.find((s) => s.tone === "down" || s.tone === "up");
  const secondary = signals.find(
    (s) => s !== primary && (s.tone === "watch" || s.tone === "down")
  );

  if (primary && secondary) {
    return `${clip(primary.text)} · ${clip(secondary.text)}`;
  }
  if (primary) return clip(primary.text);

  if (market?.changePct != null) {
    return `${ticker} moved ${market.changePct > 0 ? "+" : ""}${market.changePct.toFixed(2)}% overnight.`;
  }
  return `${ticker} — holding pattern overnight.`;
}

function composeNarrative(
  ticker: string,
  signals: DossierSignal[],
  market: TickerMarketRow | null,
  fundamentals: TickerFundamentalsRow | null,
  upcomingEvents: TickerEventRow[]
): string {
  const paragraphs: string[] = [];

  if (market?.close != null) {
    const parts: string[] = [];
    parts.push(
      `${ticker} closed at $${market.close.toFixed(2)}${
        market.changePct != null
          ? ` (${market.changePct > 0 ? "+" : ""}${market.changePct.toFixed(2)}%)`
          : ""
      } as of ${market.capturedAt}.`
    );
    if (market.marketCap != null) {
      parts.push(`Market cap: ${formatBig(market.marketCap)}.`);
    }
    if (market.peTrailing != null) {
      parts.push(`P/E (trailing) ${market.peTrailing.toFixed(1)}.`);
    }
    if (
      market.ma50 != null &&
      market.ma200 != null &&
      market.close != null
    ) {
      const above50 = market.close > market.ma50;
      const above200 = market.close > market.ma200;
      parts.push(
        `Price is ${above50 ? "above" : "below"} the 50-day MA and ${above200 ? "above" : "below"} the 200-day MA.`
      );
    }
    paragraphs.push(parts.join(" "));
  }

  // Signals as a compact narrative
  const concerns = signals.filter(
    (s) => s.tone === "down" || s.tone === "watch"
  );
  const positives = signals.filter((s) => s.tone === "up");
  if (positives.length > 0 || concerns.length > 0) {
    const bits: string[] = [];
    if (positives.length > 0) {
      bits.push(
        `Positives: ${positives
          .slice(0, 2)
          .map((s) => lowerFirst(clip(s.text, 90)))
          .join("; ")}.`
      );
    }
    if (concerns.length > 0) {
      bits.push(
        `Concerns: ${concerns
          .slice(0, 2)
          .map((s) => lowerFirst(clip(s.text, 90)))
          .join("; ")}.`
      );
    }
    paragraphs.push(bits.join(" "));
  }

  // Fundamentals brief
  if (fundamentals) {
    const fp: string[] = [];
    if (fundamentals.revenue != null) {
      fp.push(`Revenue ${formatBig(fundamentals.revenue)}`);
    }
    if (fundamentals.netIncome != null) {
      fp.push(`net income ${formatBig(fundamentals.netIncome)}`);
    }
    if (fundamentals.operatingMargin != null) {
      fp.push(`operating margin ${(fundamentals.operatingMargin * 100).toFixed(1)}%`);
    }
    if (fundamentals.freeCashFlow != null) {
      fp.push(`free cash flow ${formatBig(fundamentals.freeCashFlow)}`);
    }
    if (fp.length > 0) {
      paragraphs.push(
        `${fundamentals.periodType === "quarterly" ? "Last quarter" : "Last full year"}: ${fp.join(", ")}.`
      );
    }
  }

  // Event outlook
  const nextEarn = upcomingEvents.find((e) => e.eventType === "earnings");
  if (nextEarn) {
    const days = daysBetween(nextEarn.eventDate);
    paragraphs.push(
      `Watching for: ${nextEarn.eventDate} earnings release (${days <= 0 ? "today" : days + " day" + (days === 1 ? "" : "s") + " out"}).`
    );
  }

  if (paragraphs.length === 0) {
    paragraphs.push(
      `The warehouse hasn't captured enough data on ${ticker} yet. The nightly cron populates this brief starting the night after the ticker is added to your holdings.`
    );
  }

  return paragraphs.join("\n\n");
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
    default:
      return t;
  }
}

function daysBetween(isoDate: string): number {
  const d = new Date(isoDate).getTime();
  const now = new Date().setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

function clip(s: string, max = 140): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s;
}

function formatBig(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * Persist a dossier to ticker_dossier with ON CONFLICT upsert. Same shape
 * upserts cleanly regardless of how many times the cron runs in a day.
 */
export async function writeDossier(d: TickerDossier): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO "ticker_dossier"
         (ticker, captured_at, headline, tone, signals, narrative, source_summary)
       VALUES ($1, CURRENT_DATE, $2, $3, $4::jsonb, $5, $6::jsonb)
       ON CONFLICT (ticker, captured_at) DO UPDATE SET
         headline = EXCLUDED.headline,
         tone = EXCLUDED.tone,
         signals = EXCLUDED.signals,
         narrative = EXCLUDED.narrative,
         source_summary = EXCLUDED.source_summary,
         as_of = NOW()`,
      [
        d.ticker,
        d.headline,
        d.tone,
        JSON.stringify(d.signals),
        d.narrative,
        JSON.stringify(d.sourceSummary),
      ]
    );
  } catch (err) {
    log.warn("warehouse.dossier", "write failed", {
      ticker: d.ticker,
      ...errorInfo(err),
    });
  }
}

/**
 * Read the most-recent dossier for a ticker. Used by the ticker drill panel.
 */
export async function getTickerDossier(
  ticker: string
): Promise<TickerDossier | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM "ticker_dossier"
       WHERE ticker = $1
       ORDER BY captured_at DESC
       LIMIT 1`,
      [ticker.toUpperCase()]
    );
    if (rows.length === 0) return null;
    return mapRow(rows[0] as Record<string, unknown>);
  } catch (err) {
    log.warn("warehouse.dossier", "read failed", {
      ticker,
      ...errorInfo(err),
    });
    return null;
  }
}

function mapRow(r: Record<string, unknown>): TickerDossier {
  const iso = (v: unknown): string =>
    v instanceof Date ? v.toISOString() : String(v);
  const dateOnly = (v: unknown): string =>
    v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
  return {
    ticker: String(r.ticker),
    capturedAt: dateOnly(r.captured_at),
    asOf: iso(r.as_of),
    headline: String(r.headline),
    tone: (r.tone as DossierTone) ?? "watch",
    signals: Array.isArray(r.signals)
      ? (r.signals as DossierSignal[])
      : [],
    narrative: String(r.narrative ?? ""),
    sourceSummary:
      r.source_summary && typeof r.source_summary === "object"
        ? (r.source_summary as TickerDossier["sourceSummary"])
        : {
            hasMarket: false,
            hasFundamentals: false,
            eventCount: 0,
            sentimentCoverage: "none",
          },
  };
}
