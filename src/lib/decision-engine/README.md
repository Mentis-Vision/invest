# ClearPath Decision Engine

This module contains the deterministic risk-first decision-support engine.

It does not call AI models, place trades, connect to execution systems, or
make investment-advice claims. It scores trade quality, evaluates risk gates,
suggests percent-based max allocation, and returns auditable reasons and
review triggers.

## Main Flow

1. `adapter.ts` normalizes live snapshot, warehouse, macro, portfolio, and event data.
2. `score.ts` computes weighted component scores.
3. `risk.ts` evaluates blocking/capping gates and position-sizing guidance.
4. `index.ts` derives the final action, confidence, summary, risks, and audit block.
5. `radar.ts` scans holdings or tickers for changing review conditions and
   can persist cron-generated alerts through the existing alert pipeline.

## Safety Rules

- No trade execution.
- No buy/sell/execute buttons.
- No AI calls.
- No warehouse writes from app request handlers.
- No userId columns in warehouse tables.
- Position sizing is percent-based guidance only.
- All client-facing output is informational only and not investment advice.
