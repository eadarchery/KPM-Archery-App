-- ============================================================
-- Migration 061: KPM Development Metrics — period-based, fully
--                filterable report RPCs (extends migration 025).
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE only). Safe to re-run.
--       Run AFTER 025 and 059. Adds objects only — nothing is
--       renamed, dropped, or altered on existing tables/views.
--
-- WHY: migration 025's report_* views are all-time snapshots. KPM
-- (Kementerian Pendidikan Malaysia) program reporting must be
-- PERIOD-BASED and sliceable on every dimension. Views can't take
-- parameters, so this ships a small set of SECURITY INVOKER
-- functions that accept ONE jsonb filter payload (mirroring the
-- frontend ReportFilters object) and return trusted aggregates.
--
-- SECURITY MODEL (identical to the 025 views):
--   • Every function is SECURITY INVOKER. It reads the same base
--     tables the 025 views read (core.profiles, scoring.*, org.*),
--     so each caller only ever aggregates rows their existing RLS
--     already permits:
--       - admin2 / super_admin → national
--       - admin1               → assigned scope only (054 made READ
--                                 scope-limited — inherited for free)
--       - coach / archer       → their own slice (they don't call these)
--   • No SECURITY DEFINER, so nothing can widen an admin1's reach.
--
-- FILTER PAYLOAD KEYS (all optional; camelCase = the TS ReportFilters):
--   startDate, endDate        -- ISO 'YYYY-MM-DD' (endDate defaults to today;
--                                omit startDate for all-time up to endDate)
--   stateId, pldId, schoolId  -- org scope (archer's org unit)
--   coachId                   -- archers with this ACTIVE coach link
--   archerId                  -- a single archer
--   ageGroup                  -- 'U12' | 'U15' | 'U18' | 'Open' (live, calendar-year)
--   bowCategory               -- archer's registered bow
--   gender                    -- 'male' | 'female' | 'other' | 'prefer_not_to_say'
--   roundId                   -- a specific round
--   roundCategory             -- 'training' | 'practice' | 'tournament' | 'selection'
--   distanceM                 -- exact round distance in metres
--   scoreStatus               -- HARD filter: only this submission status
--   verifiedOnly              -- SOFT (default TRUE): performance metrics
--                                (avg/best/active) count admin_approved only,
--                                without hiding the validation funnel rows.
--
-- DESIGN NOTE — archer-centric grouping: age group, bow category and
-- gender are ARCHER attributes (from the profile), so a "bow category"
-- breakdown groups by the archer's registered bow, consistent with the
-- gender/age demographic splits. Round category / distance / round are
-- SCORE attributes and group by the submission's round. Both live in the
-- same enriched row set below so all three RPCs stay consistent.
-- ============================================================


-- ─── PREREQUISITE: core.profiles.birth_year ────────────────────
-- 061's age logic reads core.profiles.birth_year (normally added by migration
-- 059). If 059 has not been applied yet, provision the column here so this
-- migration can run standalone — a LANGUAGE sql function fails to CREATE if a
-- column it references is missing. This is IDEMPOTENT and does NOT replace 059:
-- a later 059 run (ADD COLUMN IF NOT EXISTS + backfill) is a harmless no-op, and
-- 059 (leaderboard age system) + 060 (audit meta fix) should still be applied.
ALTER TABLE core.profiles ADD COLUMN IF NOT EXISTS birth_year int;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'core_profiles_birth_year_check') THEN
    ALTER TABLE core.profiles ADD CONSTRAINT core_profiles_birth_year_check
      CHECK (birth_year IS NULL OR (birth_year BETWEEN 1900 AND 2100));
  END IF;
END $$;

-- Backfill: prefer date_of_birth, else derive from the legacy age column.
UPDATE core.profiles
   SET birth_year = EXTRACT(YEAR FROM date_of_birth)::int
 WHERE birth_year IS NULL AND date_of_birth IS NOT NULL;
UPDATE core.profiles
   SET birth_year = EXTRACT(YEAR FROM CURRENT_DATE)::int - age
 WHERE birth_year IS NULL AND age IS NOT NULL AND age BETWEEN 1 AND 120;

