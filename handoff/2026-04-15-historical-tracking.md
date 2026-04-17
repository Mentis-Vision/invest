# ClearPath Invest — Historical Tracking & Accountability System

**Created:** 2026-04-15
**Purpose:** Design + execution plan for the long-term recommendation tracking system. Turns ClearPath from "one-shot AI opinion" into "trusted advisor with an honest track record."
**Dependencies:** Plaid integration (P2.1 in `2026-04-15-next-steps.md`) should land first or in parallel — outcome detection needs actual trade data. The schema itself can be provisioned independently.

---

## Why this exists

Every other AI investing tool hides its misses. ClearPath will do the opposite:
- Every recommendation is stored forever.
- Every recommendation gets scheduled outcome checks at 7 / 30 / 90 / 365 days.
- If the user is Plaid-connected, we cross-reference their actual trades against our recommendations and categorize whether they followed, went contrary, or ignored us.
- We surface wins *and* losses prominently. Transparency beats confident-forever marketing.

This feature doesn't just build trust — each outcome becomes feedback the supervisor can use to calibrate future confidence. The AI gets better over time by being forced to grade its own homework.

**Positioning language (for marketing copy once this ships):**
> "In the last 30 days we made 8 recommendations. 5 went as predicted. 2 were wrong — NVDA (down 7% after BUY), CRM (up 4% after SELL). Here's what we misread in each."

That paragraph is the difference between a chatbot and an advisor.

---

## Schema — 6 new tables on Neon project `broad-sun-50424626`

### 1. `recommendation`
Every analysis we produce is stored. Even if the user closes the page immediately, we remember what we said.

```sql
CREATE TABLE IF NOT EXISTS "recommendation" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  confidence TEXT NOT NULL,
  consensus TEXT NOT NULL,
  "priceAtRec" NUMERIC(12,4) NOT NULL,
  "targetPrice" NUMERIC(12,4),
  summary TEXT NOT NULL,
  "analysisJson" JSONB NOT NULL,
  "dataAsOf" TIMESTAMP NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "recommendation_user_created_idx"
  ON "recommendation" ("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "recommendation_ticker_created_idx"
  ON "recommendation" (ticker, "createdAt" DESC);
```

**Field notes:**
- `recommendation`: `BUY | HOLD | SELL | INSUFFICIENT_DATA`
- `confidence`: `LOW | MEDIUM | HIGH`
- `consensus`: `UNANIMOUS | MAJORITY | SPLIT | INSUFFICIENT`
- `priceAtRec`: the live price captured at rec time (not historical)
- `analysisJson`: full snapshot — snapshot + all 3 model outputs + supervisor output + sources used. This is the audit trail. Never lose this.
- `targetPrice`: only populated if the analysis proposed a specific entry/exit price (optional field in a future schema update)

### 2. `holding`
User's actual positions, synced from Plaid (or manual entry in a later phase).

```sql
CREATE TABLE IF NOT EXISTS "holding" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  shares NUMERIC(18,8) NOT NULL,
  "costBasis" NUMERIC(14,4),
  "avgPrice" NUMERIC(12,4),
  currency TEXT NOT NULL DEFAULT 'USD',
  "accountName" TEXT,
  "plaidAccountId" TEXT,
  source TEXT NOT NULL DEFAULT 'plaid',
  "lastSyncedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "holding_user_ticker_account_idx"
  ON "holding" ("userId", ticker, COALESCE("accountName", ''));
```

**Field notes:**
- `source`: `plaid | manual` (future: `apex`, `drivewealth` if we add direct brokerage integration)
- Unique index prevents duplicates per user/ticker/account combination
- `NUMERIC(18,8)` on `shares` handles fractional shares (Robinhood, M1, etc.)

### 3. `trade`
Actual transactions pulled from Plaid's `/investments/transactions/get` endpoint.

