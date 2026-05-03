-- migrations/2026-05-04-user-benchmarks.sql
-- Phase 5 dashboard redesign — user-configurable benchmark list.
-- Stores ordered array of benchmark keys (preset slugs OR ticker symbols).
-- Application enforces max 4 entries; DB does not constrain (future-proof).

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS benchmarks JSONB NOT NULL DEFAULT '["sp500","nasdaq","dow"]'::jsonb;
