-- ============================================================
-- Migration 065: KPM Score Normalisation & Improvement — trusted,
--                period-based fair performance reporting (extends 061).
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE only). Run AFTER 061.
--       Additive only — nothing renamed, dropped, or altered on tables.
--       Does NOT touch the leaderboard or rewrite any score.
--
-- WHY: raw scores are not comparable across rounds with different
-- max_score / distance / category. KPM needs a normalised score
-- PERCENTAGE and improvement measure. These SECURITY INVOKER functions
-- provide it by reusing kpm_filtered_scores (061).
--
-- DEFINITIONS:
--   • score % = total_score / max_score × 100. max_score falls back to
--     rounds.max_score when the submission's max_score is missing/0.
--   • Personal best = best score % among the performance rows.
--   • Improvement = latest score % − earliest score % (per archer, by date).
--     Comparability (same round/distance/category) is enforced by the
--     caller's filters; the breakdown computes improvement at (archer ×
--     group) grain so "improvement by round category / distance" compares
--     like-for-like automatically.
--   • Raw score is reported for context but is NEVER the cross-round
--     official comparison — percentage is.
--
-- verifiedOnly DEFAULTS TRUE: performance metrics (avg/median/best/
-- improvement) count admin_approved only, while the validation funnel
-- counts (verified/coach_approved/pending/rejected) remain visible. A hard
-- scoreStatus overrides. Same rule as migration 061's summary.
--
-- FILTER PAYLOAD (shared jsonb ReportFilters): startDate, endDate, stateId,
--   pldId, schoolId, coachId, archerId, ageGroup, gender, bowCategory,
--   roundId, roundCategory, distanceM, scoreStatus, verifiedOnly.
-- ============================================================