```sql
CREATE TABLE IF NOT EXISTS "trade" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  type TEXT NOT NULL,
  shares NUMERIC(18,8) NOT NULL,
  price NUMERIC(12,4) NOT NULL,
  total NUMERIC(14,4) NOT NULL,
  fees NUMERIC(10,4) DEFAULT 0,
  "executedAt" TIMESTAMP NOT NULL,
  "plaidTransactionId" TEXT UNIQUE,
  "recommendationId" TEXT REFERENCES "recommendation"(id) ON DELETE SET NULL,
  "recommendationAlignment" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "trade_user_executed_idx"
  ON "trade" ("userId", "executedAt" DESC);
CREATE INDEX IF NOT EXISTS "trade_rec_idx"
  ON "trade" ("recommendationId") WHERE "recommendationId" IS NOT NULL;
```

**Field notes:**
- `type`: `BUY | SELL | DIVIDEND | SPLIT | TRANSFER_IN | TRANSFER_OUT` — Plaid's subtypes collapsed.
- `plaidTransactionId` is the idempotency key — unique constraint prevents dupes on re-sync.
- `recommendationId` is set by the cron when a trade maps back to an earlier recommendation (see logic below).
- `recommendationAlignment`: `followed | contrary | unrelated` — computed, not user-set.

### 4. `recommendation_outcome`
Scheduled evaluations. One recommendation creates four outcome rows up-front (7d, 30d, 90d, 1yr).

```sql
CREATE TABLE IF NOT EXISTS "recommendation_outcome" (
  id TEXT PRIMARY KEY,
  "recommendationId" TEXT NOT NULL REFERENCES "recommendation"(id) ON DELETE CASCADE,
  "checkAt" TIMESTAMP NOT NULL,
  window TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  "priceAtCheck" NUMERIC(12,4),
  "percentMove" NUMERIC(8,4),
  "userActed" BOOLEAN,
  verdict TEXT,
  commentary TEXT,
  "evaluatedAt" TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "outcome_check_pending_idx"
  ON "recommendation_outcome" ("checkAt") WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS "outcome_rec_idx"
  ON "recommendation_outcome" ("recommendationId");
```

**Field notes:**
- `window`: `7d | 30d | 90d | 1yr` — the label, for UI rendering
- `status`: `pending | completed | skipped` (skipped if the rec was INSUFFICIENT_DATA)
- `verdict`: enum values below under "Verdict logic"
- `commentary`: optional short AI-generated explanation ("This BUY call missed because revenue guidance was cut 2 weeks later — a signal not present in our data block at rec time")

### 5. `user_profile`
Risk tolerance, goals, preferences. Injected into future system prompts for personalization.

```sql
CREATE TABLE IF NOT EXISTS "user_profile" (
  "userId" TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  "riskTolerance" TEXT,
  "investmentGoals" TEXT[],
  horizon TEXT,
  "disclaimerAcceptedAt" TIMESTAMP,
  preferences JSONB DEFAULT '{}',
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Field notes:**
- `riskTolerance`: `conservative | moderate | aggressive`
- `investmentGoals`: array of `retirement | growth | income | preservation | speculation`
- `horizon`: `short | medium | long`
- `preferences`: flexible bag for later — ESG opt-in, sector preferences, excluded tickers
- `disclaimerAcceptedAt`: the one-click "I understand this is informational" acknowledgment (referenced in P4.2)

### 6. `price_snapshot`
Cache of historical prices keyed by `ticker + date`. So when we evaluate "what was NVDA worth 30 days after the rec?" we don't re-hit Yahoo for every outcome check, and we have a permanent audit trail.

```sql
CREATE TABLE IF NOT EXISTS "price_snapshot" (
  ticker TEXT NOT NULL,
  "capturedAt" DATE NOT NULL,
  price NUMERIC(12,4) NOT NULL,
  source TEXT NOT NULL DEFAULT 'yahoo',
  PRIMARY KEY (ticker, "capturedAt")
);
CREATE INDEX IF NOT EXISTS "price_snapshot_ticker_idx"
  ON "price_snapshot" (ticker);
