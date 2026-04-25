/**
 * Curated seed universe for the warehouse + programmatic SEO pages.
 *
 * WHY THIS EXISTS
 * ----------------
 * The warehouse only refreshes tickers that either (a) some user holds
 * (via `holding.ticker`) or (b) appear in this seed list. Without a
 * seed list the site's public `/stocks/[ticker]` pages only work for
 * the ~46 tickers we hand-pick in the index page. Adding a curated
 * seed primes the warehouse with ~600 high-search-volume equities so
 * the programmatic pages render real data on day one.
 *
 * PRIVACY NOTE
 * ------------
 * This list is NOT user-attributed. It's a static constant. It does
 * not read `holding.ticker`, does not take a userId, and is safe to
 * import from anywhere. AGENTS.md rule #9 locks `holding.ticker` to
 * `getTickerUniverse()`; that rule is unaffected — the seed list is
 * a disjoint, public set.
 *
 * CONSTITUENTS DRIFT
 * ------------------
 * S&P 500 / Nasdaq 100 / Dow 30 membership changes a handful of
 * times per year. This list is a point-in-time snapshot (2026-04).
 * Review QUARTERLY and refresh — stale constituents won't break the
 * warehouse (they just refresh for a dead ticker and Yahoo returns
 * null), but we want fresh coverage for tickers that joined the
 * indexes recently. Constituent sources:
 *   - S&P 500: slickcharts.com/sp500 or en.wikipedia.org/wiki/List_of_S%26P_500_companies
 *   - Nasdaq 100: slickcharts.com/nasdaq100
 *   - Dow 30: slickcharts.com/dowjones
 *
 * INTENTIONAL EXCLUSIONS
 * ----------------------
 *   - Naked crypto symbols (BTC, ETH, SOL, LINK, etc.) — Yahoo
 *     resolves these to unrelated equity namesakes (see AGENTS.md
 *     warehouse note re: BTC/LINK/ATOM). Crypto is routed through
 *     Alpha Vantage via the `assetClass = 'crypto'` path, which
 *     requires user holdings to enter the universe. We do NOT add
 *     crypto to the seed — it would corrupt the warehouse.
 *   - Preferred shares, warrants, and thinly-traded OTC tickers —
 *     low search volume, flaky data coverage.
 *   - Penny stocks — noisy, high delisting risk.
 *   - Tickers with dots (BRK.B works, but BF.B / BRK.A sometimes
 *     need Yahoo-specific formatting). We include BRK.B because
 *     Yahoo resolves it cleanly.
 */

/**
 * Asset class is either "equity" or "etf". The seed list has no
 * crypto — see INTENTIONAL EXCLUSIONS above. Mirrors the shape used
 * by getClassifiedUniverse so the refresh layer can route correctly.
 */
export type SeedAssetClass = "equity" | "etf";

export type SeedTicker = {
  ticker: string;
  assetClass: SeedAssetClass;
};

/**
 * S&P 500 constituents (point-in-time, 2026-04).
 * Excludes dual-class duplicates we don't want both of — we pick the
 * more-liquid share class (e.g. GOOGL over GOOG, BRK.B over BRK.A).
 */
