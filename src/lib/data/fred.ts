/**
 * FRED (Federal Reserve Economic Data) — requires free API key.
 * Register: https://fred.stlouisfed.org/docs/api/api_key.html
 */

const FRED_KEY = process.env.FRED_API_KEY;

type Series = { id: string; label: string };

const MACRO_SERIES: Series[] = [
  { id: "DGS10", label: "10-Year Treasury Yield" },
  { id: "DGS2", label: "2-Year Treasury Yield" },
  { id: "DFF", label: "Fed Funds Rate" },
  { id: "CPIAUCSL", label: "CPI (All Urban Consumers)" },
  { id: "UNRATE", label: "Unemployment Rate" },
  { id: "VIXCLS", label: "VIX Volatility Index" },
];

async function getLatestValue(seriesId: string): Promise<{ value: string; date: string } | null> {
  if (!FRED_KEY) return null;
  try {
    const url = new URL("https://api.stlouisfed.org/fred/series/observations");
    url.searchParams.set("series_id", seriesId);
    url.searchParams.set("api_key", FRED_KEY);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("sort_order", "desc");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    const latest = data?.observations?.[0];
    if (!latest || latest.value === ".") return null;
    return { value: latest.value, date: latest.date };
  } catch {
    return null;
  }
}

export type MacroSnapshot = {
  indicator: string;
  value: string;
  date: string;
}[];

export async function getMacroSnapshot(): Promise<MacroSnapshot> {
  const results = await Promise.all(
    MACRO_SERIES.map(async (s) => {
      const v = await getLatestValue(s.id);
      if (!v) return null;
      return { indicator: s.label, value: v.value, date: v.date };
    })
  );
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

export function formatMacroForAI(snapshot: MacroSnapshot): string {
  if (snapshot.length === 0) {
    return "MACRO CONTEXT: FRED data unavailable (no API key configured).";
  }
  return [
    "MACRO CONTEXT (via FRED, Federal Reserve):",
    ...snapshot.map((s) => `- ${s.indicator}: ${s.value} (as of ${s.date})`),
  ].join("\n");
}
