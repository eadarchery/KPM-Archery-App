-- ============================================================
-- Migration 041: Session time on score submissions
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- Archers can shoot 2–3 sessions a day. A time-of-day lets each session be a
-- distinct point on the trend chart (same date, different time) and preserves
-- the order sessions happened in.
-- ============================================================

ALTER TABLE scoring.score_submissions
  ADD COLUMN IF NOT EXISTS session_time time;

-- Re-assert the passthrough view so the new column is reachable via PostgREST.
CREATE OR REPLACE VIEW public.score_submissions
  WITH (security_invoker = true) AS
SELECT * FROM scoring.score_submissions;
