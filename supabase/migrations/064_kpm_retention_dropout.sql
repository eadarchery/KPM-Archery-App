-- ============================================================
-- Migration 064: KPM Retention & Dropout — trusted, period-based
--                archer retention reporting (extends 061/062).
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE only). Run AFTER 061 & 062.
--       Additive only — nothing renamed, dropped, or altered on tables.
--
-- WHY: KPM must know whether archers keep training or register once and
-- vanish. There was no trusted retention aggregate. These SECURITY
-- INVOKER functions provide it.
--
-- DEFINITIONS:
--   • Registered archer = archer profile (created_at <= reporting endDate).
--   • ACTIVITY = a score submission OR a training log. Training counts even
--     with no score. Activity uses ALL score statuses (verifiedOnly is a
--     PERFORMANCE filter, never applied here) unless the caller sets an
--     explicit scoreStatus. Training is never hidden.
--   • Active (current)  = any activity in [startDate, endDate].
--   • Active (previous) = any activity in the equal-length window before it.
--   • Retained = still engaged (not inactive past the threshold).
--   • Dropout / inactive = no activity for >= threshold days. Never-active
--     archers count their tenure since registration, so a brand-new archer
--     is NOT flagged as dropped before enough time has passed (rule 4).
--   • Cohort = registration month.
--
-- REUSE: activity comes from kpm_filtered_scores / kpm_filtered_training
-- (061/062) with the startDate key stripped, so full history up to endDate
-- is visible (needed for previous-period + last-activity math) while scope,
-- demographic and score/session filters stay intact. Scope always flows
-- from kpm_scoped_archers — no duplicate scope logic, no new policy.
--
-- FILTER PAYLOAD (shared jsonb ReportFilters): startDate, endDate, stateId,
--   pldId, schoolId, coachId, archerId, ageGroup (U12/U15/U18/Open), gender,
--   bowCategory, sessionType, roundCategory, scoreStatus. If startDate is
--   omitted (e.g. preset 'all'), the current period defaults to the last 90d.
-- ============================================================