```

---

## Migration SQL — run this in one shot via Neon MCP

Use `mcp__Neon__run_sql_transaction` with `projectId: broad-sun-50424626` and pass the array of `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` statements above as the `sqlStatements` array.

**Important:** Each statement goes as its own array entry — Neon's MCP errors on multi-statement prepared statements. Reference `consensus.ts` commit in git history for an example.

After running, verify with:
```sql
SELECT table_name, count(*) AS cols
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('recommendation','holding','trade','recommendation_outcome','user_profile','price_snapshot')
GROUP BY table_name;
```

You should see 6 rows with reasonable column counts.

---

## Integration with the existing research flow

### Modify `src/app/api/research/route.ts`

After the supervisor returns, insert a `recommendation` row and schedule outcomes.

```typescript
// After runSupervisor() returns `supervisor`:
const recId = createId(); // use @paralleldrive/cuid2 or similar
await pool.query(
  `INSERT INTO "recommendation" (id, "userId", ticker, recommendation, confidence, consensus, "priceAtRec", summary, "analysisJson", "dataAsOf")
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
  [
    recId,
    session.user.id,
    ticker,
    supervisor.finalRecommendation,
    supervisor.confidence,
    supervisor.consensus,
    snapshot.price,
    supervisor.summary,
    JSON.stringify({ snapshot, analyses, supervisor, sources }),
    snapshot.asOf,
  ]
);

// Only schedule outcomes for actionable recs
if (supervisor.finalRecommendation !== "INSUFFICIENT_DATA") {
  const now = new Date();
  const windows: Array<{ label: string; days: number }> = [
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
    { label: "90d", days: 90 },
    { label: "1yr", days: 365 },
  ];
  for (const w of windows) {
    const checkAt = new Date(now.getTime() + w.days * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO "recommendation_outcome" (id, "recommendationId", "checkAt", window)
       VALUES ($1, $2, $3, $4)`,
      [createId(), recId, checkAt, w.label]
    );
  }
}

// Include recId in the response so the UI can link to the history page
return NextResponse.json({ ticker, snapshot, analyses, supervisor, recommendationId: recId });
```

**Do not block the response on these writes if they fail.** Wrap in try/catch and log via your error logger (Priority 1.3). The user still sees the analysis even if tracking persistence fails.

---

## Cron job — daily outcome evaluation + Plaid sync

Create `src/app/api/cron/evaluate-outcomes/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
// ...

export async function GET(req: Request) {
  // Vercel Cron sends Bearer token from CRON_SECRET env var
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 1. Fetch new trades from Plaid for every connected user (see Plaid section below)
  await syncAllPlaidItems();

  // 2. Link recent trades to recommendations
  await linkTradesToRecommendations();

  // 3. Evaluate all outcome rows where checkAt <= NOW() and status = 'pending'
  await evaluatePendingOutcomes();

  return NextResponse.json({ ok: true });
}
```

Register the cron in `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/evaluate-outcomes", "schedule": "0 14 * * *" }
  ]
}
```
(14:00 UTC = 10am ET, after market close buffer — actually runs at ~9am ET to catch overnight and previous day.)

Set `CRON_SECRET` env var to a random 32-byte value.

### `linkTradesToRecommendations()`

```sql
-- For each trade executed in the last 24 hours without a linked recommendation,
-- find the most recent actionable recommendation for the same user + ticker
-- made in the last 90 days.
UPDATE "trade" t
SET
  "recommendationId" = r.id,
  "recommendationAlignment" = CASE
    WHEN (r.recommendation = 'BUY' AND t.type = 'BUY') THEN 'followed'
    WHEN (r.recommendation = 'SELL' AND t.type = 'SELL') THEN 'followed'
    WHEN (r.recommendation = 'HOLD' AND t.type IN ('BUY','SELL')) THEN 'contrary'
    WHEN (r.recommendation = 'BUY' AND t.type = 'SELL') THEN 'contrary'
    WHEN (r.recommendation = 'SELL' AND t.type = 'BUY') THEN 'contrary'
    ELSE 'unrelated'
  END
FROM (
  SELECT DISTINCT ON (r2."userId", r2.ticker)
    r2.id, r2."userId", r2.ticker, r2.recommendation
  FROM "recommendation" r2
  WHERE r2."createdAt" > NOW() - INTERVAL '90 days'
    AND r2.recommendation IN ('BUY','SELL','HOLD')
  ORDER BY r2."userId", r2.ticker, r2."createdAt" DESC
) r
WHERE t."userId" = r."userId"
  AND t.ticker = r.ticker
  AND t."recommendationId" IS NULL
  AND t."executedAt" > NOW() - INTERVAL '24 hours';