-- Expose birth_year through the PostgREST passthrough view (parity with 059;
-- CREATE OR REPLACE appends the new column, harmless if already present).
CREATE OR REPLACE VIEW public.profiles WITH (security_invoker = true) AS
SELECT * FROM core.profiles;


-- ─── CANONICAL AGE-GROUP HELPER ────────────────────────────────
-- Single source of truth for calendar-year (competition) age bands,
-- matching the leaderboard (059) EXACTLY: U12 ≤12, U15 ≤15, U18 ≤18,
-- else Open. Reused by every KPM RPC so the taxonomy can never drift.
CREATE OR REPLACE FUNCTION core.kpm_age_group(p_birth_year int, p_on_year int DEFAULT NULL)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_birth_year IS NULL THEN NULL
    WHEN (COALESCE(p_on_year, EXTRACT(YEAR FROM CURRENT_DATE)::int) - p_birth_year) <= 12 THEN 'U12'
    WHEN (COALESCE(p_on_year, EXTRACT(YEAR FROM CURRENT_DATE)::int) - p_birth_year) <= 15 THEN 'U15'
    WHEN (COALESCE(p_on_year, EXTRACT(YEAR FROM CURRENT_DATE)::int) - p_birth_year) <= 18 THEN 'U18'
    ELSE 'Open'
  END;
$$;
REVOKE EXECUTE ON FUNCTION core.kpm_age_group(int, int) FROM public;
GRANT  EXECUTE ON FUNCTION core.kpm_age_group(int, int) TO authenticated;


