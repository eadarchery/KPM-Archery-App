-- ============================================================
-- Migration 047: Coach can read linked students' achievements
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- The coach Achievements page showed "0 badges" for every archer because
-- achievement.user_achievements only allowed own-read + admin. Coaches now
-- read earned achievements of archers actively linked to them.
-- ============================================================

DROP POLICY IF EXISTS "user_achievements_coach_reads_linked" ON achievement.user_achievements;
CREATE POLICY "user_achievements_coach_reads_linked"
  ON achievement.user_achievements FOR SELECT TO authenticated
  USING (
    core.is_approved()
    AND EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.coach_id = auth.uid()
        AND cal.archer_id = achievement.user_achievements.profile_id
        AND cal.status = 'active'
    )
  );
