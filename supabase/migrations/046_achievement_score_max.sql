-- ============================================================
-- Migration 046: Score achievements require a matching round total
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- PROBLEM: score badges compared raw totals only, so an archer shooting a
-- double-distance 720-max round with 630 instantly "earned" the 100/200/300
-- badges meant for a 360-max round.
--
-- FIX: achievement_definitions gains max_score. A score badge is now earned
-- only by a submission where:
--     total_score >= threshold  AND  submission.max_score = def.max_score
-- (definitions with max_score NULL keep the old any-round behaviour).
--
-- Also adds public.recheck_score_achievements(): admin-only, re-evaluates ALL
-- score badges — revokes ones that no longer qualify (e.g. granted before the
-- max was set) and grants any that now do. Run it once after setting the max
-- on your score badges in the Achievement Manager.
-- ============================================================

ALTER TABLE achievement.achievement_definitions
  ADD COLUMN IF NOT EXISTS max_score int;

CREATE OR REPLACE VIEW public.achievement_definitions
  WITH (security_invoker = true) AS
SELECT * FROM achievement.achievement_definitions;

-- ─── Grant function: per-submission qualification ────────────────

CREATE OR REPLACE FUNCTION public.check_and_grant_achievements(p_profile_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total_arrows bigint;
  d              RECORD;
BEGIN
  SELECT COALESCE(SUM(arrows_shot), 0) INTO v_total_arrows
  FROM scoring.training_logs WHERE archer_id = p_profile_id;

  -- Score badges: a submission must reach the threshold IN a round whose
  -- max matches the badge's max_score (NULL max = any round, legacy).
  FOR d IN
    SELECT id, threshold, max_score FROM achievement.achievement_definitions
    WHERE category = 'score' AND active = true AND threshold IS NOT NULL
  LOOP
    IF EXISTS (
      SELECT 1 FROM scoring.score_submissions s
      WHERE s.archer_id = p_profile_id
        AND s.status = 'admin_approved'
        AND s.total_score >= d.threshold
        AND (d.max_score IS NULL OR s.max_score = d.max_score)
    ) THEN
      INSERT INTO achievement.user_achievements (profile_id, achievement_id, context)
      VALUES (p_profile_id, d.id, jsonb_build_object('threshold', d.threshold, 'round_max', d.max_score))
      ON CONFLICT (profile_id, achievement_id) DO NOTHING;
    END IF;
  END LOOP;

  -- Practice badges: unchanged (total training arrows).
  FOR d IN
    SELECT id, threshold FROM achievement.achievement_definitions
    WHERE category = 'practice' AND active = true AND threshold IS NOT NULL
      AND threshold <= v_total_arrows
  LOOP
    INSERT INTO achievement.user_achievements (profile_id, achievement_id, context)
    VALUES (p_profile_id, d.id, jsonb_build_object('total_arrows', v_total_arrows))
    ON CONFLICT (profile_id, achievement_id) DO NOTHING;
  END LOOP;
END;
$$;

-- ─── Admin recheck: revoke non-qualifying + grant qualifying ─────

CREATE OR REPLACE FUNCTION public.recheck_score_achievements()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_revoked int;
  v_archer  uuid;
BEGIN
  IF NOT core.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can recheck achievements.';
  END IF;

  -- Revoke score badges no longer backed by a qualifying submission.
  WITH bad AS (
    DELETE FROM achievement.user_achievements ua
    USING achievement.achievement_definitions d
    WHERE d.id = ua.achievement_id
      AND d.category = 'score' AND d.threshold IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM scoring.score_submissions s
        WHERE s.archer_id = ua.profile_id
          AND s.status = 'admin_approved'
          AND s.total_score >= d.threshold
          AND (d.max_score IS NULL OR s.max_score = d.max_score)
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_revoked FROM bad;

  -- Re-grant for every archer with approved scores (fills any now-qualifying).
  FOR v_archer IN
    SELECT DISTINCT archer_id FROM scoring.score_submissions WHERE status = 'admin_approved'
  LOOP
    PERFORM public.check_and_grant_achievements(v_archer);
  END LOOP;

  RETURN v_revoked;
END;
$$;

REVOKE ALL     ON FUNCTION public.recheck_score_achievements() FROM public;
GRANT  EXECUTE ON FUNCTION public.recheck_score_achievements() TO authenticated;
