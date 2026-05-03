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
};
