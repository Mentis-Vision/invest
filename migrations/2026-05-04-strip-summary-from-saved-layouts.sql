-- Phase 8 follow-up: remove the 'summary' block from saved user layouts.
-- DEFAULT_LAYOUT was updated in commit cf38764 to drop the redundant
-- 'summary' block (Portfolio summary duplicates the new PortfolioHero).
-- That change only applies to NEW users — users with saved layouts still
-- have summary pinned. This migration strips it from existing rows.
--
-- Idempotent: safe to re-run.

UPDATE dashboard_layout
SET blocks = (
  SELECT jsonb_agg(b)
  FROM jsonb_array_elements(blocks) b
  WHERE b->>'id' IS DISTINCT FROM 'summary'
),
"updatedAt" = NOW()
WHERE blocks @> '[{"id":"summary"}]'::jsonb;
