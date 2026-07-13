-- ============================================================
-- REMOVE ALL DEMO DATA — paste this whole file into the Supabase SQL Editor.
-- ------------------------------------------------------------
--   Deletes ONLY rows tagged is_mock_data = true. It can never delete a
--   real archer, coach, score, school, PLD or state. Safe to run any time,
--   even if no demo data is present (it just reports zeros).
-- ============================================================

SELECT public.clear_kpm_demo_mock_data() AS clear_result;

-- Confirm nothing tagged remains (every count should be 0):
SELECT
  (SELECT count(*) FROM core.profiles            WHERE is_mock_data) AS profiles_left,
  (SELECT count(*) FROM scoring.score_submissions WHERE is_mock_data) AS scores_left,
  (SELECT count(*) FROM scoring.training_logs     WHERE is_mock_data) AS training_left,
  (SELECT count(*) FROM coaching.coach_archer_links WHERE is_mock_data) AS links_left,
  (SELECT count(*) FROM org.schools               WHERE is_mock_data) AS schools_left,
  (SELECT count(*) FROM org.plds                  WHERE is_mock_data) AS plds_left,
  (SELECT count(*) FROM org.states                WHERE is_mock_data) AS states_left;
