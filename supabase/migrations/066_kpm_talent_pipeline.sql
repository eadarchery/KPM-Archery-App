-- ============================================================
-- Migration 066: KPM Talent Pipeline — trusted, period-based talent
--                identification (extends 061 / 065). Upgrades the
--                Emerging Talents idea into a full pipeline layer.
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE only). Run AFTER 061 & 065.
--       Additive only — nothing renamed, dropped, or altered on tables.
--
-- ⚠️ DEVELOPMENT BANDS ARE NOT OFFICIAL KPM CLASSIFICATION.
--   The score bands below are INTERNAL development bands for spotting
--   promise. They are NOT KPM qualification standards and MUST be labelled
--   as "development bands" wherever shown. No official KPM thresholds or
--   target scores are invented here.
--     Beginner      <50%
--     Developing     50–<65%
--     Intermediate   65–<75%
--     Advanced       75–<85%
--     Talent Pool   >=85%
--
-- SECURITY: SECURITY INVOKER + existing RLS. Admin2/super_admin → national
-- detail; admin1 → assigned scope only (via kpm_scoped_archers →
-- kpm_filtered_scores). Coaches/archers don't call these. No new policy.
--
-- REUSE: all scores come from kpm_score_normalised_scores (065), so score %,
-- the max_score fallback, verifiedOnly (default true for performance) and
-- every filter behave exactly as elsewhere. Funnel counts are unaffected.
--
-- FILTER PAYLOAD (shared jsonb ReportFilters): startDate, endDate, stateId,
--   pldId, schoolId, coachId, archerId, ageGroup, gender, bowCategory,
--   roundId, roundCategory, distanceM, scoreStatus, verifiedOnly.
-- ============================================================