const SP_500: readonly string[] = [
  "A", "AAL", "AAPL", "ABBV", "ABNB", "ABT", "ACGL", "ACN", "ADBE", "ADI",
  "ADM", "ADP", "ADSK", "AEE", "AEP", "AES", "AFL", "AIG", "AIZ", "AJG",
  "AKAM", "ALB", "ALGN", "ALL", "ALLE", "AMAT", "AMCR", "AMD", "AME", "AMGN",
  "AMP", "AMT", "AMZN", "ANET", "ANSS", "AON", "AOS", "APA", "APD", "APH",
  "APTV", "ARE", "ATO", "AVB", "AVGO", "AVY", "AWK", "AXON", "AXP", "AZO",
  "BA", "BAC", "BALL", "BAX", "BBWI", "BBY", "BDX", "BEN", "BF.B", "BG",
  "BIIB", "BIO", "BK", "BKNG", "BKR", "BLDR", "BLK", "BMY", "BR", "BRK.B",
  "BRO", "BSX", "BWA", "BX", "BXP", "C", "CAG", "CAH", "CARR", "CAT",
  "CB", "CBOE", "CBRE", "CCI", "CCL", "CDNS", "CDW", "CE", "CEG", "CF",
  "CFG", "CHD", "CHRW", "CHTR", "CI", "CINF", "CL", "CLX", "CMCSA", "CME",
  "CMG", "CMI", "CMS", "CNC", "CNP", "COF", "COO", "COP", "COR", "COST",
  "CPAY", "CPB", "CPRT", "CPT", "CRL", "CRM", "CRWD", "CSCO", "CSGP", "CSX",
  "CTAS", "CTLT", "CTRA", "CTSH", "CTVA", "CVS", "CVX", "CZR", "D", "DAL",
  "DAY", "DD", "DE", "DECK", "DELL", "DFS", "DG", "DGX", "DHI", "DHR",
  "DIS", "DLR", "DLTR", "DOC", "DOV", "DOW", "DPZ", "DRI", "DTE", "DUK",
  "DVA", "DVN", "DXCM", "EA", "EBAY", "ECL", "ED", "EFX", "EG", "EIX",
  "EL", "ELV", "EMN", "EMR", "ENPH", "EOG", "EPAM", "EQIX", "EQR", "EQT",
  "ERIE", "ES", "ESS", "ETN", "ETR", "ETSY", "EVRG", "EW", "EXC", "EXPD",
  "EXPE", "EXR", "F", "FAST", "FCX", "FDS", "FDX", "FE", "FFIV", "FI",
  "FICO", "FIS", "FITB", "FMC", "FOXA", "FRT", "FSLR", "FTNT", "FTV", "GD",
  "GDDY", "GE", "GEHC", "GEN", "GEV", "GILD", "GIS", "GL", "GLW", "GM",
  "GNRC", "GOOGL", "GPC", "GPN", "GRMN", "GS", "GWW", "HAL", "HAS", "HBAN",
  "HCA", "HD", "HES", "HIG", "HII", "HLT", "HOLX", "HON", "HPE", "HPQ",
  "HRL", "HSIC", "HST", "HSY", "HUBB", "HUM", "HWM", "IBM", "ICE", "IDXX",
  "IEX", "IFF", "ILMN", "INCY", "INTC", "INTU", "INVH", "IP", "IPG", "IQV",
  "IR", "IRM", "ISRG", "IT", "ITW", "IVZ", "J", "JBHT", "JBL", "JCI",
  "JKHY", "JNJ", "JNPR", "JPM", "K", "KDP", "KEY", "KEYS", "KHC", "KIM",
  "KKR", "KLAC", "KMB", "KMI", "KMX", "KO", "KR", "KVUE", "L", "LDOS",
  "LEN", "LH", "LHX", "LIN", "LKQ", "LLY", "LMT", "LNT", "LOW", "LRCX",
  "LULU", "LUV", "LVS", "LW", "LYB", "LYV", "MA", "MAA", "MAR", "MAS",
  "MCD", "MCHP", "MCK", "MCO", "MDLZ", "MDT", "MET", "META", "MGM", "MHK",
  "MKC", "MKTX", "MLM", "MMC", "MMM", "MNST", "MO", "MOH", "MOS", "MPC",
  "MPWR", "MRK", "MRNA", "MRO", "MS", "MSCI", "MSFT", "MSI", "MTB", "MTCH",
  "MTD", "MU", "NCLH", "NDAQ", "NDSN", "NEE", "NEM", "NFLX", "NI", "NKE",
  "NOC", "NOW", "NRG", "NSC", "NTAP", "NTRS", "NUE", "NVDA", "NVR", "NWSA",
  "NXPI", "O", "ODFL", "OKE", "OMC", "ON", "ORCL", "ORLY", "OTIS", "OXY",
  "PANW", "PARA", "PAYC", "PAYX", "PCAR", "PCG", "PEG", "PEP", "PFE", "PFG",
  "PG", "PGR", "PH", "PHM", "PKG", "PLD", "PLTR", "PM", "PNC", "PNR",
  "PNW", "PODD", "POOL", "PPG", "PPL", "PRU", "PSA", "PSX", "PTC", "PWR",
  "PYPL", "QCOM", "QRVO", "RCL", "REG", "REGN", "RF", "RJF", "RL", "RMD",
  "ROK", "ROL", "ROP", "ROST", "RSG", "RTX", "RVTY", "SBAC", "SBUX", "SCHW",
  "SHW", "SJM", "SLB", "SMCI", "SNA", "SNPS", "SO", "SOLV", "SPG", "SPGI",
  "SRE", "STE", "STLD", "STT", "STX", "STZ", "SWK", "SWKS", "SYF", "SYK",
  "SYY", "T", "TAP", "TDG", "TDY", "TECH", "TEL", "TER", "TFC", "TFX",
  "TGT", "TJX", "TMO", "TMUS", "TPL", "TPR", "TRGP", "TRMB", "TROW", "TRV",
  "TSCO", "TSLA", "TSN", "TT", "TTWO", "TXN", "TXT", "TYL", "UAL", "UBER",
  "UDR", "UHS", "ULTA", "UNH", "UNP", "UPS", "URI", "USB", "V", "VICI",
  "VLO", "VLTO", "VMC", "VRSK", "VRSN", "VRTX", "VST", "VTR", "VTRS", "VZ",
  "WAB", "WAT", "WBA", "WBD", "WDC", "WEC", "WELL", "WFC", "WM", "WMB",
  "WMT", "WRB", "WRK", "WST", "WTW", "WY", "WYNN", "XEL", "XOM", "XYL",
  "YUM", "ZBH", "ZBRA", "ZTS",
];