-- ─── NORMALISED SCORE ROWS (base) ──────────────────────────────
-- Reuses kpm_filtered_scores (061) and adds the rounds.max_score fallback,
-- exposing eff_max_score + a normalised score_pct. All statuses are kept
-- (funnel visibility); consumers apply the performance status filter.
CREATE OR REPLACE FUNCTION public.kpm_score_normalised_scores(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  score_id uuid, archer_id uuid, archer_name text, archer_code text,
  state_id uuid, state text, pld_id uuid, pld text, school_id uuid, school text,
  coach_id uuid, coach_name text,
  bow_category text, gender text, age_group text,
  round_id uuid, round_name text, round_category text, distance_m int,
  status text, total_score int, eff_max_score int, score_pct numeric, date date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    fs.score_id, fs.archer_id, fs.archer_name, fs.archer_code,
    fs.state_id, fs.state, fs.pld_id, fs.pld, fs.school_id, fs.school,
    fs.coach_id, fs.coach_name,
    fs.bow_category, fs.gender, fs.age_group,
    fs.round_id, fs.round_name, fs.round_category, fs.distance_m,
    fs.status, fs.total_score,
    COALESCE(NULLIF(fs.max_score, 0), r.max_score) AS eff_max_score,
    CASE WHEN COALESCE(NULLIF(fs.max_score, 0), r.max_score) > 0
         THEN round(fs.total_score::numeric / COALESCE(NULLIF(fs.max_score, 0), r.max_score) * 100, 1) END AS score_pct,
    fs.date
  FROM public.kpm_filtered_scores(p_filters) fs
  LEFT JOIN scoring.rounds r ON r.id = fs.round_id;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_score_normalised_scores(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_score_normalised_scores(jsonb) TO authenticated;


-- ─── PER-ARCHER IMPROVEMENT (base for summary + list) ──────────
-- earliest vs latest performance score % per archer (ties broken by score_id).
CREATE OR REPLACE FUNCTION public.kpm_score_improvement(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  archer_id uuid, archer_name text, archer_code text,
  state_id uuid, pld_id uuid, school_id uuid, coach_id uuid,
  gender text, bow_category text, age_group text,
  n_scores int, first_date date, latest_date date,
  first_pct numeric, latest_pct numeric, best_pct numeric, avg_pct numeric,
  improvement_pp numeric
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
  perf AS (
    SELECT ns.*
    FROM public.kpm_score_normalised_scores(p_filters) ns CROSS JOIN v
    WHERE (v.perf IS NULL OR ns.status = v.perf) AND ns.score_pct IS NOT NULL
  )
  -- Group by every constant-per-archer column (uuid has no max() aggregate, and
  -- these are all functionally dependent on archer_id, so grouping keeps one row
  -- per archer while letting us select the ids/labels directly).
  SELECT
    archer_id, archer_name, archer_code,
    state_id, pld_id, school_id, coach_id,
    gender, bow_category, age_group,
    count(*)::int, min(date), max(date),
    (array_agg(score_pct ORDER BY date ASC,  score_id ASC))[1],
    (array_agg(score_pct ORDER BY date DESC, score_id DESC))[1],
    max(score_pct),
    round(avg(score_pct), 1),
    round((array_agg(score_pct ORDER BY date DESC, score_id DESC))[1]
        - (array_agg(score_pct ORDER BY date ASC,  score_id ASC))[1], 1)
  FROM perf
  GROUP BY archer_id, archer_name, archer_code, state_id, pld_id, school_id, coach_id,
           gender, bow_category, age_group;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_score_improvement(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_score_improvement(jsonb) TO authenticated;


-- ─── SCORE SUMMARY (single row) ────────────────────────────────
-- Distribution over performance rows + funnel counts over ALL statuses +
-- average archer improvement (archers with >= 2 comparable scores).
CREATE OR REPLACE FUNCTION public.kpm_score_summary(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  total_scores int,
  scores_verified int, scores_coach_approved int, scores_pending int, scores_rejected int,
  avg_raw_score numeric, median_raw_score numeric,
  avg_score_pct numeric, median_score_pct numeric,
  highest_score_pct numeric, lowest_score_pct numeric,
  personal_best_raw int, personal_best_pct numeric,
  avg_first_score_pct numeric, avg_latest_score_pct numeric, avg_improvement_pp numeric,
  archers_improving int, archers_declining int
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
  ns AS (SELECT * FROM public.kpm_score_normalised_scores(p_filters)),
  perf AS (
    SELECT ns.* FROM ns CROSS JOIN v
    WHERE (v.perf IS NULL OR ns.status = v.perf) AND ns.score_pct IS NOT NULL
  ),
  imp AS (SELECT * FROM public.kpm_score_improvement(p_filters) WHERE n_scores >= 2)
  SELECT
    (SELECT count(*) FROM ns)::int,
    (SELECT count(*) FROM ns WHERE status = 'admin_approved')::int,
    (SELECT count(*) FROM ns WHERE status = 'coach_approved')::int,
    (SELECT count(*) FROM ns WHERE status = 'pending')::int,
    (SELECT count(*) FROM ns WHERE status = 'rejected')::int,
    (SELECT round(avg(total_score), 1) FROM perf),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY total_score))::numeric, 1) FROM perf),
    (SELECT round(avg(score_pct), 1) FROM perf),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY score_pct))::numeric, 1) FROM perf),
    (SELECT max(score_pct) FROM perf),
    (SELECT min(score_pct) FROM perf),
    (SELECT max(total_score) FROM perf)::int,
    (SELECT max(score_pct) FROM perf),
    (SELECT round(avg(first_pct), 1) FROM imp),
    (SELECT round(avg(latest_pct), 1) FROM imp),
    (SELECT round(avg(improvement_pp), 1) FROM imp),
    (SELECT count(*) FROM imp WHERE improvement_pp > 0)::int,
    (SELECT count(*) FROM imp WHERE improvement_pp < 0)::int;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_score_summary(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_score_summary(jsonb) TO authenticated;


-- ─── IMPROVEMENT BREAKDOWN (grouped) ───────────────────────────
-- p_group_by ∈ state | pld | school | coach | age_group | gender
--              | bow_category | round_category | distance
-- Improvement is computed at (archer × group) grain so score-level
-- dimensions (round_category / distance) compare like-for-like.
CREATE OR REPLACE FUNCTION public.kpm_score_improvement_breakdown(
  p_group_by text  DEFAULT 'state',
  p_filters  jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  group_key text, group_label text,
  archers int, avg_improvement_pp numeric,
  avg_first_pct numeric, avg_latest_pct numeric,
  improving int, declining int
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
  perf AS (
    SELECT ns.*,
      CASE p_group_by
        WHEN 'state'          THEN ns.state_id::text
        WHEN 'pld'            THEN ns.pld_id::text
        WHEN 'school'         THEN ns.school_id::text
        WHEN 'coach'          THEN ns.coach_id::text
        WHEN 'age_group'      THEN ns.age_group
        WHEN 'gender'         THEN ns.gender
        WHEN 'bow_category'   THEN ns.bow_category
        WHEN 'round_category' THEN ns.round_category
        WHEN 'distance'       THEN ns.distance_m::text
      END AS gkey,
      CASE p_group_by
        WHEN 'state'          THEN ns.state
        WHEN 'pld'            THEN ns.pld
        WHEN 'school'         THEN ns.school
        WHEN 'coach'          THEN ns.coach_name
        WHEN 'age_group'      THEN ns.age_group
        WHEN 'gender'         THEN ns.gender
        WHEN 'bow_category'   THEN ns.bow_category
        WHEN 'round_category' THEN ns.round_category
        WHEN 'distance'       THEN ns.distance_m::text
      END AS glabel
    FROM public.kpm_score_normalised_scores(p_filters) ns CROSS JOIN v
    WHERE (v.perf IS NULL OR ns.status = v.perf) AND ns.score_pct IS NOT NULL
  ),
  per_unit AS (
    SELECT gkey, max(glabel) AS glabel, archer_id,
      count(*) AS n,
      (array_agg(score_pct ORDER BY date ASC,  score_id ASC))[1]  AS first_pct,
      (array_agg(score_pct ORDER BY date DESC, score_id DESC))[1] AS latest_pct
    FROM perf
    GROUP BY gkey, archer_id
  )
  SELECT
    gkey,
    COALESCE(max(glabel), '—'),
    count(DISTINCT archer_id)::int,
    round(avg(latest_pct - first_pct) FILTER (WHERE n >= 2), 1),
    round(avg(first_pct), 1),
    round(avg(latest_pct), 1),
    (count(*) FILTER (WHERE n >= 2 AND latest_pct > first_pct))::int,
    (count(*) FILTER (WHERE n >= 2 AND latest_pct < first_pct))::int
  FROM per_unit
  GROUP BY gkey
  ORDER BY round(avg(latest_pct - first_pct) FILTER (WHERE n >= 2), 1) DESC NULLS LAST;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_score_improvement_breakdown(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_score_improvement_breakdown(text, jsonb) TO authenticated;


-- ─── NORMALISED SCORE TREND (avg % by bucket) ──────────────────
CREATE OR REPLACE FUNCTION public.kpm_score_trend_normalised(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_bucket  text  DEFAULT 'month'
)
RETURNS TABLE (
  bucket date, scores int, avg_score_pct numeric, median_score_pct numeric, best_score_pct numeric
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
  perf AS (
    SELECT ns.* FROM public.kpm_score_normalised_scores(p_filters) ns CROSS JOIN v
    WHERE (v.perf IS NULL OR ns.status = v.perf) AND ns.score_pct IS NOT NULL
  )
  SELECT
    date_trunc(CASE WHEN p_bucket IN ('day','week','month') THEN p_bucket ELSE 'month' END, date::timestamp)::date,
    count(*)::int,
    round(avg(score_pct), 1),
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY score_pct))::numeric, 1),
    max(score_pct)
  FROM perf
  GROUP BY 1
  ORDER BY 1;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_score_trend_normalised(jsonb, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_score_trend_normalised(jsonb, text) TO authenticated;


-- ─── PRACTICE vs TOURNAMENT COMPARISON ─────────────────────────
-- One row per bucket: practice (training+practice) | tournament | selection.
CREATE OR REPLACE FUNCTION public.kpm_practice_tournament_comparison(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  bucket text, scores int, archers int,
  avg_score_pct numeric, median_score_pct numeric, best_score_pct numeric, avg_raw_score numeric
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
  perf AS (
    SELECT ns.* FROM public.kpm_score_normalised_scores(p_filters) ns CROSS JOIN v
    WHERE (v.perf IS NULL OR ns.status = v.perf) AND ns.score_pct IS NOT NULL
  ),
  b AS (
    SELECT perf.*,
      CASE
        WHEN round_category IN ('training','practice') THEN 'practice'
        WHEN round_category = 'tournament'             THEN 'tournament'
        WHEN round_category = 'selection'              THEN 'selection'
        ELSE 'other'
      END AS bucket
    FROM perf
  )
  SELECT
    bucket,
    count(*)::int,
    count(DISTINCT archer_id)::int,
    round(avg(score_pct), 1),
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY score_pct))::numeric, 1),
    max(score_pct),
    round(avg(total_score), 1)
  FROM b
  GROUP BY bucket
  ORDER BY bucket;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_practice_tournament_comparison(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_practice_tournament_comparison(jsonb) TO authenticated;


-- ─── NOTES / DATA LIMITATIONS ──────────────────────────────────
--  • score % uses submission max_score, falling back to rounds.max_score;
--    rows where neither is > 0 yield NULL score_pct and are excluded from
--    performance stats (they still appear in funnel counts).
--  • Improvement compares an archer's earliest vs latest score in the
--    filtered set; pass roundCategory / distanceM / roundId to enforce strict
--    comparability. The breakdown does this automatically per (archer × group).
--  • Median uses percentile_cont (interpolated). Raw score is context only —
--    percentage is the official cross-round comparison.
--  • No classification thresholds / target scores invented.
--  • Leaderboard untouched; no score rewritten. No UI wired.