-- ─── PER-ARCHER ACTIVITY WINDOWS (base building block) ─────────
-- One row per scoped archer (registered on/before endDate) with first/last
-- activity, current/previous-period activity flags, and days since last
-- activity (or since registration if never active).
CREATE OR REPLACE FUNCTION public.kpm_archer_activity_windows(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  archer_id uuid,
  state_id uuid, pld_id uuid, school_id uuid, coach_id uuid,
  gender text, bow_category text, age_group text,
  registered_at date, registered_month date,
  first_activity date, last_activity date,
  active_current boolean, active_previous boolean,
  effective_inactive_days int, tenure_days int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      v_end, v_start,
      (v_end - v_start)               AS period_len,
      (v_start - (v_end - v_start))   AS v_prev_start
    FROM (
      SELECT ve AS v_end, COALESCE(vs, ve - 90) AS v_start
      FROM (
        SELECT
          COALESCE(NULLIF(left(NULLIF(p_filters->>'endDate',''), 10), '')::date, CURRENT_DATE) AS ve,
          NULLIF(left(NULLIF(p_filters->>'startDate',''), 10), '')::date AS vs
      ) a
    ) b
  ),
  sa AS (SELECT * FROM public.kpm_scoped_archers(p_filters)),
  acts AS (   -- all activity up to endDate (startDate stripped), scope/score/session filters kept
    SELECT archer_id, date FROM public.kpm_filtered_scores(p_filters - 'startDate')
    UNION ALL
    SELECT archer_id, date FROM public.kpm_filtered_training(p_filters - 'startDate')
  ),
  agg AS (
    SELECT
      a.archer_id,
      min(a.date) AS first_activity,
      max(a.date) AS last_activity,
      bool_or(a.date >= pr.v_start      AND a.date <= pr.v_end)   AS active_current,
      bool_or(a.date >= pr.v_prev_start AND a.date <  pr.v_start) AS active_previous
    FROM acts a CROSS JOIN params pr
    GROUP BY a.archer_id
  )
  SELECT
    sa.id,
    sa.state_id, sa.pld_id, sa.school_id, sa.coach_id,
    sa.gender, sa.bow_category, sa.age_group,
    sa.created_at::date,
    date_trunc('month', sa.created_at)::date,
    ag.first_activity, ag.last_activity,
    COALESCE(ag.active_current, false),
    COALESCE(ag.active_previous, false),
    CASE WHEN ag.last_activity IS NULL
         THEN GREATEST(pr.v_end - sa.created_at::date, 0)
         ELSE GREATEST(pr.v_end - ag.last_activity, 0) END,
    GREATEST(pr.v_end - sa.created_at::date, 0)
  FROM sa
  CROSS JOIN params pr
  LEFT JOIN agg ag ON ag.archer_id = sa.id
  WHERE sa.created_at::date <= pr.v_end;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_archer_activity_windows(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_archer_activity_windows(jsonb) TO authenticated;


-- ─── RETENTION SUMMARY (single row) ────────────────────────────
-- Period-over-period retention + inactivity buckets. Inactive_N counts
-- archers with >= N days since last activity (or since registration if
-- never active), so newly-registered archers are never over-counted.
CREATE OR REPLACE FUNCTION public.kpm_retention_summary(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  registered_archers int, active_current int, active_previous int,
  returning_active int, new_active int, retained int, dropout int,
  retention_rate numeric, dropout_rate numeric,
  inactive_30 int, inactive_60 int, inactive_90 int, inactive_180 int, inactive_365 int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH aw AS (SELECT * FROM public.kpm_archer_activity_windows(p_filters))
  SELECT
    count(*)::int,
    (count(*) FILTER (WHERE active_current))::int,
    (count(*) FILTER (WHERE active_previous))::int,
    (count(*) FILTER (WHERE active_current AND active_previous))::int,
    (count(*) FILTER (WHERE active_current AND NOT active_previous))::int,
    (count(*) FILTER (WHERE active_current AND active_previous))::int,
    (count(*) FILTER (WHERE active_previous AND NOT active_current))::int,
    round(100.0 * count(*) FILTER (WHERE active_previous AND active_current)
          / NULLIF(count(*) FILTER (WHERE active_previous), 0), 1),
    round(100.0 * count(*) FILTER (WHERE active_previous AND NOT active_current)
          / NULLIF(count(*) FILTER (WHERE active_previous), 0), 1),
    (count(*) FILTER (WHERE effective_inactive_days >= 30))::int,
    (count(*) FILTER (WHERE effective_inactive_days >= 60))::int,
    (count(*) FILTER (WHERE effective_inactive_days >= 90))::int,
    (count(*) FILTER (WHERE effective_inactive_days >= 180))::int,
    (count(*) FILTER (WHERE effective_inactive_days >= 365))::int
  FROM aw;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_retention_summary(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_retention_summary(jsonb) TO authenticated;


-- ─── RETENTION BREAKDOWN (grouped) ─────────────────────────────
-- p_group_by ∈ state | pld | school | coach | age_group | gender | bow_category
CREATE OR REPLACE FUNCTION public.kpm_retention_breakdown(
  p_group_by text  DEFAULT 'state',
  p_filters  jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  group_key text, group_label text,
  archers int, active_current int, active_previous int,
  retained int, dropout int, retention_rate numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH aw AS (SELECT * FROM public.kpm_archer_activity_windows(p_filters)),
  g AS (
    SELECT
      CASE p_group_by
        WHEN 'state'        THEN aw.state_id::text
        WHEN 'pld'          THEN aw.pld_id::text
        WHEN 'school'       THEN aw.school_id::text
        WHEN 'coach'        THEN aw.coach_id::text
        WHEN 'age_group'    THEN aw.age_group
        WHEN 'gender'       THEN aw.gender
        WHEN 'bow_category' THEN aw.bow_category
      END AS gkey,
      CASE p_group_by
        WHEN 'state'        THEN st.name
        WHEN 'pld'          THEN pl.name
        WHEN 'school'       THEN sc.name
        WHEN 'coach'        THEN cp.name
        WHEN 'age_group'    THEN aw.age_group
        WHEN 'gender'       THEN aw.gender
        WHEN 'bow_category' THEN aw.bow_category
      END AS glabel,
      aw.active_current, aw.active_previous
    FROM aw
    LEFT JOIN org.states   st ON st.id = aw.state_id
    LEFT JOIN org.plds     pl ON pl.id = aw.pld_id
    LEFT JOIN org.schools  sc ON sc.id = aw.school_id
    LEFT JOIN core.profiles cp ON cp.id = aw.coach_id
  )
  SELECT
    gkey,
    COALESCE(glabel, '—'),
    count(*)::int,
    (count(*) FILTER (WHERE active_current))::int,
    (count(*) FILTER (WHERE active_previous))::int,
    (count(*) FILTER (WHERE active_current AND active_previous))::int,
    (count(*) FILTER (WHERE active_previous AND NOT active_current))::int,
    round(100.0 * count(*) FILTER (WHERE active_current AND active_previous)
          / NULLIF(count(*) FILTER (WHERE active_previous), 0), 1)
  FROM g
  GROUP BY gkey, glabel
  ORDER BY count(*) DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_retention_breakdown(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_retention_breakdown(text, jsonb) TO authenticated;


-- ─── COHORT RETENTION (by registration month) ──────────────────
-- retained = NOT dropped (inactive < threshold); dropout = inactive >=
-- threshold; active_count = active in the current window (a stricter,
-- subset signal). retention_rate = retained / cohort_size.
CREATE OR REPLACE FUNCTION public.kpm_cohort_retention(
  p_filters       jsonb DEFAULT '{}'::jsonb,
  p_inactive_days int   DEFAULT 90
)
RETURNS TABLE (
  cohort_month date, cohort_size int, active_count int,
  retained_count int, dropout_count int, retention_rate numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH aw AS (SELECT * FROM public.kpm_archer_activity_windows(p_filters))
  SELECT
    registered_month,
    count(*)::int,
    (count(*) FILTER (WHERE active_current))::int,
    (count(*) FILTER (WHERE effective_inactive_days < p_inactive_days))::int,
    (count(*) FILTER (WHERE effective_inactive_days >= p_inactive_days))::int,
    round(100.0 * count(*) FILTER (WHERE effective_inactive_days < p_inactive_days)
          / NULLIF(count(*), 0), 1)
  FROM aw
  GROUP BY registered_month
  ORDER BY registered_month;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_cohort_retention(jsonb, int) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_cohort_retention(jsonb, int) TO authenticated;


-- ─── INACTIVE ARCHERS (per-archer dropout list) ────────────────
-- Archers inactive for >= p_inactive_days (never-active archers use their
-- tenure since registration), most-inactive first. Never flags archers too
-- new to have reached the threshold.
CREATE OR REPLACE FUNCTION public.kpm_inactive_archers(
  p_filters       jsonb DEFAULT '{}'::jsonb,
  p_inactive_days int   DEFAULT 90
)
RETURNS TABLE (
  archer_id uuid, archer_name text, archer_code text,
  state text, pld text, school text,
  age_group text, gender text,
  registered_at date, last_activity date, days_inactive int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH aw AS (SELECT * FROM public.kpm_archer_activity_windows(p_filters))
  SELECT
    aw.archer_id, p.name, p.archer_id,
    st.name, pl.name, sc.name,
    aw.age_group, aw.gender,
    aw.registered_at, aw.last_activity, aw.effective_inactive_days
  FROM aw
  JOIN core.profiles p ON p.id = aw.archer_id
  LEFT JOIN org.states  st ON st.id = aw.state_id
  LEFT JOIN org.plds    pl ON pl.id = aw.pld_id
  LEFT JOIN org.schools sc ON sc.id = aw.school_id
  WHERE aw.effective_inactive_days >= p_inactive_days
  ORDER BY aw.effective_inactive_days DESC, p.name;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_inactive_archers(jsonb, int) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_inactive_archers(jsonb, int) TO authenticated;


-- ─── NOTES / DATA LIMITATIONS ──────────────────────────────────
--  • Cohort tracking horizon = endDate − cohort month; older cohorts have
--    had longer to churn. The inactivity threshold is a PARAMETER
--    (p_inactive_days, default 90) — no fixed KPM dropout number invented.
--  • "3-year / 5-year" cohorts appear automatically once that much history
--    exists; nothing is hardcoded.
--  • active-previous requires the window to have a defined length; with
--    preset 'all' (no startDate) the current period defaults to 90 days.
--  • No UI wired; typed service in src/services/kpmMetrics.ts.
