-- ============================================================
-- Migration 079: Widen the score age_group CHECK constraint
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent. Constraint-only change, no data touched.
--
-- WHY: The score form stamps each submission with a calendar-year age group
--      ('U12','U15','U18','Open'). The live CHECK constraint on the table is
--      still the legacy migration-009 version — CHECK (age_group IN
--      ('u14','u18','u21','open')) — so every submission is rejected with:
--        new row for relation "score_submissions" violates check constraint
--        "score_submissions_age_group_check"
--
--      Migration 059 was meant to widen this but was not applied on this
--      database. This migration re-asserts ONLY the constraint (surgical), so
--      it cannot revert the gender leaderboard from migration 075 the way a
--      full 059 re-run would.
-- ============================================================

ALTER TABLE scoring.score_submissions
  DROP CONSTRAINT IF EXISTS score_submissions_age_group_check;

-- Accept the canonical U12/U15/U18/Open set AND every legacy lowercase value
-- that may already be stored, so existing rows never violate the new rule.
ALTER TABLE scoring.score_submissions
  ADD CONSTRAINT score_submissions_age_group_check
  CHECK (age_group IS NULL OR age_group IN
    ('U12','U15','U18','Open','u12','u14','u15','u18','u21','open'));

-- No column change, but harmless and consistent with house style.
NOTIFY pgrst, 'reload schema';
