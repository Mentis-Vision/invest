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
    "Shiller cyclically-adjusted P/E ratio — S&P 500 price divided by 10-year average inflation-adjusted earnings. Currently deferred; no stable free API source.",
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
};