-- ─── DEVELOPMENT BAND HELPERS ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.kpm_score_band(p_pct numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_pct IS NULL THEN NULL
    WHEN p_pct < 50 THEN 'Beginner'
    WHEN p_pct < 65 THEN 'Developing'
    WHEN p_pct < 75 THEN 'Intermediate'
    WHEN p_pct < 85 THEN 'Advanced'
    ELSE 'Talent Pool'
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_score_band(numeric) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_score_band(numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.kpm_score_band_index(p_pct numeric)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_pct IS NULL THEN NULL
    WHEN p_pct < 50 THEN 0
    WHEN p_pct < 65 THEN 1
    WHEN p_pct < 75 THEN 2
    WHEN p_pct < 85 THEN 3
    ELSE 4
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_score_band_index(numeric) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_score_band_index(numeric) TO authenticated;


-- ─── SCORED ARCHERS (base — metrics, bands, talent reasons) ────
-- One row per scored archer with all talent metrics and a talent_reasons[]
-- array. Reason thresholds are INTERNAL development heuristics (documented),
-- not KPM official standards. Consumers filter/aggregate this.
CREATE OR REPLACE FUNCTION public.kpm_talent_scored(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  archer_id uuid, archer_name text, archer_code text,
  state_id uuid, state text, pld_id uuid, pld text, school_id uuid, school text,
  coach_id uuid, coach_name text,
  age_group text, gender text, bow_category text,
  best_pct numeric, latest_pct numeric, avg_pct numeric, median_pct numeric,
  improvement_pp numeric, consistency_score numeric,
  score_count int, tournament_count int, best_tournament_pct numeric,
  current_band text, previous_band text, band_movement text,
  last_activity date, talent_reasons text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH v AS (
    SELECT COALESCE(NULLIF(p_filters->>'scoreStatus',''),
      CASE WHEN COALESCE((p_filters->>'verifiedOnly')::boolean, true) THEN 'admin_approved' ELSE NULL END) AS perf
  ),
  w AS (
    SELECT
      COALESCE(NULLIF(left(NULLIF(p_filters->>'endDate',''), 10), '')::date, CURRENT_DATE) AS v_end,
      NULLIF(left(NULLIF(p_filters->>'startDate',''), 10), '')::date AS v_start
  ),
  perf AS (
    SELECT ns.* FROM public.kpm_score_normalised_scores(p_filters) ns CROSS JOIN v
    WHERE (v.perf IS NULL OR ns.status = v.perf) AND ns.score_pct IS NOT NULL
  ),
  ach AS (   -- achievements earned in the window (admin2 reads all; admin1 limited — see notes)
    SELECT ua.profile_id AS archer_id, count(*) AS n
    FROM achievement.user_achievements ua CROSS JOIN w
    WHERE ua.earned_at::date <= w.v_end AND (w.v_start IS NULL OR ua.earned_at::date >= w.v_start)
    GROUP BY ua.profile_id
  ),
  school_act AS (SELECT school_id, count(*) AS sc FROM perf WHERE school_id IS NOT NULL GROUP BY school_id),
  school_med AS (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY sc) AS med FROM school_act),
  per_archer AS (
    SELECT
      archer_id, archer_name, archer_code,
      state_id, state, pld_id, pld, school_id, school, coach_id, coach_name,
      age_group, gender, bow_category,
      count(*)::int AS score_count,
      (count(*) FILTER (WHERE round_category = 'tournament'))::int AS tournament_count,
      max(score_pct) AS best_pct,
      max(score_pct) FILTER (WHERE round_category = 'tournament') AS best_tournament_pct,
      round(avg(score_pct), 1) AS avg_pct,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY score_pct))::numeric, 1) AS median_pct,
      CASE WHEN count(*) >= 3
           THEN GREATEST(0::numeric, round(100 - stddev_pop(score_pct)::numeric, 1)) END AS consistency_score,
      (array_agg(score_pct ORDER BY date ASC,  score_id ASC))[1]  AS first_pct,
      (array_agg(score_pct ORDER BY date DESC, score_id DESC))[1] AS latest_pct,
      max(date) AS last_activity
    FROM perf
    GROUP BY archer_id, archer_name, archer_code, state_id, state, pld_id, pld,
             school_id, school, coach_id, coach_name, age_group, gender, bow_category
  )
  SELECT
    pa.archer_id, pa.archer_name, pa.archer_code,
    pa.state_id, pa.state, pa.pld_id, pa.pld, pa.school_id, pa.school, pa.coach_id, pa.coach_name,
    pa.age_group, pa.gender, pa.bow_category,
    pa.best_pct, pa.latest_pct, pa.avg_pct, pa.median_pct,
    round(pa.latest_pct - pa.first_pct, 1) AS improvement_pp,
    pa.consistency_score,
    pa.score_count, pa.tournament_count, pa.best_tournament_pct,
    public.kpm_score_band(pa.best_pct)  AS current_band,
    public.kpm_score_band(pa.first_pct) AS previous_band,
    CASE WHEN public.kpm_score_band_index(pa.best_pct) > public.kpm_score_band_index(pa.first_pct)
         THEN 'up' ELSE 'same' END AS band_movement,
    pa.last_activity,
    array_remove(ARRAY[
      CASE WHEN pa.best_pct >= 85 THEN 'Top Performer' END,
      CASE WHEN (pa.latest_pct - pa.first_pct) >= 5 AND pa.score_count >= 2 THEN 'Fast Improver' END,
      CASE WHEN pa.score_count >= 3 AND pa.consistency_score >= 90 AND pa.avg_pct >= 65 THEN 'Consistent Archer' END,
      CASE WHEN pa.tournament_count >= 1 AND pa.best_tournament_pct >= 75 THEN 'Tournament Ready' END,
      CASE WHEN pa.best_pct >= 75 AND sa2.sc <= sm.med THEN 'Hidden Talent' END,
      CASE WHEN public.kpm_score_band_index(pa.best_pct) > public.kpm_score_band_index(pa.first_pct) THEN 'Band Promotion' END,
      CASE WHEN COALESCE(ach.n, 0) >= 1 THEN 'Achievement Milestone' END
    ]::text[], NULL) AS talent_reasons
  FROM per_archer pa
  CROSS JOIN school_med sm
  LEFT JOIN school_act sa2 ON sa2.school_id = pa.school_id
  LEFT JOIN ach ON ach.archer_id = pa.archer_id;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_talent_scored(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_talent_scored(jsonb) TO authenticated;


-- ─── TALENT CANDIDATES (archers with >=1 reason) ───────────────
CREATE OR REPLACE FUNCTION public.kpm_talent_candidates(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  archer_id uuid, archer_name text, archer_code text,
  state_id uuid, state text, pld_id uuid, pld text, school_id uuid, school text,
  coach_id uuid, coach_name text,
  age_group text, gender text, bow_category text,
  best_pct numeric, latest_pct numeric, avg_pct numeric, median_pct numeric,
  improvement_pp numeric, consistency_score numeric,
  score_count int, tournament_count int, best_tournament_pct numeric,
  current_band text, previous_band text, band_movement text,
  last_activity date, talent_reasons text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public.kpm_talent_scored(p_filters)
  WHERE cardinality(talent_reasons) >= 1
  ORDER BY best_pct DESC NULLS LAST, improvement_pp DESC NULLS LAST;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_talent_candidates(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_talent_candidates(jsonb) TO authenticated;


-- ─── TOURNAMENT-READY CANDIDATES ───────────────────────────────
CREATE OR REPLACE FUNCTION public.kpm_tournament_ready_candidates(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  archer_id uuid, archer_name text, archer_code text,
  state_id uuid, state text, pld_id uuid, pld text, school_id uuid, school text,
  coach_id uuid, coach_name text,
  age_group text, gender text, bow_category text,
  best_pct numeric, latest_pct numeric, avg_pct numeric, median_pct numeric,
  improvement_pp numeric, consistency_score numeric,
  score_count int, tournament_count int, best_tournament_pct numeric,
  current_band text, previous_band text, band_movement text,
  last_activity date, talent_reasons text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public.kpm_talent_scored(p_filters)
  WHERE 'Tournament Ready' = ANY(talent_reasons)
  ORDER BY best_tournament_pct DESC NULLS LAST, best_pct DESC NULLS LAST;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_tournament_ready_candidates(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_tournament_ready_candidates(jsonb) TO authenticated;


-- ─── TALENT SUMMARY (single row) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.kpm_talent_summary(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  total_candidates int,
  top_performers int, fast_improvers int, consistent_archers int,
  tournament_ready int, hidden_talent int, band_promotions int, achievement_milestones int,
  band_beginner int, band_developing int, band_intermediate int, band_advanced int, band_talent_pool int,
  avg_best_pct numeric, scored_archers int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.kpm_talent_scored(p_filters))
  SELECT
    (count(*) FILTER (WHERE cardinality(talent_reasons) >= 1))::int,
    (count(*) FILTER (WHERE 'Top Performer'         = ANY(talent_reasons)))::int,
    (count(*) FILTER (WHERE 'Fast Improver'         = ANY(talent_reasons)))::int,
    (count(*) FILTER (WHERE 'Consistent Archer'     = ANY(talent_reasons)))::int,
    (count(*) FILTER (WHERE 'Tournament Ready'      = ANY(talent_reasons)))::int,
    (count(*) FILTER (WHERE 'Hidden Talent'         = ANY(talent_reasons)))::int,
    (count(*) FILTER (WHERE 'Band Promotion'        = ANY(talent_reasons)))::int,
    (count(*) FILTER (WHERE 'Achievement Milestone' = ANY(talent_reasons)))::int,
    (count(*) FILTER (WHERE current_band = 'Beginner'))::int,
    (count(*) FILTER (WHERE current_band = 'Developing'))::int,
    (count(*) FILTER (WHERE current_band = 'Intermediate'))::int,
    (count(*) FILTER (WHERE current_band = 'Advanced'))::int,
    (count(*) FILTER (WHERE current_band = 'Talent Pool'))::int,
    round(avg(best_pct), 1),
    count(*)::int
  FROM s;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_talent_summary(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_talent_summary(jsonb) TO authenticated;


-- ─── TALENT PIPELINE (development-band funnel) ─────────────────
-- Archer count per current development band (based on best score %).
CREATE OR REPLACE FUNCTION public.kpm_talent_pipeline(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  band text, band_order int, archers int, pct_of_total numeric, avg_best_pct numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.kpm_talent_scored(p_filters))
  SELECT
    current_band,
    CASE current_band
      WHEN 'Beginner' THEN 0 WHEN 'Developing' THEN 1 WHEN 'Intermediate' THEN 2
      WHEN 'Advanced' THEN 3 WHEN 'Talent Pool' THEN 4 END,
    count(*)::int,
    round(100.0 * count(*) / NULLIF(sum(count(*)) OVER (), 0), 1),
    round(avg(best_pct), 1)
  FROM s
  WHERE current_band IS NOT NULL
  GROUP BY current_band
  ORDER BY 2;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_talent_pipeline(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_talent_pipeline(jsonb) TO authenticated;


-- ─── TALENT BREAKDOWN (grouped) ────────────────────────────────
-- p_group_by ∈ state | pld | school | coach | age_group | gender | bow_category
CREATE OR REPLACE FUNCTION public.kpm_talent_breakdown(
  p_group_by text  DEFAULT 'state',
  p_filters  jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  group_key text, group_label text,
  scored_archers int, candidates int, top_performers int, tournament_ready int,
  talent_pool int, avg_best_pct numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.kpm_talent_scored(p_filters)),
  g AS (
    SELECT
      CASE p_group_by
        WHEN 'state'        THEN s.state_id::text
        WHEN 'pld'          THEN s.pld_id::text
        WHEN 'school'       THEN s.school_id::text
        WHEN 'coach'        THEN s.coach_id::text
        WHEN 'age_group'    THEN s.age_group
        WHEN 'gender'       THEN s.gender
        WHEN 'bow_category' THEN s.bow_category
      END AS gkey,
      CASE p_group_by
        WHEN 'state'        THEN s.state
        WHEN 'pld'          THEN s.pld
        WHEN 'school'       THEN s.school
        WHEN 'coach'        THEN s.coach_name
        WHEN 'age_group'    THEN s.age_group
        WHEN 'gender'       THEN s.gender
        WHEN 'bow_category' THEN s.bow_category
      END AS glabel,
      s.talent_reasons, s.current_band, s.best_pct
    FROM s
  )
  SELECT
    gkey,
    COALESCE(max(glabel), '—'),
    count(*)::int,
    (count(*) FILTER (WHERE cardinality(talent_reasons) >= 1))::int,
    (count(*) FILTER (WHERE 'Top Performer'    = ANY(talent_reasons)))::int,
    (count(*) FILTER (WHERE 'Tournament Ready' = ANY(talent_reasons)))::int,
    (count(*) FILTER (WHERE current_band = 'Talent Pool'))::int,
    round(avg(best_pct), 1)
  FROM g
  GROUP BY gkey
  ORDER BY (count(*) FILTER (WHERE cardinality(talent_reasons) >= 1)) DESC, count(*) DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_talent_breakdown(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_talent_breakdown(text, jsonb) TO authenticated;


-- ─── NOTES / DATA LIMITATIONS ──────────────────────────────────
--  • Development bands are INTERNAL, not KPM classification. Talent-reason
--    thresholds (Top ≥85%, Fast Improver ≥5pp, Consistent stddev≤10 & avg≥65%,
--    Tournament Ready tournament best ≥75%, Hidden Talent ≥75% at a
--    below-median-activity school) are heuristics — adjustable, not official.
--  • current_band = band(best %); previous_band = band(first %); band_movement
--    is up/same (best ≥ first). consistency_score = 100 − stddev(%), needs ≥3
--    scores (else NULL). Median via percentile_cont.
--  • Achievement Milestone requires read access to achievement.user_achievements:
--    admin2/super_admin have it; admin1 does NOT (no scoped policy), so that ONE
--    reason won't fire for admin1 — the other six do. Add an admin1 scoped
--    policy later (like 063 Part A) if regional achievement signals are needed.
--  • SECURITY INVOKER: admin1 sees only assigned scope; no student detail is
--    exposed beyond existing RLS. No UI wired.