```

### `evaluatePendingOutcomes()` — the verdict engine

```typescript
const pending = await pool.query(
  `SELECT o.*, r."userId", r.ticker, r.recommendation, r."priceAtRec"
   FROM "recommendation_outcome" o
   JOIN "recommendation" r ON r.id = o."recommendationId"
   WHERE o.status = 'pending' AND o."checkAt" <= NOW()
   LIMIT 200`
);

for (const row of pending.rows) {
  // 1. Get price at check time (prefer cached, else hit Yahoo)
  const currentPrice = await getOrFetchPrice(row.ticker, row.checkAt);

  // 2. Compute move
  const percentMove = ((currentPrice - row.priceAtRec) / row.priceAtRec) * 100;

  // 3. Did the user trade this ticker between rec time and now?
  const { rows: trades } = await pool.query(
    `SELECT type, shares FROM "trade"
     WHERE "userId" = $1 AND ticker = $2
       AND "executedAt" > (SELECT "createdAt" FROM "recommendation" WHERE id = $3)
       AND "executedAt" <= $4`,
    [row.userId, row.ticker, row.recommendationId, row.checkAt]
  );
  const userActed = trades.length > 0;
  const actionType = trades.find(t => t.type === 'BUY' || t.type === 'SELL')?.type;

  // 4. Categorize
  const verdict = categorize(row.recommendation, actionType, percentMove);

  // 5. Persist
  await pool.query(
    `UPDATE "recommendation_outcome"
     SET status = 'completed', "priceAtCheck" = $1, "percentMove" = $2,
         "userActed" = $3, verdict = $4, "evaluatedAt" = NOW()
     WHERE id = $5`,
    [currentPrice, percentMove, userActed, verdict, row.id]
  );
}
```

### Verdict logic

```typescript
function categorize(rec: string, action: string | undefined, move: number): string {
  const THRESHOLD = 3; // % — below this, call it "flat"

  // BUY recommendations
  if (rec === 'BUY') {
    if (action === 'BUY') {
      return move > THRESHOLD ? 'followed_win'
           : move < -THRESHOLD ? 'followed_loss'
           : 'followed_flat';
    }
    return move > THRESHOLD ? 'ignored_win'      // they missed a good call
         : move < -THRESHOLD ? 'ignored_bullet'   // they dodged a bad call (we were wrong, but they're protected)
         : 'ignored_flat';
  }

  // SELL recommendations
  if (rec === 'SELL') {
    if (action === 'SELL') {
      return move < -THRESHOLD ? 'followed_win'  // sold before a drop
           : move > THRESHOLD ? 'followed_loss'  // sold and missed the rally
           : 'followed_flat';
    }
    return move < -THRESHOLD ? 'ignored_regret'  // they should have sold
         : move > THRESHOLD ? 'ignored_rally'    // we were wrong, they're glad they didn't sell
         : 'ignored_flat';
  }

  // HOLD — user doing nothing aligns with the rec
  if (rec === 'HOLD') {
    if (action) return 'contrary_' + (move > 0 ? 'regret' : 'win'); // they traded against HOLD
    return 'hold_confirmed';
  }

  return 'unknown';
}
```

---

## UI surfaces

### 1. Dashboard track record widget

On `/app` overview, a prominent card:

```
TRACK RECORD — LAST 30 DAYS
━━━━━━━━━━━━━━━━━━━━━━━━━
Recommendations: 8
Your alignment: 5 followed, 2 contrary, 1 ignored
Outcome grade: 6 of 8 as expected (75%)

