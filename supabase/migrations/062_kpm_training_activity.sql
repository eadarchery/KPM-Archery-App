-- ============================================================
-- Migration 062: KPM Training Activity — trusted, period-based
--                training-volume aggregation (extends 061).
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE only). Safe to re-run.
--       Run AFTER 061. Adds objects only — nothing is renamed,
--       dropped, or altered on existing tables/views.
--
-- WHY: scoring.training_logs records every session (arrows_shot,
-- session_type, coach) but there was no OFFICIAL aggregate — only
-- StateReport.tsx summing arrows in the browser, which is not
-- acceptable for KPM reporting. These SECURITY INVOKER functions
-- move that math into the database.
--
-- SCOPE / SECURITY: every function reuses public.kpm_scoped_archers
-- (migration 061) for the archer population, so scope + demographic
-- filters and RLS behave EXACTLY like the score RPCs — admin2
-- national, admin1 assigned-scope (054 scoped core.profiles +
-- training_logs reads), coach/archer own slice. No SECURITY DEFINER,
-- no duplicate scope logic, no new policy.
--
-- FILTER PAYLOAD (same jsonb ReportFilters object as 061) — honoured keys:
--   startDate, endDate, stateId, pldId, schoolId, coachId, archerId,
--   ageGroup (U12/U15/U18/Open, live), gender, bowCategory   → via kpm_scoped_archers
--   sessionType ('indoor'|'outdoor'|'field'|'3d'|'virtual')  → applied here
--
-- COACH NOTE: "coaches involved in training" and the by-coach breakdown use
-- the SESSION coach (training_logs.coach_id — who ran that session), whereas the
-- coachId *filter* narrows the archer population by active coach link (via
-- kpm_scoped_archers), consistent with the score reports.
-- ============================================================


