-- Phase 3 Batch H: per-user chip preferences.
-- Adds a JSONB column to user_profile that lets users pin/hide
-- individual chips (e.g. "F-Score", "mom", "Kelly") from the layered
-- chip row rendered on the Decision Queue and Daily Headline.
--
-- Shape stored in the column:
--
--   {
--     "pinned": ["F-Score", "TQ"],
--     "hidden": ["accruals"]
--   }
--
-- Both lists default to empty. Any chip whose `tooltipKey` is in
-- `hidden` is skipped at render time. Pinned chips render first, in
-- the order listed. Unknown keys are tolerated (just ignored), so a
-- removed chip definition won't break the prefs payload.
--
-- Default `'{}'::jsonb` (rather than `{"pinned":[],"hidden":[]}`) keeps
-- the migration backwards-compatible: chip-prefs.ts treats a missing /
-- empty object the same as both lists being empty.

ALTER TABLE "user_profile"
  ADD COLUMN IF NOT EXISTS "chip_prefs" JSONB NOT NULL DEFAULT '{}'::jsonb;
