# ClearPath Invest Decision Engine

## Purpose

The ClearPath decision engine is a deterministic, risk-first decision-support engine. It helps users review trade quality, downside risk, position sizing, data quality, and changing portfolio conditions before relying on an AI research verdict.

It is not a trading bot, broker, execution system, registered investment adviser, or promise of future returns.

## What It Does

- Computes a Trade Quality Score from 0 to 100.
- Classifies the output as High-Conviction Candidate, Buy Candidate, Hold / Watch, Reduce / Review, Avoid, or Insufficient Data.
- Applies deterministic risk gates before surfacing constructive labels.
- Suggests max allocation by risk profile.
- Estimates reward/risk only when a valid target and review level exist.
- Flags missing data and source drift.
- Compares the AI research verdict against a deterministic risk overlay.
- Powers Risk Radar review alerts for holdings that may deserve another look.

## What It Does Not Do

- It does not execute trades.
- It does not place orders.
- It does not connect to brokerage execution.
- It does not auto-trade.
- It does not guarantee profits or future performance.
- It does not provide investment advice.

SnapTrade and Plaid remain read-only data sources.

## Scoring Weights

The engine uses these weights:

| Component | Weight |
|---|---:|
| Business quality | 20% |
| Valuation | 20% |
| Technical trend | 20% |
| Growth / earnings | 15% |
| Sentiment / news | 10% |
| Macro fit | 10% |
| Insider / events | 5% |

The deterministic score is designed to be auditable. Missing values are neutral where possible but lower data quality and confidence.

## Risk Gates

Risk gates can warn, block, or cap the output:

- Bad data: missing price or source drift above 5%.
- Liquidity: low dollar volume, microcap exposure, or low share price.
- Trend: price below 200-day average, 50-day below 200-day, or both.
- Macro/high beta: high-beta names are capped in risk-off regimes.
- Events: near-term earnings, material filings, or negative headlines.
- Concentration: 25% and 40% portfolio thresholds.
- Reward/risk: setups below 2:1 are capped at Hold / Watch.

Conservative overrides are intentional. The risk overlay may be more conservative than the AI research verdict.

## Position Sizing

Risk profile defaults:

| Profile | Max risk per trade | Suggested max single-stock allocation |
|---|---:|---:|
| Conservative | 0.5% | 3% |
| Balanced | 1.0% | 5% |
| Aggressive | 1.5% | 8% |

The global max is 10%. If portfolio value is unavailable, the engine returns percent-only guidance and does not compute share counts.

## Data Quality

The data-quality score starts at 100 and falls for missing or suspect inputs:

- Missing or invalid current price.
- Missing market cap.
- Missing trend/range fields.
- Missing fundamentals.
- Missing average volume.
- Cross-source verification drift above 1% or 5%.

If data quality is below 60, the action becomes Insufficient Data.

## Market Regime

The classifier uses VIX, Treasury yields, Fed funds, CPI trend, unemployment trend, and broad equity trend inputs when available.

Possible regimes:

- Risk On
- Neutral
- Late Cycle Caution
- Rate Pressure
- Liquidity Stress
- Recession Risk
- High Volatility Risk Off
- Insufficient Data

The classifier is deterministic and explainable. Missing macro data lowers confidence.

## Benchmark Comparison

Benchmark comparison uses warehouse `ticker_market_daily` rows for SPY or QQQ. It does not call expensive external APIs for every outcome. If benchmark rows are missing, alpha is returned as null with a clear note.

Alpha is retrospective context only. It is not a guarantee of future performance.

## Backtest Limitations

The current backtest module is a safe scaffold only. It returns readiness based on historical warehouse coverage and does not publish hypothetical performance.

Known limitations:

- No guarantee of future results.
- May exclude slippage.
- May exclude taxes.
- May exclude dividends.
- May exclude corporate actions.
- Not investment advice.

## AI Integration

The research route runs the deterministic engine before the AI panel. The AI sees an internal `[DECISION ENGINE RISK OVERLAY]` block after macro context, but the block is explicitly labeled as an internal risk-control overlay, not external market truth.

The final UI shows both:

- AI research verdict.
- Deterministic risk overlay.

If the AI verdict is more bullish than the overlay, the UI states: "The deterministic risk overlay is more conservative than the AI research verdict."

## Risk Radar

Risk Radar scans holdings and provided tickers for review conditions:

- Trend breaks.
- Macro shifts.
- Concentration risk.
- Earnings or filing risk.
- Valuation stretch.
- Relative-strength breaks.
- Source drift.
- Risk overlay downgrades.

Risk Radar uses a read-only user API and does not call AI. Alerts say "Review," not command language.

Radar alert persistence runs from `/api/cron/risk-radar` into the existing
`alert_event` table with the same dedup pattern used by existing alerts.
The interactive `/api/radar` route remains read-only and never writes alerts
during page load. It reads recent persisted `risk_radar` rows first and falls
back to a live scan when no recent persisted alert exists.

## Compliance-Sensitive Language

Use:

- Trade Quality Score
- Decision Support
- Risk Overlay
- Buy Candidate
- Hold / Watch
- Reduce / Review
- Avoid
- Insufficient Data
- Suggested max allocation
- Review trigger
- Risk gate
- Informational only
- Not investment advice

Do not use hype, promises of outcomes, command language, or labels that imply
automated stock selection or trade execution.

## Future Improvements

- Persist benchmark alpha fields on outcome rows after a migration.
- Add a watchlist table and include watchlist tickers in radar scans.
- Add historical regime transitions to improve macro-shift detection.
- Add split/dividend adjusted outcome calculations.
