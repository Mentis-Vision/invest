import { tool } from "ai";
import { z } from "zod";
import {
  getFinancialsSummary,
  getAnalystConsensus,
  getRecentNews,
} from "../data/yahoo-extras";
import { getFilingText } from "../data/sec-extras";
import { getSeriesHistory } from "../data/fred";
import { getRecentFilings } from "../data/sec";
import { getInsiderAggregates } from "../data/insider";
import {
  getTickerNews,
  getTickerSentiment,
  finnhubConfigured,
} from "../data/finnhub";
import { log, errorInfo } from "../log";

/**
 * Tool set exposed to analyst models during research.
 *
 * Each tool is structured:
 *   - Conservative in scope (fetch verified data only, never opinions)
 *   - Returns a compact, typed payload that fits in the model's context
 *   - Fails gracefully: errors become a `{ error: string }` response so the
 *     model can reason about "data unavailable" rather than crashing the step
 *
 * The analyst system prompt MUST instruct the model to:
 *   1. Prefer the pre-formatted DATA block for core numbers
 *   2. Call tools for deeper verification, NEVER for speculation
 *   3. Cite every numeric claim with the tool name and field it came from
 *
 * Latency budget: ~2–3 tool calls per analyst per run is fine. More than that
 * blows the 120s maxDuration on /api/research.
 */

function safe<T>(
  scope: string,
  fn: () => Promise<T>
): Promise<T | { error: string }> {
  return fn().catch((err) => {
    log.warn(`tools.${scope}`, "call failed", errorInfo(err));
    return {
      error: err instanceof Error ? err.message : "tool execution failed",
    };
  });
}

/**
 * Truncate long text outputs to protect the model's context window.
 * Tool results that exceed the budget are trimmed with a marker.
 */
function trim<T extends { excerpt?: string }>(result: T, maxChars = 6000): T {
  if (!result || typeof result !== "object") return result;
  if ("excerpt" in result && typeof result.excerpt === "string") {
    if (result.excerpt.length > maxChars) {
      return {
        ...result,
        excerpt: result.excerpt.slice(0, maxChars) + "… [truncated]",
      };
    }
  }
  return result;
}

