import { default as YahooFinanceCtor } from "yahoo-finance2";
import { pool } from "../../db";
import { log, errorInfo } from "../../log";
import { getRecentFilings } from "../../data/sec";

const yahoo = new YahooFinanceCtor({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type EventsRefreshResult = {
  attempted: number;
  inserted: number;
  failed: Array<{ ticker: string; error: string }>;
};

export async function refreshEvents(
  tickers: string[]
): Promise<EventsRefreshResult> {
  const attempted = tickers.length;
  let inserted = 0;
  const failed: EventsRefreshResult["failed"] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < tickers.length) {
      const idx = cursor++;
      const ticker = tickers[idx].toUpperCase();
      try {
        inserted += await refreshTicker(ticker);
      } catch (err) {
        failed.push({
          ticker,
          error: err instanceof Error ? err.message : "unknown",
        });
        log.warn("warehouse.refresh.events", "ticker failed", {
          ticker,
          ...errorInfo(err),
        });
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(3, tickers.length) },
    () => worker()
  );
  await Promise.all(workers);
  return { attempted, inserted, failed };
}

async function refreshTicker(ticker: string): Promise<number> {
  let inserted = 0;

  // Earnings calendar — Yahoo quoteSummary.calendarEvents
  try {
    const s = (await yahoo.quoteSummary(ticker, {
      modules: ["calendarEvents"],
    })) as unknown as {
      calendarEvents?: {
        earnings?: {
          earningsDate?: Date[];
          earningsAverage?: number;
          earningsHigh?: number;
          earningsLow?: number;
          revenueAverage?: number;
        };
        dividendDate?: Date | null;
        exDividendDate?: Date | null;
      };
    };
    const ce = s.calendarEvents;
    if (ce?.earnings?.earningsDate?.length) {
      const first = ce.earnings.earningsDate[0];
      if (first instanceof Date) {
        const eventDate = first.toISOString().slice(0, 10);
        inserted += await upsertEvent({
          ticker,
          eventType: "earnings",
          eventDate,
          eventTime: first.toISOString(),
          details: {
            dedupKey: `earnings:${eventDate}`,
            epsEstimate: ce.earnings.earningsAverage ?? null,
            revenueEstimate: ce.earnings.revenueAverage ?? null,
            epsHigh: ce.earnings.earningsHigh ?? null,
            epsLow: ce.earnings.earningsLow ?? null,
          },
          source: "yahoo",
        });
      }
    }
    if (ce?.exDividendDate instanceof Date) {
      const d = ce.exDividendDate.toISOString().slice(0, 10);
      inserted += await upsertEvent({
        ticker,
        eventType: "dividend_ex",
        eventDate: d,
        eventTime: null,
        details: {
          dedupKey: `dividend_ex:${d}`,
          payableDate:
            ce.dividendDate instanceof Date
              ? ce.dividendDate.toISOString().slice(0, 10)
              : null,
        },
        source: "yahoo",
      });
    }
  } catch (err) {
    log.warn("warehouse.events", "yahoo calendar failed", {
      ticker,
      ...errorInfo(err),
    });
  }

  // Recent SEC filings (8-K / 10-Q / 10-K)
  try {
    const filings = await getRecentFilings(ticker, 10);
    for (const f of filings) {
      const typeMap: Record<string, "filing_8k" | "filing_10q" | "filing_10k"> = {
        "8-K": "filing_8k",
        "10-Q": "filing_10q",
        "10-K": "filing_10k",
      };
      const eventType = typeMap[f.form];
      if (!eventType) continue;
      inserted += await upsertEvent({
        ticker,
        eventType,
        eventDate: f.filedOn.slice(0, 10),
        eventTime: null,
        details: {
          dedupKey: `filing:${f.accession}`,
          accession: f.accession,
          primaryDocument: f.primaryDocument,
          url: f.url,
        },
        source: "sec",
      });
    }
  } catch (err) {
    log.warn("warehouse.events", "sec filings failed", {
      ticker,
      ...errorInfo(err),
    });
  }

  return inserted;
}

async function upsertEvent(input: {
  ticker: string;
  eventType: string;
  eventDate: string;
  eventTime: string | null;
  details: Record<string, unknown>;
  source: string;
}): Promise<number> {
  try {
    // Partial unique index requires the conflict target to match the
    // index predicate. Since our dedup index is ON (ticker, event_type,
    // event_date, (details->>'dedupKey')) WHERE details->>'dedupKey' IS NOT NULL,
    // we need to include the predicate in our ON CONFLICT specifier.
    const res = await pool.query(
      `INSERT INTO "ticker_events"
         (id, ticker, event_type, event_date, event_time, details, source)
       VALUES ($1, $2, $3, $4::date, $5, $6::jsonb, $7)
       ON CONFLICT (ticker, event_type, event_date, (details->>'dedupKey'))
         WHERE details->>'dedupKey' IS NOT NULL
         DO NOTHING
       RETURNING id`,
      [
        genId(),
        input.ticker,
        input.eventType,
        input.eventDate,
        input.eventTime,
        JSON.stringify(input.details),
        input.source,
      ]
    );
    // Use rows.length rather than rowCount: Neon's serverless driver can
    // under-report rowCount on `ON CONFLICT DO NOTHING RETURNING id`. The
    // returned rows array is always accurate — one element per freshly
    // inserted row, zero when DO NOTHING fires.
    return res.rows?.length ?? 0;
  } catch (err) {
    log.warn("warehouse.events", "upsert failed", {
      ticker: input.ticker,
      eventType: input.eventType,
      ...errorInfo(err),
    });
    return 0;
  }
}