/**
 * Nasdaq 100 constituents (point-in-time, 2026-04).
 * Most are already in S&P 500, so the final deduped set is smaller.
 */
const NASDAQ_100: readonly string[] = [
  "AAPL", "ABNB", "ADBE", "ADI", "ADP", "ADSK", "AEP", "AMAT", "AMD", "AMGN",
  "AMZN", "ANSS", "APP", "ARM", "ASML", "AVGO", "AZN", "BIIB", "BKNG", "BKR",
  "CCEP", "CDNS", "CDW", "CEG", "CHTR", "CMCSA", "COST", "CPRT", "CRWD", "CSCO",
  "CSGP", "CSX", "CTAS", "CTSH", "DASH", "DDOG", "DLTR", "DXCM", "EA", "EXC",
  "FANG", "FAST", "FI", "FTNT", "GEHC", "GFS", "GILD", "GOOGL", "HON", "IDXX",
  "ILMN", "INTC", "INTU", "ISRG", "KDP", "KHC", "KLAC", "LIN", "LRCX", "LULU",
  "MAR", "MCHP", "MDB", "MDLZ", "MELI", "META", "MNST", "MRNA", "MRVL", "MSFT",
  "MU", "NFLX", "NVDA", "NXPI", "ODFL", "ON", "ORLY", "PANW", "PAYX", "PCAR",
  "PDD", "PEP", "PLTR", "PYPL", "QCOM", "REGN", "ROP", "ROST", "SBUX", "SMCI",
  "SNPS", "TEAM", "TMUS", "TSLA", "TTD", "TTWO", "TXN", "VRSK", "VRTX", "WBD",
  "WDAY", "XEL", "ZS",
];

/**
 * Dow Jones Industrial Average 30 (point-in-time, 2026-04).
 * All are in S&P 500; included explicitly to make the source of
 * truth auditable.
 */
const DOW_30: readonly string[] = [
  "AAPL", "AMGN", "AMZN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
  "DOW", "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM",
  "MRK", "MSFT", "NKE", "NVDA", "PG", "SHW", "TRV", "UNH", "V", "VZ",
  "WMT",
];

/**
 * Retail-favorite tickers outside the major indexes. High search
 * volume from meme / fintech / EV crowds. Curated — not an algorithmic
 * cut. Review quarterly.
 */
const RETAIL_FAVORITES: readonly string[] = [
  // Meme / high-volatility
  "AMC", "GME", "BBBY", "BB", "NOK",
  // Fintech / neo-retail platforms
  "HOOD", "SOFI", "COIN", "AFRM", "UPST",
  // EV / EV-adjacent
  "RIVN", "LCID", "NIO", "XPEV", "LI", "FSR", "CHPT", "QS",
  // Popular growth / "story" stocks
  "PLTR", "SNOW", "RBLX", "U", "PATH", "RKLB", "LUNR", "JOBY", "ACHR",
  // Crypto-proxies (equity vehicles, not naked crypto)
  "MSTR", "MARA", "RIOT", "CLSK", "HUT", "WULF",
  // Cannabis
  "TLRY", "CGC", "ACB",
  // High retail-sentiment small caps
  "BYND", "DNA", "OPEN", "WISH", "CLOV", "HIMS", "PINS", "SNAP",
  // Travel / leisure retail favorites
  "DKNG", "CVNA", "CHWY", "PTON", "W",
];