-- ─── SCOPED ARCHER POPULATION ──────────────────────────────────
-- Archers matching the scope + demographic filters (no date/score
-- filters). This is the "who is in this cohort" set that headcount,
-- gender and new-registration metrics are built on. birth_year is
-- resolved the same way the leaderboard resolves it.
CREATE OR REPLACE FUNCTION public.kpm_scoped_archers(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  id uuid, state_id uuid, pld_id uuid, school_id uuid,
  coach_id uuid, bow_category text, gender text,
  birth_year int, age_group text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    p.id, p.state_id, p.pld_id, p.school_id,
    ac.coach_id,
    p.bow_category::text,
    p.gender,
    rby.birth_year,
    core.kpm_age_group(rby.birth_year) AS age_group,
    p.created_at
  FROM core.profiles p
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      p.birth_year,
      EXTRACT(YEAR FROM p.date_of_birth)::int,
      CASE WHEN p.age IS NOT NULL THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - p.age END
    ) AS birth_year
  ) rby
  LEFT JOIN LATERAL (
    SELECT cal.coach_id
    FROM coaching.coach_archer_links cal
    WHERE cal.archer_id = p.id AND cal.status = 'active'
    ORDER BY cal.approved_at DESC NULLS LAST
    LIMIT 1
  ) ac ON true
  WHERE p.role = 'archer'
    AND (NULLIF(p_filters->>'stateId','')     IS NULL OR p.state_id  = (p_filters->>'stateId')::uuid)
    AND (NULLIF(p_filters->>'pldId','')       IS NULL OR p.pld_id    = (p_filters->>'pldId')::uuid)
    AND (NULLIF(p_filters->>'schoolId','')    IS NULL OR p.school_id = (p_filters->>'schoolId')::uuid)
    AND (NULLIF(p_filters->>'archerId','')    IS NULL OR p.id        = (p_filters->>'archerId')::uuid)
    AND (NULLIF(p_filters->>'bowCategory','') IS NULL OR p.bow_category::text = p_filters->>'bowCategory')
    AND (NULLIF(p_filters->>'gender','')      IS NULL OR p.gender    = p_filters->>'gender')
    AND (NULLIF(p_filters->>'ageGroup','')    IS NULL OR core.kpm_age_group(rby.birth_year) = p_filters->>'ageGroup')
    AND (NULLIF(p_filters->>'coachId','')     IS NULL OR ac.coach_id = (p_filters->>'coachId')::uuid);
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_scoped_archers(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_scoped_archers(jsonb) TO authenticated;


-- ─── FILTERED + ENRICHED SCORE ROWS ────────────────────────────
-- One row per score submission belonging to a scoped archer, inside
-- the date window and matching the round/status filters. Carries the
-- org + demographic labels so the breakdown RPC can group on any
-- dimension without re-joining. status is returned (NOT collapsed) so
-- callers can compute the full validation funnel.
CREATE OR REPLACE FUNCTION public.kpm_filtered_scores(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  score_id uuid, archer_id uuid, archer_name text, archer_code text,
  state_id uuid, state text, pld_id uuid, pld text, school_id uuid, school text,
  coach_id uuid, coach_name text,
  bow_category text, gender text, age_group text,
  round_id uuid, round_name text, round_category text, distance_m int,
  status text, total_score int, max_score int, score_pct numeric, date date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    s.id, s.archer_id, p.name, p.archer_id,
    sa.state_id, st.name, sa.pld_id, pl.name, sa.school_id, sc.name,
    sa.coach_id, cp.name,
    sa.bow_category, sa.gender, sa.age_group,
    s.round_id, r.name, r.category, r.distance_m,
    s.status, s.total_score, s.max_score,
    CASE WHEN s.max_score > 0
         THEN round((s.total_score::numeric / s.max_score) * 100, 1) END,
    s.date
  FROM public.kpm_scoped_archers(p_filters) sa
  JOIN core.profiles            p  ON p.id = sa.id
  JOIN scoring.score_submissions s  ON s.archer_id = sa.id
  JOIN scoring.rounds           r  ON r.id = s.round_id
  LEFT JOIN org.states   st ON st.id = sa.state_id
  LEFT JOIN org.plds     pl ON pl.id = sa.pld_id
  LEFT JOIN org.schools  sc ON sc.id = sa.school_id
  LEFT JOIN core.profiles cp ON cp.id = sa.coach_id
  WHERE (NULLIF(p_filters->>'startDate','') IS NULL
         OR s.date >= (left(p_filters->>'startDate', 10))::date)
    AND s.date <= COALESCE((left(NULLIF(p_filters->>'endDate',''), 10))::date, CURRENT_DATE)
    AND (NULLIF(p_filters->>'roundId','')       IS NULL OR s.round_id   = (p_filters->>'roundId')::uuid)
    AND (NULLIF(p_filters->>'roundCategory','') IS NULL OR r.category   = p_filters->>'roundCategory')
    AND (NULLIF(p_filters->>'distanceM','')     IS NULL OR r.distance_m = (p_filters->>'distanceM')::int)
    AND (NULLIF(p_filters->>'scoreStatus','')   IS NULL OR s.status     = p_filters->>'scoreStatus');
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_filtered_scores(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_filtered_scores(jsonb) TO authenticated;


-- ─── SUMMARY (single-row KPI card) ─────────────────────────────
-- Period-based headline metrics for the filtered scope. Population
-- counts are as-of endDate; activity/performance are within the window.
CREATE OR REPLACE FUNCTION public.kpm_report_summary(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  registered_archers int, new_registrations int, active_archers int,
  male int, female int, gender_other int, gender_unspecified int,
  coaches int, schools_total int, schools_reporting int,
  scores_submitted int, scores_coach_approved int, scores_admin_approved int,
  scores_pending int, scores_rejected int,
  avg_score_pct numeric, best_score_pct numeric,
  training_sessions bigint, arrows_shot bigint,
  achievements_earned bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_start  date := NULLIF(left(NULLIF(p_filters->>'startDate',''), 10), '')::date;
  v_end    date := COALESCE(NULLIF(left(NULLIF(p_filters->>'endDate',''), 10), '')::date, CURRENT_DATE);
  v_state  uuid := NULLIF(p_filters->>'stateId','')::uuid;
  v_pld    uuid := NULLIF(p_filters->>'pldId','')::uuid;
  v_school uuid := NULLIF(p_filters->>'schoolId','')::uuid;
  v_coach  uuid := NULLIF(p_filters->>'coachId','')::uuid;
  -- Performance status: a hard scoreStatus wins; else verifiedOnly (default
  -- TRUE) means admin_approved only; else NULL = every status counts.
  v_perf   text := COALESCE(
    NULLIF(p_filters->>'scoreStatus',''),
    CASE WHEN COALESCE((p_filters->>'verifiedOnly')::boolean, true)
         THEN 'admin_approved' ELSE NULL END
  );
BEGIN
  RETURN QUERY
  WITH pop AS (SELECT * FROM public.kpm_scoped_archers(p_filters)),
       fs  AS (SELECT * FROM public.kpm_filtered_scores(p_filters))
  SELECT
    (SELECT count(*)::int FROM pop WHERE created_at::date <= v_end),
    (SELECT count(*)::int FROM pop WHERE created_at::date <= v_end
        AND (v_start IS NULL OR created_at::date >= v_start)),
    (SELECT count(DISTINCT archer_id)::int FROM fs WHERE v_perf IS NULL OR status = v_perf),
    (SELECT count(*)::int FROM pop WHERE created_at::date <= v_end AND gender = 'male'),
    (SELECT count(*)::int FROM pop WHERE created_at::date <= v_end AND gender = 'female'),
    (SELECT count(*)::int FROM pop WHERE created_at::date <= v_end AND gender IN ('other','prefer_not_to_say')),
    (SELECT count(*)::int FROM pop WHERE created_at::date <= v_end AND gender IS NULL),
    (SELECT count(*)::int FROM core.profiles cp
        WHERE cp.role = 'coach' AND cp.created_at::date <= v_end
          AND (v_state  IS NULL OR cp.state_id  = v_state)
          AND (v_pld    IS NULL OR cp.pld_id    = v_pld)
          AND (v_school IS NULL OR cp.school_id = v_school)
          AND (v_coach  IS NULL OR cp.id        = v_coach)),
    (SELECT count(*)::int FROM org.schools sch
        WHERE sch.active
          AND (v_state  IS NULL OR sch.state_id = v_state)
          AND (v_pld    IS NULL OR sch.pld_id   = v_pld)
          AND (v_school IS NULL OR sch.id       = v_school)),
    (SELECT count(DISTINCT school_id)::int FROM fs
        WHERE (v_perf IS NULL OR status = v_perf) AND school_id IS NOT NULL),
    (SELECT count(*)::int FROM fs),
    (SELECT count(*)::int FROM fs WHERE status = 'coach_approved'),
    (SELECT count(*)::int FROM fs WHERE status = 'admin_approved'),
    (SELECT count(*)::int FROM fs WHERE status = 'pending'),
    (SELECT count(*)::int FROM fs WHERE status = 'rejected'),
    (SELECT round(avg(score_pct), 1) FROM fs
        WHERE (v_perf IS NULL OR status = v_perf) AND score_pct IS NOT NULL),
    (SELECT max(score_pct) FROM fs WHERE v_perf IS NULL OR status = v_perf),
    (SELECT count(*) FROM scoring.training_logs tl
        JOIN pop ON pop.id = tl.archer_id
        WHERE tl.date <= v_end AND (v_start IS NULL OR tl.date >= v_start)),
    (SELECT COALESCE(sum(tl.arrows_shot), 0) FROM scoring.training_logs tl
        JOIN pop ON pop.id = tl.archer_id
        WHERE tl.date <= v_end AND (v_start IS NULL OR tl.date >= v_start)),
    (SELECT count(*) FROM achievement.user_achievements ua
        JOIN pop ON pop.id = ua.profile_id
        WHERE ua.earned_at::date <= v_end AND (v_start IS NULL OR ua.earned_at::date >= v_start));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_report_summary(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_report_summary(jsonb) TO authenticated;


-- ─── BREAKDOWN (grouped rows on any dimension) ─────────────────
-- p_group_by ∈ state | pld | school | coach | age_group | bow_category
--              | gender | round | round_category | distance
-- Uniform, score-derived metrics per group. avg/best honour the same
-- verifiedOnly/scoreStatus performance rule as the summary.
CREATE OR REPLACE FUNCTION public.kpm_report_breakdown(
  p_group_by text DEFAULT 'state',
  p_filters  jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  group_key text, group_label text,
  archers int,
  scores_submitted int, scores_admin_approved int, scores_pending int, scores_rejected int,
  avg_score_pct numeric, best_score_pct numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_perf text := COALESCE(
    NULLIF(p_filters->>'scoreStatus',''),
    CASE WHEN COALESCE((p_filters->>'verifiedOnly')::boolean, true)
         THEN 'admin_approved' ELSE NULL END
  );
BEGIN
  RETURN QUERY
  WITH fs AS (SELECT * FROM public.kpm_filtered_scores(p_filters)),
  g AS (
    SELECT
      CASE p_group_by
        WHEN 'state'          THEN fs.state_id::text
        WHEN 'pld'            THEN fs.pld_id::text
        WHEN 'school'         THEN fs.school_id::text
        WHEN 'coach'          THEN fs.coach_id::text
        WHEN 'age_group'      THEN fs.age_group
        WHEN 'bow_category'   THEN fs.bow_category
        WHEN 'gender'         THEN fs.gender
        WHEN 'round'          THEN fs.round_id::text
        WHEN 'round_category' THEN fs.round_category
        WHEN 'distance'       THEN fs.distance_m::text
      END AS gkey,
      CASE p_group_by
        WHEN 'state'          THEN fs.state
        WHEN 'pld'            THEN fs.pld
        WHEN 'school'         THEN fs.school
        WHEN 'coach'          THEN fs.coach_name
        WHEN 'age_group'      THEN fs.age_group
        WHEN 'bow_category'   THEN fs.bow_category
        WHEN 'gender'         THEN fs.gender
        WHEN 'round'          THEN fs.round_name
        WHEN 'round_category' THEN fs.round_category
        WHEN 'distance'       THEN fs.distance_m::text
      END AS glabel,
      fs.archer_id, fs.status, fs.score_pct
    FROM fs
  )
  SELECT
    g.gkey,
    COALESCE(g.glabel, '—'),
    count(DISTINCT g.archer_id)::int,
    count(*)::int,
    (count(*) FILTER (WHERE g.status = 'admin_approved'))::int,
    (count(*) FILTER (WHERE g.status = 'pending'))::int,
    (count(*) FILTER (WHERE g.status = 'rejected'))::int,
    round(avg(g.score_pct) FILTER (WHERE (v_perf IS NULL OR g.status = v_perf) AND g.score_pct IS NOT NULL), 1),
    max(g.score_pct) FILTER (WHERE v_perf IS NULL OR g.status = v_perf)
  FROM g
  GROUP BY g.gkey, g.glabel
  ORDER BY (count(*) FILTER (WHERE g.status = 'admin_approved')) DESC, count(*) DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_report_breakdown(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_report_breakdown(text, jsonb) TO authenticated;


-- ─── TREND (time-bucketed activity) ────────────────────────────
-- Submitted vs validated over the window, bucketed by day/week/month.
CREATE OR REPLACE FUNCTION public.kpm_score_trend(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_bucket  text  DEFAULT 'day'
)
RETURNS TABLE (
  bucket date, submitted int, admin_approved int, pending int, rejected int, avg_approved_pct numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    date_trunc(CASE WHEN p_bucket IN ('day','week','month') THEN p_bucket ELSE 'day' END,
               s.date::timestamp)::date AS bucket,
    count(*)::int,
    (count(*) FILTER (WHERE s.status = 'admin_approved'))::int,
    (count(*) FILTER (WHERE s.status IN ('pending','coach_approved')))::int,
    (count(*) FILTER (WHERE s.status = 'rejected'))::int,
    round(avg(s.score_pct) FILTER (WHERE s.status = 'admin_approved'), 1)
  FROM public.kpm_filtered_scores(p_filters) s
  GROUP BY 1
  ORDER BY 1;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_score_trend(jsonb, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_score_trend(jsonb, text) TO authenticated;


-- ─── NOTES ─────────────────────────────────────────────────────
--  • These functions never widen access: SECURITY INVOKER + existing
--    RLS mean an admin1 gets exactly their assigned scope and an admin2
--    gets national, with no new policy. Coaches/archers don't call them.
--  • verifiedOnly defaults TRUE, so out of the box avg/best/active count
--    only admin_approved scores (migration 025's trust rule), while the
--    funnel columns (submitted/pending/rejected) still show real numbers.
--  • Age group is LIVE (recomputed from birth_year each call) like the
--    leaderboard — squads roll up automatically on 1 January.
--  • No UI is wired here; the typed service (src/services/kpmMetrics.ts)
--    exposes these for a later Fable merge into the report pages.
