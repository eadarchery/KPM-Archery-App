-- ============================================================
-- Migration 057: Score badges match distance + round type; earned
--                badges remember WHICH score earned them
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run. Supersedes the grant/recheck
--       functions from migration 046.
--
-- A score badge now qualifies only when ALL of its set conditions match the
-- submission's round:
--   • total_score >= threshold                          (as before)
--   • submission.max_score = def.max_score              (as before, 046)
--   • round.distance_m     = def.distance_m             (NEW — 18/30/50/70m…)
--   • round type matches   def.round_category           (NEW — tournament|practice)
-- NULL on any def field = that condition is not checked (legacy behaviour).
-- Single vs double rounds at the same distance are told apart by max_score
-- (e.g. 70m 360 single vs 70m 720 double).
--
-- def.round_category values: 'tournament' matches rounds.category='tournament';
-- 'practice' matches rounds.category IN ('training','practice') — the app uses
-- the two words interchangeably.
--
-- Earned badges now store the qualifying submission in user_achievements.context
-- (submission_id, total_score, date, venue, round_name) so the UI can show the
-- match the badge was earned with. recheck also backfills context for old grants.
-- ============================================================

ALTER TABLE achievement.achievement_definitions
  ADD COLUMN IF NOT EXISTS distance_m int,
  ADD COLUMN IF NOT EXISTS round_category text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'achievement_defs_round_category_check') THEN
    ALTER TABLE achievement.achievement_definitions ADD CONSTRAINT achievement_defs_round_category_check
      CHECK (round_category IS NULL OR round_category IN ('tournament','practice'));
  END IF;
END $$;

CREATE OR REPLACE VIEW public.achievement_definitions
  WITH (security_invoker = true) AS
SELECT * FROM achievement.achievement_definitions;

-- ─── Shared qualification predicate (SQL fragment, kept identical in both
--     functions below — update BOTH if the rule ever changes) ─────────────────

-- ─── Grant function ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_and_grant_achievements(p_profile_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total_arrows bigint;
  d              RECORD;
  q              RECORD;
BEGIN
  SELECT COALESCE(SUM(arrows_shot), 0) INTO v_total_arrows
  FROM scoring.training_logs WHERE archer_id = p_profile_id;

  -- Score badges: best submission that satisfies EVERY set condition.
  FOR d IN
    SELECT id, threshold, max_score, distance_m, round_category
    FROM achievement.achievement_definitions
    WHERE category = 'score' AND active = true AND threshold IS NOT NULL
  LOOP
    SELECT s.id, s.total_score, s.date, s.venue, r.name AS round_name
      INTO q
    FROM scoring.score_submissions s
    LEFT JOIN scoring.rounds r ON r.id = s.round_id
    WHERE s.archer_id = p_profile_id
      AND s.status = 'admin_approved'
      AND s.total_score >= d.threshold
      AND (d.max_score      IS NULL OR s.max_score = d.max_score)
      AND (d.distance_m     IS NULL OR r.distance_m = d.distance_m)
      AND (d.round_category IS NULL
           OR (d.round_category = 'tournament' AND r.category = 'tournament')
           OR (d.round_category = 'practice'   AND r.category IN ('training','practice')))
    ORDER BY s.total_score DESC, s.date ASC
    LIMIT 1;

    IF FOUND THEN
      INSERT INTO achievement.user_achievements (profile_id, achievement_id, context)
      VALUES (p_profile_id, d.id, jsonb_build_object(
        'threshold',     d.threshold,
        'round_max',     d.max_score,
        'submission_id', q.id,
        'total_score',   q.total_score,
        'date',          q.date,
        'venue',         q.venue,
        'round_name',    q.round_name
      ))
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

-- ─── Admin recheck: revoke stale + grant qualifying + backfill context ───────

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
        SELECT 1
        FROM scoring.score_submissions s
        LEFT JOIN scoring.rounds r ON r.id = s.round_id
        WHERE s.archer_id = ua.profile_id
          AND s.status = 'admin_approved'
          AND s.total_score >= d.threshold
          AND (d.max_score      IS NULL OR s.max_score = d.max_score)
          AND (d.distance_m     IS NULL OR r.distance_m = d.distance_m)
          AND (d.round_category IS NULL
               OR (d.round_category = 'tournament' AND r.category = 'tournament')
               OR (d.round_category = 'practice'   AND r.category IN ('training','practice')))
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_revoked FROM bad;

  -- Backfill "earned with" context on surviving grants that predate 057.
  -- (Correlated subquery in SET — a LATERAL in FROM may not reference the
  --  UPDATE target, which made the first cut of this function fail at runtime.)
  UPDATE achievement.user_achievements ua
  SET context = COALESCE(ua.context, '{}'::jsonb) || (
    SELECT jsonb_build_object(
      'submission_id', s.id,
      'total_score',   s.total_score,
      'date',          s.date,
      'venue',         s.venue,
      'round_name',    r.name)
    FROM scoring.score_submissions s
    LEFT JOIN scoring.rounds r ON r.id = s.round_id
    WHERE s.archer_id = ua.profile_id
      AND s.status = 'admin_approved'
      AND s.total_score >= d.threshold
      AND (d.max_score      IS NULL OR s.max_score = d.max_score)
      AND (d.distance_m     IS NULL OR r.distance_m = d.distance_m)
      AND (d.round_category IS NULL
           OR (d.round_category = 'tournament' AND r.category = 'tournament')
           OR (d.round_category = 'practice'   AND r.category IN ('training','practice')))
    ORDER BY s.total_score DESC, s.date ASC
    LIMIT 1
  )
  FROM achievement.achievement_definitions d
  WHERE d.id = ua.achievement_id
    AND d.category = 'score' AND d.threshold IS NOT NULL
    AND NOT (COALESCE(ua.context, '{}'::jsonb) ? 'submission_id')
    -- only rows where a qualifying submission exists (survivors of the revoke
    -- step always have one, but be explicit so context never becomes NULL)
    AND EXISTS (
      SELECT 1
      FROM scoring.score_submissions s
      LEFT JOIN scoring.rounds r ON r.id = s.round_id
      WHERE s.archer_id = ua.profile_id
        AND s.status = 'admin_approved'
        AND s.total_score >= d.threshold
        AND (d.max_score      IS NULL OR s.max_score = d.max_score)
        AND (d.distance_m     IS NULL OR r.distance_m = d.distance_m)
        AND (d.round_category IS NULL
             OR (d.round_category = 'tournament' AND r.category = 'tournament')
             OR (d.round_category = 'practice'   AND r.category IN ('training','practice')))
    );

  -- Re-grant anything now qualifying (also writes context for new grants).
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