export const analystTools = {
  listRecentFilings: tool({
    description:
      "List recent SEC filings (10-K, 10-Q, 8-K, DEF 14A) for a ticker. Use this to discover accession numbers before calling getFilingText.",
    inputSchema: z.object({
      ticker: z.string().describe("Ticker symbol, uppercase (e.g. AAPL)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Max filings to return (default 10)"),
    }),
    execute: async ({ ticker, limit }) =>
      safe("listRecentFilings", () =>
        getRecentFilings(ticker.toUpperCase(), limit ?? 10).then((filings) => ({
          ticker: ticker.toUpperCase(),
          filings,
          source: "sec-edgar" as const,
        }))
      ),
  }),

  getFilingText: tool({
    description:
      "Fetch the sanitized text of a specific SEC filing. Use sparingly: one filing per analysis is usually enough. Pass the accession number returned by listRecentFilings and the ticker for faster lookup.",
    inputSchema: z.object({
      ticker: z.string().describe("Ticker symbol, uppercase"),
      accessionNumber: z
        .string()
        .describe("Accession number from listRecentFilings, e.g. 0000320193-25-000123"),
      maxChars: z
        .number()
        .int()
        .min(1000)
        .max(16000)
        .optional()
        .describe("Max chars to return (default 8000). Higher values use more context."),
    }),
    execute: async ({ ticker, accessionNumber, maxChars }) =>
      safe("getFilingText", async () =>
        trim(
          await getFilingText(
            accessionNumber,
            maxChars ?? 8000,
            ticker.toUpperCase()
          ),
          maxChars ?? 8000
        )
      ),
  }),

  getFinancialsSummary: tool({
    description:
      "Fetch detailed financials (income statement, balance sheet, cash flow highlights, key ratios) for a ticker. Use when the DATA block's valuation fields are insufficient to form a view.",
    inputSchema: z.object({
      ticker: z.string().describe("Ticker symbol, uppercase"),
    }),
    execute: async ({ ticker }) =>
      safe("getFinancialsSummary", () =>
        getFinancialsSummary(ticker.toUpperCase())
      ),
  }),

  getAnalystConsensus: tool({
    description:
      "Fetch Wall Street analyst consensus detail: target mean/median/high/low, recent upgrades/downgrades, number of covering analysts.",
    inputSchema: z.object({
      ticker: z.string().describe("Ticker symbol, uppercase"),
    }),
    execute: async ({ ticker }) =>
      safe("getAnalystConsensus", () =>
        getAnalystConsensus(ticker.toUpperCase())
      ),
  }),

  getFredSeriesHistory: tool({
    description:
      "Fetch historical monthly values for a Federal Reserve Economic Data (FRED) series. Useful when you need a trend, not just a point-in-time value. Common series: DGS10, DGS2, DFF, CPIAUCSL, UNRATE, VIXCLS.",
    inputSchema: z.object({
      seriesId: z
        .string()
        .describe("FRED series id (e.g. DGS10, CPIAUCSL)"),
      months: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .describe("Months of history to return (default 12, max 60)"),
    }),
    execute: async ({ seriesId, months }) =>
      safe("getFredSeriesHistory", async () => ({
        seriesId,
        months: months ?? 12,
        observations: await getSeriesHistory(seriesId, months ?? 12),
        source: "fred" as const,
      })),
  }),

  getRecentNews: tool({
    description:
      "Fetch recent news headlines for a ticker. Prefers Finnhub (when configured) for structured company news with a date window; falls back to Yahoo Finance headlines. Use to check for material events (earnings surprise, guidance, litigation, M&A) the static data block wouldn't capture. News is qualitative context; do NOT cite sentiment as a numeric signal.",
    inputSchema: z.object({
      ticker: z.string().describe("Ticker symbol, uppercase"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(15)
        .optional()
        .describe("Max headlines to return (default 6)"),
      windowDays: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .describe("Look-back window in days for Finnhub path (default 14)"),
    }),
    execute: async ({ ticker, limit, windowDays }) =>
      safe("getRecentNews", async () => {
        const tickerUpper = ticker.toUpperCase();
        if (finnhubConfigured()) {
          const fh = await getTickerNews(
            tickerUpper,
            windowDays ?? 14,
            limit ?? 6
          );
          return {
            source: "finnhub" as const,
            ticker: tickerUpper,
            windowDays: fh.windowDays,
            items: fh.items.map((n) => ({
              datetime: n.datetime,
              headline: n.headline,
              publisher: n.source,
              summary: n.summary?.slice(0, 300) ?? null,
            })),
          };
        }
        // Fallback to Yahoo
        const y = await getRecentNews(tickerUpper, limit ?? 6);
        return {
          source: "yahoo" as const,
          ticker: tickerUpper,
          windowDays: null,
          items: y.items.map((n) => ({
            datetime: n.publishedAt,
            headline: n.title,
            publisher: n.publisher,
            summary: n.summary?.slice(0, 300) ?? null,
          })),
        };
      }),
  }),

  getNewsSentiment: tool({
    description:
      "Fetch aggregate news sentiment for a ticker (Finnhub only; returns notConfigured when Finnhub isn't set). Returns bull/bear percentages, a company news score (-1..+1), sector-average score, and a news 'buzz' ratio (this-week articles / weekly baseline). Use to detect narrative shifts and crowded positioning; do NOT treat as a primary numeric signal — it's qualitative context only.",
    inputSchema: z.object({
      ticker: z.string().describe("Ticker symbol, uppercase"),
    }),
    execute: async ({ ticker }) =>
      safe("getNewsSentiment", () =>
        getTickerSentiment(ticker.toUpperCase())
      ),
  }),

  getInsiderActivity: tool({
    description:
      "Fetch insider transaction activity (SEC Form 4) for a ticker. Returns counts of open-market buys vs sells, net shares and approximate dollar value, plus the 5 most recent transactions. Insider BUYS are a high-conviction bullish signal (insiders have no obligation to buy); insider SELLS are a noisier signal (could be diversification, tax, or planned schedules). Officer-level buys weigh more than 10% owners.",
    inputSchema: z.object({
      ticker: z.string().describe("Ticker symbol, uppercase"),
      windowDays: z
        .number()
        .int()
        .min(7)
        .max(365)
        .optional()
        .describe("Look-back window in days (default 90, max 365)"),
    }),
    execute: async ({ ticker, windowDays }) =>
      safe("getInsiderActivity", () =>
        getInsiderAggregates(ticker.toUpperCase(), windowDays ?? 90)
      ),
  }),
} as const;

export type AnalystToolName = keyof typeof analystTools;
