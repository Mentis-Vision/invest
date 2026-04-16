/**
 * FRED (Federal Reserve Economic Data) — requires free API key.
 * Register: https://fred.stlouisfed.org/docs/api/api_key.html
 */

const FRED_KEY = process.env.FRED_API_KEY;

/**
 * Series display semantics:
 *   - "percent": value is a rate (e.g. 4.42% Fed funds). Delta shown as pp.
 *   - "index": value is a raw index (e.g. VIX 14.2). Delta shown as %.
 *   - "index_yoy": value is a raw index but we render it as YoY % change,
 *     because the raw level is not reader-friendly (e.g. CPI 317.8 → +2.8% YoY).
 */
type Series = {
  id: string;
  label: string;
  format: "percent" | "index" | "index_yoy";
};

const MACRO_SERIES: Series[] = [
  { id: "DGS10", label: "10-Year Treasury Yield", format: "percent" },
  { id: "DGS2", label: "2-Year Treasury Yield", format: "percent" },
  { id: "DFF", label: "Fed Funds Rate", format: "percent" },
  { id: "CPIAUCSL", label: "CPI YoY Inflation", format: "index_yoy" },
  { id: "UNRATE", label: "Unemployment Rate", format: "percent" },
  { id: "VIXCLS", label: "VIX Volatility Index", format: "index" },
];

type Obs = { value: string; date: string };

async function fetchObservations(
  seriesId: string,
  limit = 1,
  frequency?: "m" | "d" | "w"
): Promise<Obs[]> {
  if (!FRED_KEY) return [];
  try {
    const url = new URL("https://api.stlouisfed.org/fred/series/observations");
    url.searchParams.set("series_id", seriesId);
    url.searchParams.set("api_key", FRED_KEY);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("sort_order", "desc");
    url.searchParams.set("limit", String(limit));
    if (frequency) url.searchParams.set("frequency", frequency);

    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    const obs: Obs[] = (data?.observations ?? []).filter(
      (o: Obs) => o && o.value !== "."
    );
    return obs;
  } catch {
    return [];
  }
}

async function getLatestValue(seriesId: string): Promise<Obs | null> {
  const obs = await fetchObservations(seriesId, 1);
  return obs[0] ?? null;
}

export type MacroIndicator = {
  indicator: string;
  value: string;
  date: string;
  /** 12-month historical trend; optional. Oldest first. */
  trend12mo?: Array<{ date: string; value: string }>;
  /** Change from start of trend to latest. */
  deltaLabel?: string;
  /**
   * For index_yoy series, the raw underlying index value at `date`.
   * Kept for traceability — the headline `value` is the YoY percent.
   */
  rawValue?: string;
};

export type MacroSnapshot = MacroIndicator[];

/**
 * Compute the headline value + delta label + compact trend for a series,
 * based on its display format. Returns undefined fields when there isn't
 * enough history to compute them.
 */
