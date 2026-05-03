// src/lib/dashboard/chip-definitions.ts
// Tooltip definitions for the layered chip row. Hovering a chip shows the definition.
// Spec §9.

export const CHIP_DEFINITIONS: Record<string, string> = {
  TQ: "Trade Quality (0–100). Composite of Business Quality, Valuation, Technical Trend, Growth, Sentiment, Macro Fit, and Insider/Events — weighted, with a penalty for missing data.",
  conc: "Concentration — this position as a percent of total portfolio value.",
  consensus: "How many of the three AI lenses (Value/Growth/Macro) agreed on the verdict.",
  earnings: "Days until the company reports earnings.",
  stale: "Days since the last research run on this ticker.",
  "since-rec": "Price move since the original recommendation.",
  "IV-rank": "Implied volatility rank — current option-implied volatility as a percentile of its 1-year range.",
  "prior-reaction": "Price reaction the day after the most recent earnings report.",
  position: "Current position size as a percent of total portfolio value.",
  outcome: "Realized price move at the closest evaluation window since the original recommendation.",
  cash: "Idle cash currently in the brokerage account.",
  "days-idle": "Number of consecutive days the cash has been idle.",
  candidates: "Number of BUY-rated research recommendations that fit the user's sector budget.",
  broker: "Linked brokerage requiring reauthorization.",
  "last-sync": "Days since the last successful holdings sync from this broker.",
  pace: "Year-to-date portfolio return relative to the SPY benchmark.",
  "F-Score":
    "Piotroski F-Score (0–9). Sum of nine binary accounting checks — profitability, leverage, efficiency. 7+ = strong, 4–6 = mixed, 0–3 = weak.",
  Z: "Altman Z-Score (5-factor). Above 2.99 = safe, 1.81–2.99 = grey zone, below 1.81 = financial distress.",
  M: "Beneish M-Score (8-factor). Above −1.78 flags potential earnings manipulation; below is the clean zone.",
  accruals:
    "Sloan accruals ratio = (NetIncome − CFO) / TotalAssets. High positive values flag earnings driven by accruals rather than cash.",
  mom: "Jegadeesh-Titman 12-1 momentum — total return over the trailing 12 months minus the most recent 1 month, which strips out short-term reversal. Positive values mean the trend has been accelerating into a recent pause.",
  rev6:
    "Analyst revision breadth (trailing 6 months) — count of months where Finnhub's aggregate strong-buy / buy / sell / strong-sell mix moved up vs. down month-over-month. +5/-2 means five upgrade-months against two downgrade-months. Informational only, not investment advice.",
  "12-1 mom":
    "Jegadeesh-Titman 12-1 momentum — total return over the trailing 12 months minus the most recent 1 month, which strips out short-term reversal. Positive values mean the trend has been accelerating into a recent pause.",
  Kelly:
    "Fractional Kelly position size — the share of portfolio that maximizes long-run geometric growth given your historical win-rate and average win/loss. We display ¼ Kelly to reduce drawdown when the inputs are estimated from a small sample. Informational only, not investment advice.",
  "pos size":
    "Suggested fractional Kelly position size, derived from your realized win-rate and avg win/loss across BUY recommendations. Informational only, not investment advice.",
  regime:
    "Market regime composite — combines VIX level, VIX9D/VIX term structure, days-to-FOMC, and put/call ratio into a 4-bucket label (Risk-on, Neutral, Fragile, Stress).",
  "VIX9D/VIX":
    "VIX9D divided by VIX. Below 1.0 means contango (calm); above 1.0 means backwardation (front-month vol pricing higher than longer-dated, classic risk-off signal).",
  CAPE:
    "Shiller cyclically-adjusted P/E ratio — S&P 500 price divided by 10-year average inflation-adjusted earnings. Deferred (no stable free API); Damodaran's monthly implied ERP is the credible alternative shipped on the Year Outlook surface instead.",
  ERP:
    "Damodaran's S&P 500 implied equity risk premium — the equity premium embedded in current index prices given forward earnings and payout assumptions. Updated quarterly from the NYU Stern data file. Informational only, not investment advice.",
  COE:
    "Implied cost of equity — the annual return current price + dividends imply the market is demanding to hold this stock. Gordon Growth (D₁/P + g) when there's a dividend stream, else CAPM (rf + β·ERP). Spread vs market = COE − (rf + ERP); positive means a richer hurdle than the index.",
  Buffett:
    "Buffett indicator — total US stock market capitalization (Wilshire 5000) divided by nominal GDP. Above 1.4 has historically signaled stretched valuations. Informational only, not investment advice.",
  "T-FOMC":
    "Calendar days until the next FOMC rate-decision announcement. Markets routinely freeze inside the 3-day window around an announcement; the regime composite weights it as a stress factor.",
  "VaR 95":
    "Value-at-Risk at 95% confidence — the loss the portfolio is expected to exceed on roughly 1 in 20 trading days, derived from the empirical (historical) return distribution rather than a Gaussian assumption. Informational only, not investment advice.",
  "VaR 99":
    "Value-at-Risk at 99% confidence — the loss the portfolio is expected to exceed on roughly 1 in 100 trading days. Always more extreme than VaR 95 and a cleaner read on tail risk for concentrated portfolios.",
  CVaR:
    "Conditional VaR / Expected Shortfall — the average loss across the days that breach VaR. Cares not just about where the cutoff sits but how bad the bad days actually are; tighter measure of tail risk than VaR alone.",
  "var-1mo":
    "1-month VaR projected from the daily figure via square-root-of-time scaling (sqrt(21) trading days). Assumes returns are i.i.d. — same shape regulators expect for capital adequacy reporting. Informational only, not investment advice.",
  "target $":
    "Target wealth — the amount of money you're aiming to accumulate by your target date.",
  "target date": "Target date — when you want to reach your target wealth.",
  glidepath:
    "Target stock/bond allocation derived from your age and risk tolerance ('120-age' rule with risk offsets).",
  "risk-tol":
    "Your risk tolerance setting: conservative, moderate, or aggressive.",
  drift:
    "Difference between current stock allocation and your target glidepath, in percentage points.",
  loss:
    "Unrealized loss on this position — current value minus original cost basis. Negative values qualify for tax-loss harvesting if held in a taxable (non-IRA / non-401k) account.",
  replacement:
    "Suggested wash-sale-safe replacement — a broad sector ETF unlikely to be deemed 'substantially identical' to the sold position. General guidance only; verify with your tax advisor before acting.",
  "wash-sale":
    "IRS wash-sale rule — selling at a loss and buying the same or substantially identical security within 30 days before OR after disallows the loss. The 30-day window applies symmetrically.",
  "tax-window":
    "Days remaining in the current tax year to harvest losses for this year's return. December 31 is the cutoff for most filers; consult your tax advisor.",
  insiders:
    "Number of distinct insiders (officers, directors, 10% owners) making open-market purchases inside the cluster window. ≥ 3 is the cluster threshold.",
  cluster:
    "Aggregate dollar value of cluster purchases across all participating insiders inside the rolling 14-day window. Excludes 10b5-1 plan trades.",
  window:
    "Width of the cluster window in calendar days — start date of earliest qualifying purchase to latest, capped at 14 days.",
  short:
    "Short interest as a percent of float, change vs. previous bi-weekly FINRA report. Rapid increase can mean rising bearish conviction; rapid decrease can mean a short squeeze unwinding.",
  dtc:
    "Days to cover — short interest divided by average daily volume. Above 5 days suggests it would take meaningful buying pressure for shorts to exit cleanly.",
  SKEW:
    "CBOE SKEW index — measures perceived tail-risk in S&P 500 options pricing. Levels above 130 indicate elevated black-swan hedging; levels below 110 indicate complacency.",
  "real-yield":
    "10-year TIPS real yield (DFII10) — nominal Treasury yield minus market-implied inflation. Positive real yields tighten financial conditions; negative real yields support risk assets.",
  breakeven:
    "10-year breakeven inflation (T10YIE) — the inflation rate the bond market is pricing in over the next decade. Rises with inflation expectations.",
  "dot-plot":
    "Median FOMC member projection for the federal funds rate (Summary of Economic Projections). Compared against market-implied path to gauge whether the market is pricing more or less easing than the Fed signals.",
  "home-bias":
    "Share of equity exposure in US-listed names. The global market-cap weight of the US is roughly 60%; allocating substantially more is a 'home bias' that historically correlates with under-diversification.",
  concentration:
    "Combined weight of the top three sector buckets in the portfolio. Trends upward over time when the user keeps adding to winners.",
  recency:
    "Recency-chase counter — count of recent recommendations or trades into year-to-date winners. Behavioral nudge, not advice.",
  "stress-test":
    "Hypothetical portfolio drawdown under a historical scenario (2008-09, 2020-Mar, +100bps rates). Computed by applying historical factor shocks to your current Fama-French exposures.",
};
