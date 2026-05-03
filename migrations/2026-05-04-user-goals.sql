-- Phase 3 Batch F: user goals (target wealth + glidepath inputs).
-- Adds the columns the dashboard needs to evaluate "are you on pace?"
-- and to compute a target stock/bond/cash allocation for the
-- `rebalance_drift` Decision Queue item.
--
-- All columns are nullable. A user with no goals set yet sees the
-- `goals_setup` queue item until they fill the form; until then,
-- `rebalance_drift` cannot fire (no target to compare against).
--
-- riskTolerance already exists on user_profile (TEXT, nullable) — we
-- reuse it. No check constraint is added here so we don't conflict
-- with any historical free-form values; the API route validates the
-- enum on write.

ALTER TABLE "user_profile"
  ADD COLUMN IF NOT EXISTS "targetWealth" NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS "targetDate" DATE NULL,
  ADD COLUMN IF NOT EXISTS "monthlyContribution" NUMERIC NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "currentAge" INTEGER NULL;
