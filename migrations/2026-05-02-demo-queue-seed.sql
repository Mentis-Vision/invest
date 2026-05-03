-- migrations/2026-05-02-demo-queue-seed.sql
-- Phase 1 dashboard rework — demo user seed.
-- Ensures the demo user (demo@clearpathinvest.app) has a 5.00% concentration
-- cap so the existing held positions trigger believable
-- concentration_breach queue items in the new actionable dashboard.
--
-- Idempotent — safe to re-run. Demo user already has the default 5.00 cap
-- from the initial migration; this UPDATE is a no-op in that case (the
-- IS DISTINCT FROM guard skips the write entirely).

UPDATE user_profile
SET concentration_cap_pct = 5.00
WHERE "userId" = (SELECT id FROM "user" WHERE email = 'demo@clearpathinvest.app')
  AND concentration_cap_pct IS DISTINCT FROM 5.00;