/**
 * Major foreign ADRs widely traded on US exchanges. Yahoo has solid
 * coverage for these — they trade during US hours and have real US
 * tickers.
 */
const FOREIGN_ADRS: readonly string[] = [
  // Semis / tech ADRs
  "TSM", "ASML", "ARM", "SAP",
  // Chinese ADRs
  "BABA", "JD", "BIDU", "NTES", "TCEHY", "TME",
  // Energy / resources
  "BP", "SHEL", "TTE", "EQNR",
  // Pharma
  "NVO", "AZN", "GSK", "SNY",
  // Consumer / retail
  "SHOP", "SE", "MELI", "CPNG",
  // Financial
  "HSBC", "UBS", "ING", "BCS", "MFG",
  // Industrial / auto
  "TM", "HMC", "SONY", "STLA", "RACE",
  // Materials / mining
  "RIO", "BHP", "VALE",
];

/**
 * Popular ETFs — broad-market, sector, and thematic. Retail search
 * volume on ETF tickers rivals single-stock volume (e.g. "QQQ vs
 * VOO" is a frequent query). Yahoo covers these identically to
 * equities.
 */
const ETFS: readonly string[] = [
  // Broad-market US
  "SPY", "VOO", "IVV", "VTI", "ITOT", "SCHB",
  // Nasdaq / growth
  "QQQ", "QQQM", "VUG", "SCHG",
  // Small-cap
  "IWM", "VB", "IJR",
  // Mid-cap
  "MDY", "IJH", "VO",
  // Dow
  "DIA",
  // International
  "VEA", "VWO", "EFA", "EEM", "IEMG", "ACWI", "VXUS", "VT",
  // Sector SPDRs
  "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLRE", "XLU", "XLC",
  // Factor / theme
  "ARKK", "ARKG", "ARKQ", "ARKW", "ARKF",
  // Dividend / value
  "SCHD", "VIG", "VYM", "DVY", "HDV", "NOBL",
  // Bonds
  "AGG", "BND", "TLT", "IEF", "SHY", "LQD", "HYG", "JNK", "TIP",
  // Commodities / alts
  "GLD", "SLV", "IAU", "GDX", "GDXJ", "USO", "UNG", "PDBC",
  // Volatility / inverse (excluded the super-leveraged — data quality risk)
  "VXX",
  // Crypto-exposure ETFs
  "IBIT", "FBTC", "ETHE",
  // Semis / popular theme
  "SMH", "SOXX", "IGV", "IBB", "XBI",
];

/**
 * Combined seed list with asset-class labels. Deduped case-insensitively.
 * ETFs win ties (so any symbol that somehow appears in both lists is
 * classified as an ETF — safer for routing since ETF fundamentals
 * readers tolerate null better than equity ones).
 */
export const SEED_UNIVERSE: readonly SeedTicker[] = (() => {
  const byTicker = new Map<string, SeedAssetClass>();

  const addEquity = (t: string) => {
    const k = t.toUpperCase();
    // ETF wins ties — only set to equity if not already classified.
    if (!byTicker.has(k)) byTicker.set(k, "equity");
  };
  const addEtf = (t: string) => {
    byTicker.set(t.toUpperCase(), "etf");
  };

  for (const t of SP_500) addEquity(t);
  for (const t of NASDAQ_100) addEquity(t);
  for (const t of DOW_30) addEquity(t);
  for (const t of RETAIL_FAVORITES) addEquity(t);
  for (const t of FOREIGN_ADRS) addEquity(t);
  for (const t of ETFS) addEtf(t);

  return Array.from(byTicker.entries())
    .map(([ticker, assetClass]) => ({ ticker, assetClass }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
})();

/**
 * Just the tickers — for callers that don't need the asset-class split.
 */
export const SEED_TICKERS: readonly string[] = SEED_UNIVERSE.map(
  (t) => t.ticker
);