-- ─── FILTERED + ENRICHED TRAINING ROWS ─────────────────────────
-- One row per training session for a scoped archer, inside the date
-- window and matching the sessionType filter. Carries org + demographic
-- labels so the breakdown RPC can group on any dimension without re-joining.
CREATE OR REPLACE FUNCTION public.kpm_filtered_training(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  log_id uuid, archer_id uuid, archer_name text,
  state_id uuid, state text, pld_id uuid, pld text, school_id uuid, school text,
  coach_id uuid, coach_name text,
  bow_category text, gender text, age_group text,
  session_type text, arrows_shot int, date date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    tl.id, tl.archer_id, p.name,
    sa.state_id, st.name, sa.pld_id, pl.name, sa.school_id, sc.name,
    tl.coach_id, cp.name,
    sa.bow_category, sa.gender, sa.age_group,
    tl.session_type, tl.arrows_shot, tl.date
  FROM public.kpm_scoped_archers(p_filters) sa
  JOIN core.profiles         p  ON p.id = sa.id
  JOIN scoring.training_logs tl ON tl.archer_id = sa.id
  LEFT JOIN org.states   st ON st.id = sa.state_id
  LEFT JOIN org.plds     pl ON pl.id = sa.pld_id
  LEFT JOIN org.schools  sc ON sc.id = sa.school_id
  LEFT JOIN core.profiles cp ON cp.id = tl.coach_id
  WHERE (NULLIF(p_filters->>'startDate','') IS NULL
         OR tl.date >= (left(p_filters->>'startDate', 10))::date)
    AND tl.date <= COALESCE((left(NULLIF(p_filters->>'endDate',''), 10))::date, CURRENT_DATE)
    AND (NULLIF(p_filters->>'sessionType','') IS NULL OR tl.session_type = p_filters->>'sessionType');
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_filtered_training(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_filtered_training(jsonb) TO authenticated;


-- ─── SUMMARY (single-row training KPIs) ────────────────────────
CREATE OR REPLACE FUNCTION public.kpm_training_summary(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  total_sessions bigint,
  total_arrows bigint,
  avg_arrows_per_session numeric,
  active_training_archers int,
  active_training_coaches int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    count(*)::bigint,
    COALESCE(sum(arrows_shot), 0)::bigint,
    round(avg(arrows_shot), 1),
    count(DISTINCT archer_id)::int,
    count(DISTINCT coach_id)::int        -- DISTINCT ignores NULL session coaches
  FROM public.kpm_filtered_training(p_filters);
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_training_summary(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_training_summary(jsonb) TO authenticated;


-- ─── TREND (sessions + arrows by day/week/month) ───────────────
-- Defaults to MONTH — the KPM "sessions/arrows by month" view.
CREATE OR REPLACE FUNCTION public.kpm_training_trend(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_bucket  text  DEFAULT 'month'
)
RETURNS TABLE (
  bucket date, sessions int, arrows bigint, archers int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    date_trunc(CASE WHEN p_bucket IN ('day','week','month') THEN p_bucket ELSE 'month' END,
               t.date::timestamp)::date AS bucket,
    count(*)::int,
    COALESCE(sum(t.arrows_shot), 0)::bigint,
    count(DISTINCT t.archer_id)::int
  FROM public.kpm_filtered_training(p_filters) t
  GROUP BY 1
  ORDER BY 1;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_training_trend(jsonb, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_training_trend(jsonb, text) TO authenticated;


-- ─── BREAKDOWN (grouped on any dimension) ──────────────────────
-- p_group_by ∈ state | pld | school | coach | age_group | gender
--              | bow_category | session_type
CREATE OR REPLACE FUNCTION public.kpm_training_breakdown(
  p_group_by text  DEFAULT 'state',
  p_filters  jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  group_key text, group_label text,
  sessions int, arrows bigint, avg_arrows numeric, archers int, coaches int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ft AS (SELECT * FROM public.kpm_filtered_training(p_filters)),
  g AS (
    SELECT
      CASE p_group_by
        WHEN 'state'        THEN ft.state_id::text
        WHEN 'pld'          THEN ft.pld_id::text
        WHEN 'school'       THEN ft.school_id::text
        WHEN 'coach'        THEN ft.coach_id::text
        WHEN 'age_group'    THEN ft.age_group
        WHEN 'gender'       THEN ft.gender
        WHEN 'bow_category' THEN ft.bow_category
        WHEN 'session_type' THEN ft.session_type
      END AS gkey,
      CASE p_group_by
        WHEN 'state'        THEN ft.state
        WHEN 'pld'          THEN ft.pld
        WHEN 'school'       THEN ft.school
        WHEN 'coach'        THEN ft.coach_name
        WHEN 'age_group'    THEN ft.age_group
        WHEN 'gender'       THEN ft.gender
        WHEN 'bow_category' THEN ft.bow_category
        WHEN 'session_type' THEN ft.session_type
      END AS glabel,
      ft.archer_id, ft.coach_id, ft.arrows_shot
    FROM ft
  )
  SELECT
    g.gkey,
    COALESCE(g.glabel, '—'),
    count(*)::int,
    COALESCE(sum(g.arrows_shot), 0)::bigint,
    round(avg(g.arrows_shot), 1),
    count(DISTINCT g.archer_id)::int,
    count(DISTINCT g.coach_id)::int
  FROM g
  GROUP BY g.gkey, g.glabel
  ORDER BY sum(g.arrows_shot) DESC NULLS LAST, count(*) DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_training_breakdown(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_training_breakdown(text, jsonb) TO authenticated;


-- ─── NOTES ─────────────────────────────────────────────────────
--  • Session-type breakdown = kpm_training_breakdown('session_type', …).
--  • Sessions/arrows by month = kpm_training_trend(…, 'month').
--  • These replace the browser-side arrow summation in StateReport.tsx
--    (the sr-training query + arrowsCur/arrowsPrev) — see the service
--    functions in src/services/kpmMetrics.ts (getKpmTrainingActivity /
--    getKpmTrainingTrend / getKpmTrainingBreakdown) for the later merge.
--  • No UI is wired here.
