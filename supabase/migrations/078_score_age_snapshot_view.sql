-- ============================================================
-- Migration 078: Expose score age-snapshot columns through the API view
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent. Additive only — re-expands one view, no data change.
--
-- WHY: Migration 059 added competition_year / competition_age to
--      scoring.score_submissions but did NOT recreate public.score_submissions.
--      A SELECT * view does not auto-gain columns added later — its column list
--      froze when migration 045 last rebuilt it. The score form now sends those
--      columns on every submission, so ALL archer score submissions (total,
--      per-arrow, plot) fail with:
--        "Could not find the 'competition_age' column of 'score_submissions'
--         in the schema cache"
-- ============================================================

-- Safety net: ensure the base columns exist even if 059 was skipped.
ALTER TABLE scoring.score_submissions
  ADD COLUMN IF NOT EXISTS competition_year int,
  ADD COLUMN IF NOT EXISTS competition_age  int;

-- Re-expand SELECT * so the view exposes the new columns to PostgREST.
-- CREATE OR REPLACE preserves existing grants; the explicit grant below is
-- belt-and-braces. RLS on the base table still governs all access.
CREATE OR REPLACE VIEW public.score_submissions
  WITH (security_invoker = true) AS
SELECT * FROM scoring.score_submissions;

GRANT SELECT, INSERT, UPDATE ON public.score_submissions TO authenticated;

-- Reload the API schema cache immediately.
NOTIFY pgrst, 'reload schema';
