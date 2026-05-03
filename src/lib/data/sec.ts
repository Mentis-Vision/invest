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

// ─── COMPANY FACTS (XBRL) ───────────────────────────────────────────────

/**
 * SEC Company Facts API. Returns every XBRL fact a company has reported
 * across all filings — revenue series, net income, assets, equity, cash
 * flows, shares outstanding, etc. Source of truth that sits UPSTREAM of
 * what Yahoo/AV scrape. Authoritative.
 *
 * Returns a slimmed-down subset of the most useful series so the research
 * data block stays readable. Full XBRL has hundreds of tags; we only
 * surface the ones an equity investor actually reads.
 *
 * Endpoint: https://data.sec.gov/api/xbrl/companyfacts/CIK{10digit}.json
 * Rate: SEC asks ≤ 10 req/sec per IP, which we're nowhere near.
 */
export type CompanyFactSeries = {
  label: string;
  unit: string;
  points: Array<{
    period: string; // ISO date (end of period)
    fiscalYear: number;
    fiscalPeriod: string; // Q1/Q2/Q3/FY
    value: number;
    form: string; // 10-K, 10-Q, etc.
    filed: string; // ISO date filed
  }>;
};

export type CompanyFacts = {
  cik: string;
  entityName: string | null;
  series: Record<string, CompanyFactSeries>;
};

/** Tags we actually care about, mapped to display labels. */
const FACT_TAGS: Record<string, string> = {
  Revenues: "Revenue",
  RevenueFromContractWithCustomerExcludingAssessedTax: "Revenue (ex-tax)",
  GrossProfit: "Gross profit",
  OperatingIncomeLoss: "Operating income",
  NetIncomeLoss: "Net income",
  EarningsPerShareDiluted: "EPS (diluted)",
  EarningsPerShareBasic: "EPS (basic)",
  Assets: "Total assets",
  Liabilities: "Total liabilities",
  StockholdersEquity: "Stockholders' equity",
  CashAndCashEquivalentsAtCarryingValue: "Cash & equivalents",
  LongTermDebt: "Long-term debt",
  CommonStockSharesOutstanding: "Shares outstanding",
  NetCashProvidedByUsedInOperatingActivities: "Operating cash flow",
  ResearchAndDevelopmentExpense: "R&D expense",
  // Phase 4 Batch I: XBRL fields needed by Piotroski / Altman /
  // Beneish / Sloan quality scores. Yahoo leaves these empty for many
  // companies; SEC has them.
  RetainedEarningsAccumulatedDeficit: "Retained earnings",
  AssetsCurrent: "Current assets",
  LiabilitiesCurrent: "Current liabilities",
  AccountsReceivableNetCurrent: "Accounts receivable",
  DepreciationDepletionAndAmortization: "Depreciation",
  Depreciation: "Depreciation (alt)",
  SellingGeneralAndAdministrativeExpense: "SG&A",
  IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest:
    "Pre-tax income",
  PropertyPlantAndEquipmentNet: "Property, plant & equipment",
};

