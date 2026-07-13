-- ============================================================
-- Migration 074: KPM Schools Without Coach — per-school drill-down
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE only). Run AFTER 063.
--       Additive only — nothing renamed, dropped, or altered.
--
-- WHY: the "Schools without coach" card only had a COUNT. This lists the
--      actual schools (name, PLD, state, registered-archer count) that have
--      no approved coach assigned, so admins can pinpoint and fix them.
--
-- DEFINITION (mirrors kpm_coach_coverage_summary, 063): an active school in
--   scope "has a coach" when an APPROVED coach's profile.school_id points to
--   it. Schools with none are returned here, busiest (most archers) first.
--
-- SECURITY INVOKER + existing RLS scope (admin2 national, admin1 assigned).
-- ============================================================

CREATE OR REPLACE FUNCTION public.kpm_schools_without_coach(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  school_id uuid, school text, pld text, state text, registered_archers int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH co AS (SELECT * FROM public.kpm_scoped_coaches(p_filters)),
  covered AS (
    SELECT DISTINCT school_id FROM co WHERE status = 'approved' AND school_id IS NOT NULL
  ),
  sch AS (
    SELECT id, name, state_id, pld_id
    FROM org.schools
    WHERE active
      AND (NULLIF(p_filters->>'stateId','')  IS NULL OR state_id = (p_filters->>'stateId')::uuid)
      AND (NULLIF(p_filters->>'pldId','')    IS NULL OR pld_id   = (p_filters->>'pldId')::uuid)
      AND (NULLIF(p_filters->>'schoolId','') IS NULL OR id       = (p_filters->>'schoolId')::uuid)
  ),
  arch AS (
    SELECT school_id, count(*)::int AS n
    FROM core.profiles
    WHERE role = 'archer' AND school_id IS NOT NULL
    GROUP BY school_id
  )
  SELECT
    s.id, s.name, pl.name, st.name, COALESCE(a.n, 0)
  FROM sch s
  LEFT JOIN org.plds   pl ON pl.id = s.pld_id
  LEFT JOIN org.states st ON st.id = s.state_id
  LEFT JOIN arch a ON a.school_id = s.id
  WHERE s.id NOT IN (SELECT school_id FROM covered)
  ORDER BY COALESCE(a.n, 0) DESC, s.name;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_schools_without_coach(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_schools_without_coach(jsonb) TO authenticated;