function buildIndicator(
  series: Series,
  latest: Obs,
  hist: Obs[] // desc, monthly — index 0 is latest
): MacroIndicator {
  const indicator = series.label;
  const date = latest.date;

  if (series.format === "index_yoy") {
    // YoY inflation: latest value divided by value ~12 months ago.
    // Need at least 13 monthly obs (idx 0 = latest, idx 12 = one year prior).
    const latestNum = Number(latest.value);
    const yearAgo = hist[12] ? Number(hist[12].value) : NaN;
    if (Number.isFinite(latestNum) && Number.isFinite(yearAgo) && yearAgo !== 0) {
      const yoy = (latestNum / yearAgo - 1) * 100;

      // Build a rolling YoY trend — for each of the last 13 months, compute
      // value at i divided by value at i+12. This lets the model see whether
      // inflation is accelerating or decelerating.
      const trend12mo: MacroIndicator["trend12mo"] = [];
      for (let i = 12; i >= 0 && i + 12 < hist.length; i--) {
        const now = Number(hist[i]?.value);
        const then = Number(hist[i + 12]?.value);
        if (Number.isFinite(now) && Number.isFinite(then) && then !== 0) {
          trend12mo.push({
            date: hist[i].date,
            value: ((now / then - 1) * 100).toFixed(2),
          });
        }
      }

      let deltaLabel: string | undefined;
      if (trend12mo.length > 1) {
        const startYoY = Number(trend12mo[0].value);
        const endYoY = Number(trend12mo[trend12mo.length - 1].value);
        if (Number.isFinite(startYoY) && Number.isFinite(endYoY)) {
          const diff = endYoY - startYoY;
          deltaLabel = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}pp vs 12mo ago`;
        }
      }

      return {
        indicator,
        value: `${yoy.toFixed(2)}%`,
        date,
        trend12mo: trend12mo.length > 0 ? trend12mo : undefined,
        deltaLabel,
        rawValue: latest.value,
      };
    }
    // Fall back to raw value if we don't have 13 months of data
    return {
      indicator: `${indicator} (raw)`,
      value: latest.value,
      date,
      rawValue: latest.value,
    };
  }

  // percent and index formats: previous behavior
  let trend12mo: MacroIndicator["trend12mo"];
  let deltaLabel: string | undefined;

  if (hist.length > 1) {
    const last13 = hist.slice(0, 13).reverse();
    trend12mo = last13.map((o) => ({ date: o.date, value: o.value }));
    const startNum = Number(last13[0]?.value);
    const endNum = Number(latest.value);
    if (
      Number.isFinite(startNum) &&
      Number.isFinite(endNum) &&
      startNum !== 0
    ) {
      const diff = endNum - startNum;
      if (series.format === "percent") {
        deltaLabel = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}pp`;
      } else {
        const pct = (diff / startNum) * 100;
        deltaLabel = `${diff >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
      }
    }
  }

  return {
    indicator,
    value: latest.value,
    date,
    trend12mo,
    deltaLabel,
  };
}

/**
 * Fetches latest value + a compact 12-month monthly trend for each series.
 * Falls back to latest-only if the trend request fails.
 */
export async function getMacroSnapshot(): Promise<MacroSnapshot> {
  const results: Array<MacroIndicator | null> = await Promise.all(
    MACRO_SERIES.map(async (s): Promise<MacroIndicator | null> => {
      const latest = await getLatestValue(s.id);
      if (!latest) return null;

      // We need more history for YoY (25 months) than for percent/index (13).
      const needed = s.format === "index_yoy" ? 400 : 400;
      const hist = await fetchObservations(s.id, needed, "m").catch(() => []);
      return buildIndicator(s, latest, hist);
    })
  );
  return results.filter((r): r is MacroIndicator => r !== null);
}

/**
 * Fetches N-months of history for a specific series (used by tool-calling and
 * programmatic callers; not part of the main snapshot).
 */
export async function getSeriesHistory(
  seriesId: string,
  months = 12
): Promise<Obs[]> {
  const obs = await fetchObservations(seriesId, months * 2, "m");
  return obs.slice(0, months).reverse();
}

export function formatMacroForAI(snapshot: MacroSnapshot): string {
  if (snapshot.length === 0) {
    return "MACRO CONTEXT: FRED data unavailable (no API key configured).";
  }
  const lines = [
    "MACRO CONTEXT (via FRED, Federal Reserve):",
    ...snapshot.map((s) => {
      const trendBit = s.deltaLabel ? ` (${s.deltaLabel})` : "";
      const rawBit = s.rawValue && s.rawValue !== s.value ? ` [raw index ${s.rawValue}]` : "";
      const trendPoints = s.trend12mo
        ? `  Trend: ${s.trend12mo
            .filter(
              (_, i, arr) =>
                i === 0 || i === Math.floor(arr.length / 2) || i === arr.length - 1
            )
            .map((p) => `${p.date}=${p.value}`)
            .join(" → ")}`
        : "";
      return `- ${s.indicator}: ${s.value} (as of ${s.date})${trendBit}${rawBit}${
        trendPoints ? `\n${trendPoints}` : ""
      }`;
    }),
  ];
  return lines.join("\n");
}