export async function getCompanyFacts(
  ticker: string
): Promise<CompanyFacts | null> {
  const cik = await getCIK(ticker);
  if (!cik) return null;
  try {
    const res = await fetch(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
      {
        headers: { "User-Agent": UA },
        next: { revalidate: 21600 }, // 6h — XBRL facts only change on new filings
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      cik?: number;
      entityName?: string;
      facts?: {
        "us-gaap"?: Record<
          string,
          {
            label?: string;
            units?: Record<
              string,
              Array<{
                end?: string;
                val?: number;
                fy?: number;
                fp?: string;
                form?: string;
                filed?: string;
              }>
            >;
          }
        >;
      };
    };
    const usGaap = data?.facts?.["us-gaap"];
    if (!usGaap) return null;

    const series: Record<string, CompanyFactSeries> = {};
    for (const [tag, displayLabel] of Object.entries(FACT_TAGS)) {
      const entry = usGaap[tag];
      if (!entry?.units) continue;
      // Prefer USD; fall back to whatever's first.
      const unit = entry.units["USD"]
        ? "USD"
        : entry.units["USD/shares"]
          ? "USD/shares"
          : entry.units["shares"]
            ? "shares"
            : Object.keys(entry.units)[0];
      if (!unit) continue;
      const rawPoints = entry.units[unit] ?? [];
      // Dedup by (end, fp, form) — XBRL sometimes reports the same period
      // multiple times as filings are amended. Keep the most recently filed.
      const keyed = new Map<string, (typeof rawPoints)[number]>();
      for (const p of rawPoints) {
        if (!p.end || typeof p.val !== "number") continue;
        const k = `${p.end}::${p.fp ?? ""}::${p.form ?? ""}`;
        const existing = keyed.get(k);
        if (!existing || (p.filed && existing.filed && p.filed > existing.filed)) {
          keyed.set(k, p);
        }
      }
      const points = [...keyed.values()]
        .map((p) => ({
          period: p.end!,
          fiscalYear: p.fy ?? 0,
          fiscalPeriod: p.fp ?? "",
          value: p.val!,
          form: p.form ?? "",
          filed: p.filed ?? "",
        }))
        .sort((a, b) => (a.period < b.period ? 1 : -1));
      if (points.length > 0) {
        series[tag] = {
          label: entry.label ?? displayLabel,
          unit,
          points,
        };
      }
    }

    return {
      cik,
      entityName: data.entityName ?? null,
      series,
    };
  } catch {
    return null;
  }
}

// ─── RECENT FILINGS FEED (cross-company) ───────────────────────────────

export type EdgarFeedItem = {
  accession: string;
  filedOn: string; // ISO
  form: string;
  ciks: string[];
  companyNames: string[];
  title: string;
  url: string;
};

/**
 * EDGAR's "getcurrent" Atom feed: every filing that hits EDGAR, across
 * all companies, in near-real time. Useful as a signal alongside news —
 * when a company files an 8-K it often precedes the news writeup by hours.
 *
 * No CIK filter here (getcurrent is a global feed); downstream code
 * filters by ticker-mention if we want per-user relevance.
 */
export async function getRecentFilingsFeed(
  limit = 40,
  formFilter?: Array<
    "8-K" | "10-K" | "10-Q" | "SC 13D" | "SC 13G" | "S-1" | "S-3"
  >
): Promise<EdgarFeedItem[]> {
  const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
  url.searchParams.set("action", "getcurrent");
  url.searchParams.set("output", "atom");
  url.searchParams.set("count", String(Math.min(Math.max(limit, 10), 100)));
  if (formFilter && formFilter.length > 0) {
    url.searchParams.set("type", formFilter.join(","));
  }
  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": UA,
        Accept: "application/atom+xml, application/xml, */*",
      },
      next: { revalidate: 600 }, // 10 min
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseEdgarAtom(xml).slice(0, limit);
  } catch {
    return [];
  }
}

/** Minimal Atom 1.0 parser specific to EDGAR's getcurrent output. */
function parseEdgarAtom(xml: string): EdgarFeedItem[] {
  const entryRe = /<entry[\s\S]*?<\/entry>/g;
  const matches = xml.match(entryRe) ?? [];
  const items: EdgarFeedItem[] = [];
  for (const block of matches) {
    const title = extractXml(block, "title");
    const link =
      /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(block)?.[1] ??
      /<link[^>]*href="([^"]+)"/.exec(block)?.[1] ??
      "";
    const updated = extractXml(block, "updated");
    // Title shape: "FORM - COMPANY NAME (CIK) (Category)"
    const formMatch = /^(\S+)\s*-\s*(.+?)\s*\((\d+)\)/.exec(title);
    const form = formMatch?.[1] ?? "";
    const companyName = formMatch?.[2] ?? "";
    const cik = formMatch?.[3] ?? "";
    const accMatch = /\/data\/\d+\/(\d+)\//.exec(link);
    const accessionNoDashes = accMatch?.[1] ?? "";
    const accession =
      accessionNoDashes.length === 18
        ? `${accessionNoDashes.slice(0, 10)}-${accessionNoDashes.slice(10, 12)}-${accessionNoDashes.slice(12)}`
        : accessionNoDashes;
    items.push({
      accession,
      filedOn: updated,
      form,
      ciks: cik ? [cik] : [],
      companyNames: companyName ? [companyName] : [],
      title: title.replace(/<[^>]+>/g, "").trim(),
      url: link,
    });
  }
  return items;
}

function extractXml(block: string, tag: string): string {
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,
    "i"
  );
  return block.match(re)?.[1]?.trim() ?? "";
}
