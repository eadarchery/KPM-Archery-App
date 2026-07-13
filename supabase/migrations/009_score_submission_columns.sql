-- ============================================================
-- Migration 009: Extend score_submissions for coach workflow
-- ============================================================

-- Add bow_category (enum) to record archer's category at submission time
ALTER TABLE scoring.score_submissions
  ADD COLUMN IF NOT EXISTS bow_category bow_category;

-- Add age_group for the archer at submission time
ALTER TABLE scoring.score_submissions
  ADD COLUMN IF NOT EXISTS age_group text;

ALTER TABLE scoring.score_submissions
  ADD CONSTRAINT score_submissions_age_group_check
  CHECK (age_group IS NULL OR age_group IN ('u14','u18','u21','open'));

-- Add venue / location (optional)
ALTER TABLE scoring.score_submissions
  ADD COLUMN IF NOT EXISTS venue text;

-- Extend status to include 'withdrawn' (coach can withdraw pending submissions)
-- PostgreSQL auto-names an unnamed inline check as {table}_{column}_check
ALTER TABLE scoring.score_submissions
  DROP CONSTRAINT IF EXISTS score_submissions_status_check;

ALTER TABLE scoring.score_submissions
  ADD CONSTRAINT score_submissions_status_check
  CHECK (status IN ('pending','coach_approved','admin_approved','rejected','withdrawn'));
