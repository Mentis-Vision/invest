import { log, errorInfo } from "../log";

/**
 * SEC EDGAR Form 4 (insider transactions) — free, no API key, requires
 * a User-Agent with contact info per SEC policy.
 *
 * Transaction codes reference (SEC Form 4 Table I):
 *   P  = open-market purchase
 *   S  = open-market sale
 *   A  = grant/award (usually compensation, not signal)
 *   M  = option exercise
 *   F  = tax withholding
 *   G  = gift
 *   I  = discretionary
 *   X  = in-the-money option exercise
 * We classify P as bullish, S as bearish; most others are neutral noise.
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

export type Form4FilingRef = {
  accession: string;
  filedOn: string;
  primaryDocument: string;
  url: string;
  cik: string;
};

export async function getRecentForm4Filings(
  ticker: string,
  limit = 20
): Promise<Form4FilingRef[]> {
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

    const forms: string[] = recent.form;
    const dates: string[] = recent.filingDate;
    const accessions: string[] = recent.accessionNumber;
    const primaryDocs: string[] = recent.primaryDocument;

    const filings: Form4FilingRef[] = [];
    for (let i = 0; i < forms.length && filings.length < limit; i++) {
      if (forms[i] !== "4" && forms[i] !== "4/A") continue;
      const accNoDash = accessions[i].replace(/-/g, "");
      filings.push({
        accession: accessions[i],
        filedOn: dates[i],
        primaryDocument: primaryDocs[i],
        url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accNoDash}/${primaryDocs[i]}`,
        cik,
      });
    }
    return filings;
  } catch (err) {
    log.warn("insider", "submissions fetch failed", {
      ticker,
      ...errorInfo(err),
    });
    return [];
  }
}

export type InsiderTransaction = {
  accession: string;
  filedOn: string;
  filerName: string | null;
  filerTitle: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  transactionDate: string | null;
  transactionCode: string | null;
  acquiredDisposed: "A" | "D" | null;
  shares: number | null;
  pricePerShare: number | null;
  approxDollarValue: number | null;
  sharesOwnedAfter: number | null;
};

function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m ? m[1] : null;
}

function parseNumber(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export async function fetchForm4Transactions(
  ref: Form4FilingRef
): Promise<InsiderTransaction[]> {
  try {
    const res = await fetch(ref.url, {
      headers: { "User-Agent": UA, Accept: "application/xml,text/xml,*/*" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const filerName = firstMatch(xml, /<rptOwnerName>([^<]+)<\/rptOwnerName>/);
    const isDirector = /<isDirector>\s*(1|true)\s*<\/isDirector>/i.test(xml);
    const isOfficer = /<isOfficer>\s*(1|true)\s*<\/isOfficer>/i.test(xml);
    const isTenPercentOwner =
      /<isTenPercentOwner>\s*(1|true)\s*<\/isTenPercentOwner>/i.test(xml);
    const filerTitle = firstMatch(xml, /<officerTitle>([^<]+)<\/officerTitle>/);

    const txMatches = [
      ...xml.matchAll(
        /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g
      ),
    ];

    const out: InsiderTransaction[] = [];
    for (const m of txMatches) {
      const block = m[1];
      const transactionDate = firstMatch(
        block,
        /<transactionDate>[\s\S]*?<value>([^<]+)<\/value>/
      );
      const transactionCode = firstMatch(
        block,
        /<transactionCode>([^<]+)<\/transactionCode>/
      );
      const acquiredDisposed = firstMatch(
        block,
        /<transactionAcquiredDisposedCode>[\s\S]*?<value>([^<]+)<\/value>/
      );
      const shares = parseNumber(
        firstMatch(block, /<transactionShares>[\s\S]*?<value>([^<]+)<\/value>/)
      );
      const pricePerShare = parseNumber(
        firstMatch(
          block,
          /<transactionPricePerShare>[\s\S]*?<value>([^<]+)<\/value>/
        )
      );
      const sharesOwnedAfter = parseNumber(
        firstMatch(
          block,
          /<sharesOwnedFollowingTransaction>[\s\S]*?<value>([^<]+)<\/value>/
        )
      );
      const approxDollarValue =
        shares != null && pricePerShare != null
          ? Math.round(shares * pricePerShare)
          : null;

      out.push({
        accession: ref.accession,
        filedOn: ref.filedOn,
        filerName,
        filerTitle,
        isDirector,
        isOfficer,
        isTenPercentOwner,
        transactionDate,
        transactionCode,
        acquiredDisposed:
          acquiredDisposed === "A" || acquiredDisposed === "D"
            ? acquiredDisposed
            : null,
        shares,
        pricePerShare,
        approxDollarValue,
        sharesOwnedAfter,
      });
    }
    return out;
  } catch (err) {
    log.warn("insider", "form4 fetch/parse failed", {
      accession: ref.accession,
      ...errorInfo(err),
    });
    return [];
  }
}

export type InsiderAggregates = {
  ticker: string;
  windowDays: number;
  filings: number;
  transactions: number;
  buys: number;
  sells: number;
  otherMaterial: number;
  netShares: number;
  netDollarValue: number;
  officerBuys: number;
  officerSells: number;
  lastActivityAt: string | null;
  recent: InsiderTransaction[];
  source: "sec-edgar-form4";
};

export async function getInsiderAggregates(
  ticker: string,
  windowDays = 90
): Promise<InsiderAggregates> {
  const filings = await getRecentForm4Filings(ticker.toUpperCase(), 20);
  const cutoff = new Date(Date.now() - windowDays * 86400000);
  const inWindow = filings.filter((f) => new Date(f.filedOn) >= cutoff);

  const transactions: InsiderTransaction[] = [];
  let cursor = 0;
  async function runOne() {
    while (cursor < inWindow.length) {
      const idx = cursor++;
      const f = inWindow[idx];
      const txs = await fetchForm4Transactions(f);
      transactions.push(...txs);
    }
  }
  const workers = Array.from(
    { length: Math.min(6, inWindow.length) },
    () => runOne()
  );
  await Promise.all(workers);

  let buys = 0;
  let sells = 0;
  let otherMaterial = 0;
  let officerBuys = 0;
  let officerSells = 0;
  let netShares = 0;
  let netDollarValue = 0;

  for (const t of transactions) {
    const isP = t.transactionCode === "P";
    const isS = t.transactionCode === "S";
    if (isP) {
      buys++;
      if (t.isOfficer) officerBuys++;
      if (t.shares) netShares += t.shares;
      if (t.approxDollarValue) netDollarValue += t.approxDollarValue;
    } else if (isS) {
      sells++;
      if (t.isOfficer) officerSells++;
      if (t.shares) netShares -= t.shares;
      if (t.approxDollarValue) netDollarValue -= t.approxDollarValue;
    } else if (t.acquiredDisposed === "A" || t.acquiredDisposed === "D") {
      otherMaterial++;
    }
  }

  const lastActivityAt = inWindow[0]?.filedOn ?? null;
  const recent = transactions
    .slice()
    .sort((a, b) => {
      const da = a.transactionDate ?? a.filedOn ?? "";
      const db = b.transactionDate ?? b.filedOn ?? "";
      return db.localeCompare(da);
    })
    .slice(0, 5);

  return {
    ticker: ticker.toUpperCase(),
    windowDays,
    filings: inWindow.length,
    transactions: transactions.length,
    buys,
    sells,
    otherMaterial,
    netShares,
    netDollarValue,
    officerBuys,
    officerSells,
    lastActivityAt,
    recent,
    source: "sec-edgar-form4",
  };
}
