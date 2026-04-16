/**
 * SEC EDGAR — free, no API key, but requires a User-Agent with contact info per SEC policy.
 * Docs: https://www.sec.gov/os/accessing-edgar-data
 */

const UA = "ClearPath Invest research@lippertohana.com";

type TickerEntry = { cik_str: number; ticker: string; title: string };

let tickerCache: Record<string, string> | null = null;

async function getCIK(ticker: string): Promise<string | null> {
  if (!tickerCache) {
    try {
      const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
        headers: { "User-Agent": UA },
        next: { revalidate: 86400 },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, TickerEntry>;
      tickerCache = {};
      for (const v of Object.values(data)) {
        tickerCache[v.ticker.toUpperCase()] = String(v.cik_str).padStart(10, "0");
      }
    } catch {
      return null;
    }
  }
  return tickerCache[ticker.toUpperCase()] ?? null;
}

export type RecentFiling = {
  form: string;
  filedOn: string;
  accession: string;
  primaryDocument: string;
  url: string;
};

export async function getRecentFilings(
  ticker: string,
  limit = 5
): Promise<RecentFiling[]> {
  const cik = await getCIK(ticker);
  if (!cik) return [];

  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { "User-Agent": UA },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const recent = data?.filings?.recent;
    if (!recent) return [];

    const filings: RecentFiling[] = [];
    const forms: string[] = recent.form;
    const dates: string[] = recent.filingDate;
    const accessions: string[] = recent.accessionNumber;
    const primaryDocs: string[] = recent.primaryDocument;

    // Prioritize 10-K, 10-Q, 8-K
    const relevant = new Set(["10-K", "10-Q", "8-K", "DEF 14A"]);
    for (let i = 0; i < forms.length && filings.length < limit; i++) {
      if (!relevant.has(forms[i])) continue;
      const accNoDash = accessions[i].replace(/-/g, "");
      filings.push({
        form: forms[i],
        filedOn: dates[i],
        accession: accessions[i],
        primaryDocument: primaryDocs[i],
        url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accNoDash}/${primaryDocs[i]}`,
      });
    }
    return filings;
  } catch {
    return [];
  }
}

export function formatFilingsForAI(filings: RecentFiling[]): string {
  if (filings.length === 0) return "SEC FILINGS: No recent filings found.";
  return [
    "SEC FILINGS (Recent, via EDGAR):",
    ...filings.map(
      (f) => `- ${f.form} filed ${f.filedOn} (accession ${f.accession})`
    ),
  ].join("\n");
}
