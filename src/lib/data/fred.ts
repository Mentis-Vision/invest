/**
 * FRED (Federal Reserve Economic Data) — requires free API key.
 * Register: https://fred.stlouisfed.org/docs/api/api_key.html
 */

const FRED_KEY = process.env.FRED_API_KEY;

type Series = { id: string; label: string; format: "percent" | "index" };

const MACRO_SERIES: Series[] = [
  { id: "DGS10", label: "10-Year Treasury Yield", format: "percent" },
  { id: "DGS2", label: "2-Year Treasury Yield", format: "percent" },
  { id: "DFF", label: "Fed Funds Rate", format: "percent" },
  { id: "CPIAUCSL", label: "CPI (All Urban Consumers)", format: "index" },
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
};

export type MacroSnapshot = MacroIndicator[];

/**
 * Fetches latest value + a compact 12-month monthly trend for each series.
 * Falls back to latest-only if the trend request fails.
 */
export async function getMacroSnapshot(): Promise<MacroSnapshot> {
  const results: Array<MacroIndicator | null> = await Promise.all(
    MACRO_SERIES.map(async (s): Promise<MacroIndicator | null> => {
      const latest = await getLatestValue(s.id);
      if (!latest) return null;

      // Grab last ~13 monthly observations (limit=13 ensures we get oldest too)
      // Daily series like DGS10/DFF/VIX will sample daily — we take every ~20th.
      const hist = await fetchObservations(s.id, 400, "m").catch(() => []);
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
          if (s.format === "percent") {
            deltaLabel = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}pp`;
          } else {
            const pct = (diff / startNum) * 100;
            deltaLabel = `${diff >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
          }
        }
      }

      return {
        indicator: s.label,
        value: latest.value,
        date: latest.date,
        trend12mo,
        deltaLabel,
      };
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
      const trendBit = s.deltaLabel ? ` (12mo: ${s.deltaLabel})` : "";
      const trendPoints = s.trend12mo
        ? `  Trend: ${s.trend12mo
            .filter((_, i, arr) => i === 0 || i === Math.floor(arr.length / 2) || i === arr.length - 1)
            .map((p) => `${p.date}=${p.value}`)
            .join(" → ")}`
        : "";
      return `- ${s.indicator}: ${s.value} (as of ${s.date})${trendBit}${
        trendPoints ? `\n${trendPoints}` : ""
      }`;
    }),
  ];
  return lines.join("\n");
}
