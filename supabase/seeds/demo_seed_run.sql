-- ============================================================
-- RUN DEMO SEED — paste this whole file into the Supabase SQL Editor.
-- ------------------------------------------------------------
--   Prerequisite: migration 070_mock_demo_data.sql has been run once
--   (it installs the functions + mock-tracking columns).
--
--   This inserts a fresh, fully-tagged demo batch (6 states × 6 archers +
--   2 coaches + ~216 scores + training). It clears its own previous batch
--   first, so running it again never duplicates. Real data is untouched.
--
--   To REMOVE everything later: run supabase/seeds/demo_clear_run.sql
-- ============================================================

SELECT public.seed_kpm_demo_mock_data() AS seed_result;

-- Verify what now exists (all tagged is_mock_data = true):
SELECT
  (SELECT count(*) FROM core.profiles            WHERE is_mock_data AND role='archer') AS archers,
  (SELECT count(*) FROM core.profiles            WHERE is_mock_data AND role='coach')  AS coaches,
  (SELECT count(*) FROM scoring.score_submissions WHERE is_mock_data)                  AS scores,
  (SELECT count(*) FROM scoring.training_logs     WHERE is_mock_data)                  AS training_logs,
  (SELECT count(*) FROM org.schools               WHERE is_mock_data)                  AS mock_schools,
  (SELECT count(*) FROM org.states                WHERE is_mock_data)                  AS mock_states;
