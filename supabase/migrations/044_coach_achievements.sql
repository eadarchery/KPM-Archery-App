-- ============================================================
-- Migration 044: Coach achievements
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- Coaches now earn badges from their students' progress:
--   • coach_students_N            → N active linked students
--   • coach_student_badges_N      → students earned N badges in total
--   • coach_student_score_badges_N→ students earned N SCORE badges
-- The metric is derived from the slug prefix, thresholds from the definition
-- row — so more tiers can be added purely from the Achievement Manager by
-- following the slug naming.
--
-- Auto-granted when: a linked student earns any badge, or a coach-archer link
-- becomes active.
-- ============================================================

-- Migration 005 originally constrained achievement categories to
-- score/practice/tournament. Widen it before inserting coaching definitions;
-- without this repair, a clean application of 044 aborts before creating the
-- grant function and triggers below.
ALTER TABLE achievement.achievement_definitions
  DROP CONSTRAINT IF EXISTS achievement_definitions_category_check;
ALTER TABLE achievement.achievement_definitions
  ADD CONSTRAINT achievement_definitions_category_check
  CHECK (category IN ('score','practice','tournament','coaching'));

-- ─── 1. Seed coaching definitions ───────────────────────────────

INSERT INTO achievement.achievement_definitions
  (slug, name, description, category, threshold, icon, active)
VALUES
  ('coach_students_1',             'First Student',       'Your first archer linked to your coaching account.',              'coaching', 1,  '🎯', true),
  ('coach_students_10',            'Squad Builder',       '10 archers actively linked to your coaching account.',            'coaching', 10, '👥', true),
  ('coach_student_badges_1',       'First Student Badge', 'A student of yours earned their first achievement.',              'coaching', 1,  '🌟', true),
  ('coach_student_badges_10',      'Badge Mentor',        'Your students have earned 10 achievements in total.',             'coaching', 10, '🏅', true),
  ('coach_student_badges_50',      'Badge Factory',       'Your students have earned 50 achievements in total.',             'coaching', 50, '🏆', true),
  ('coach_student_score_badges_1', 'Score Starter',       'A student of yours earned a score achievement.',                  'coaching', 1,  '📈', true),
  ('coach_student_score_badges_10','Score Machine',       'Your students have earned 10 score achievements.',                'coaching', 10, '🚀', true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  category = EXCLUDED.category, threshold = EXCLUDED.threshold;

-- ─── 2. Grant function ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_and_grant_coach_achievements(p_coach_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_students     bigint;
  v_badges       bigint;
  v_score_badges bigint;
  d              RECORD;
  v_metric       bigint;
BEGIN
  SELECT count(*) INTO v_students
  FROM coaching.coach_archer_links
  WHERE coach_id = p_coach_id AND status = 'active';

  SELECT
    count(*) FILTER (WHERE true),
    count(*) FILTER (WHERE ad.category = 'score')
  INTO v_badges, v_score_badges
  FROM achievement.user_achievements ua
  JOIN achievement.achievement_definitions ad ON ad.id = ua.achievement_id
  WHERE ua.profile_id IN (
    SELECT archer_id FROM coaching.coach_archer_links
    WHERE coach_id = p_coach_id AND status = 'active'
  );

  FOR d IN
    SELECT id, slug, threshold FROM achievement.achievement_definitions
    WHERE category = 'coaching' AND active = true AND threshold IS NOT NULL
  LOOP
    v_metric := CASE
      WHEN d.slug LIKE 'coach_student_score_badges%' THEN v_score_badges
      WHEN d.slug LIKE 'coach_student_badges%'       THEN v_badges
      WHEN d.slug LIKE 'coach_students%'             THEN v_students
      ELSE NULL
    END;
    IF v_metric IS NOT NULL AND v_metric >= d.threshold THEN
      INSERT INTO achievement.user_achievements (profile_id, achievement_id, context)
      VALUES (p_coach_id, d.id, jsonb_build_object('students', v_students, 'student_badges', v_badges, 'student_score_badges', v_score_badges))
      ON CONFLICT (profile_id, achievement_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- ─── 3. Triggers ─────────────────────────────────────────────────

-- A linked student earned a badge → re-check their active coaches.
-- (Coaches earning coaching badges re-fires this; they have no coach links,
-- so it no-ops immediately.)
CREATE OR REPLACE FUNCTION public.trigger_coach_achievement_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_coach uuid;
BEGIN
  FOR v_coach IN
    SELECT coach_id FROM coaching.coach_archer_links
    WHERE archer_id = NEW.profile_id AND status = 'active'
  LOOP
    PERFORM public.check_and_grant_coach_achievements(v_coach);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coach_achievement_check ON achievement.user_achievements;
CREATE TRIGGER coach_achievement_check
  AFTER INSERT ON achievement.user_achievements
  FOR EACH ROW EXECUTE FUNCTION public.trigger_coach_achievement_check();

-- A link became active → re-check that coach (student-count badges).
CREATE OR REPLACE FUNCTION public.trigger_coach_link_achievement_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'active' THEN
    PERFORM public.check_and_grant_coach_achievements(NEW.coach_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coach_link_achievement_check ON coaching.coach_archer_links;
CREATE TRIGGER coach_link_achievement_check
  AFTER INSERT OR UPDATE OF status ON coaching.coach_archer_links
  FOR EACH ROW EXECUTE FUNCTION public.trigger_coach_link_achievement_check();

-- ─── 4. Backfill: run once for every coach with active links ────
DO $$
DECLARE v uuid;
BEGIN
  FOR v IN SELECT DISTINCT coach_id FROM coaching.coach_archer_links WHERE status = 'active'
  LOOP
    PERFORM public.check_and_grant_coach_achievements(v);
  END LOOP;
END $$;
