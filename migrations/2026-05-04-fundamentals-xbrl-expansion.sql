-- 2026-05-04 — extend ticker_fundamentals with XBRL-sourced columns
-- needed by Phase 2 Batch B quality scores (Piotroski / Altman / Beneish
-- / Sloan). Yahoo's quoteSummary leaves these fields empty for many
-- companies; SEC Company Facts (us-gaap) has them as authoritative
-- filings. Each new column is NUMERIC NULL — defensive default so the
-- enrichment step can no-op when SEC has no fact for a given concept.
--
-- Columns:
--   retained_earnings        — RetainedEarningsAccumulatedDeficit
--   current_assets           — AssetsCurrent
--   current_liabilities      — LiabilitiesCurrent
--   accounts_receivable      — AccountsReceivableNetCurrent
--   depreciation             — DepreciationDepletionAndAmortization (or
--                              fallback Depreciation)
--   sga                      — SellingGeneralAndAdministrativeExpense
--   ebit                     — IncomeLossFromContinuingOperationsBefore
--                              IncomeTaxesExtraordinaryItemsNoncontroll
--                              ingInterest (or fallback to OperatingIncomeLoss)
--   property_plant_equipment — PropertyPlantAndEquipmentNet
--
-- All NULL by default; existing rows untouched. Idempotent via
-- ADD COLUMN IF NOT EXISTS so the cron can be re-run during rollout.

ALTER TABLE "ticker_fundamentals"
  ADD COLUMN IF NOT EXISTS retained_earnings NUMERIC,
  ADD COLUMN IF NOT EXISTS current_assets NUMERIC,
  ADD COLUMN IF NOT EXISTS current_liabilities NUMERIC,
  ADD COLUMN IF NOT EXISTS accounts_receivable NUMERIC,
  ADD COLUMN IF NOT EXISTS depreciation NUMERIC,
  ADD COLUMN IF NOT EXISTS sga NUMERIC,
  ADD COLUMN IF NOT EXISTS ebit NUMERIC,
  ADD COLUMN IF NOT EXISTS property_plant_equipment NUMERIC;
