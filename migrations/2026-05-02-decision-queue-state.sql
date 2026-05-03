-- Phase 1 Actionable Dashboard rework
-- Spec: docs/superpowers/specs/2026-05-02-actionable-dashboard-phase-1-design.md

-- 1. New table: per-user, per-item state for the Decision Queue
CREATE TABLE IF NOT EXISTS decision_queue_state (
  id                  SERIAL PRIMARY KEY,
  "userId"            TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  item_key            TEXT NOT NULL,
  status              TEXT,
  "firstSurfacedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "snoozeUntil"       TIMESTAMPTZ,
  dismiss_reason      TEXT,
  surface_count       INTEGER NOT NULL DEFAULT 1,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT decision_queue_state_user_item_unique UNIQUE ("userId", item_key),
  CONSTRAINT decision_queue_state_status_chk
    CHECK (status IS NULL OR status IN ('snoozed', 'dismissed', 'done')),
  CONSTRAINT decision_queue_state_dismiss_reason_chk
    CHECK (dismiss_reason IS NULL
           OR dismiss_reason IN ('already_handled', 'disagree', 'not_applicable', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_dqs_user_status
  ON decision_queue_state("userId", status);

CREATE INDEX IF NOT EXISTS idx_dqs_snooze_expiry
  ON decision_queue_state("snoozeUntil")
  WHERE status = 'snoozed';

-- 2. user_profile columns for headline cache + concentration cap
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS headline_cache JSONB,
  ADD COLUMN IF NOT EXISTS headline_cached_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS concentration_cap_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00;