✓ Solid calls: AAPL (BUY, +9% in 30d, you bought)
✗ Missed calls: NVDA (BUY, -7% in 30d, you bought — here's what we got wrong)
```

### 2. Per-recommendation history page

Route: `/app/history` — table of every past recommendation with:
- Date, ticker, rec, confidence
- Price at rec → price at 30d → % move
- User action (bought/sold/held) + alignment
- Verdict (colored badge)
- Click through to the full original analysis (stored in `analysisJson`)

### 3. Recommendation card enhancement

On every new research result, add a small "Our track record for this ticker" strip:
```
Past recommendations on NVDA: 3 BUY, 1 HOLD
At 30 days: 2 wins, 1 loss, 1 flat (66% hit rate)
```

Pulls from `recommendation` + `recommendation_outcome` where `ticker = $1`.

### 4. "Honest misses" page

Route: `/app/misses` — dedicated page of the losses. Don't hide these.

Purpose: signal radical transparency. Every miss gets a commentary line (AI-generated) explaining what signal we missed. Use it for:
- User trust
- Prompt tuning insights (patterns in our misses inform future system prompts)

---

## Implementation order (do NOT reorder)

1. **Migration** — provision the 6 tables. Can happen before anything else; runs in 2 seconds.
2. **Wire recommendation storage into `/api/research`** — every new rec persists going forward. Backfills aren't needed.
3. **Recommendation history page** (`/app/history`) — read-only first. No tracking yet, just "here's what we said."
4. **Plaid integration** (P2.1 from main next-steps doc). Must land before outcome evaluation.
5. **Cron for trade sync + outcome evaluation.**
6. **Dashboard track record widget.**
7. **Honest misses page + UI polish.**
8. **Feedback loop to supervisor** — inject past verdicts into system prompts (Phase 2).

---

## Effort estimate

| Step | Effort |
|---|---|
| Migration + schema | 30 min |
| Wire recommendation storage | 1h |
| History page (read-only) | 2h |
| Plaid integration | 1 day (see main next-steps) |
| Cron + verdict engine | 4h |
| Track record widget + misses page | 3h |
| Total (after Plaid) | ~2 days of focused work |

---

## Legal / disclaimer additions (important)

Tracking recommendation outcomes is powerful but creates a regulatory surface:
- **Never frame past performance as a promise of future results.** Every track-record UI must include the exact phrase *"Past recommendation outcomes are informational only. Not a guarantee of future performance. Not investment advice."*
- **Consider adding a disclaimer** that the user's trade execution, price received, taxes, and timing may differ from what our outcome page shows.
- **Keep the `analysisJson` immutable.** Never overwrite a recommendation's stored analysis. If an error is found, write a new row with `supersedes` column (future schema update).

---

## Testing checklist for the local agent

Before marking this done, verify:

- [ ] All 6 tables exist on Neon with correct indexes
- [ ] Running `/api/research` for `demo@clearpathinvest.app` on ticker `AAPL` inserts 1 row in `recommendation` and 4 rows in `recommendation_outcome`
- [ ] The `analysisJson` column contains the full supervisor + 3-model payload (check with `SELECT "analysisJson"->>'supervisor' FROM recommendation LIMIT 1;`)
- [ ] Cron endpoint `/api/cron/evaluate-outcomes` requires `CRON_SECRET` bearer token
- [ ] Manually setting an outcome row's `checkAt` to 1 minute ago and hitting the cron evaluates it correctly
- [ ] `/app/history` lists the demo user's past recommendations with correct formatting
- [ ] Plaid-synced trades correctly attach `recommendationId` when they match a recent rec
- [ ] Verdict labels match the `categorize()` function output for each of: BUY+BUY+up, BUY+nothing+up, SELL+SELL+down, HOLD+anything
- [ ] Every UI surface that shows historical outcomes renders the legal disclaimer

---

## One thing to watch out for

**Price freshness for outcome evaluation.** When the cron evaluates a 30-day-old recommendation, it needs *today's* price, not the price as of the `checkAt` timestamp (which may be yesterday). Use `yahoo.quote(ticker)` for the current value, then store that value in `price_snapshot` keyed by today's date.

Don't try to backfill historical daily prices on-demand — Yahoo doesn't reliably expose that for older dates via the free API. If you need 30d-ago prices for backfilling existing recs, use `yahoo.historical(ticker, { period1: ...})` and cache aggressively.

For the happy path (new recs going forward), you capture `priceAtRec` at write time — no backfill issue.
