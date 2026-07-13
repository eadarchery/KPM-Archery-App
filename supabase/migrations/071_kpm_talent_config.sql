-- ============================================================
-- Migration 071: KPM Talent Rating Config — tunable thresholds
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent. Run AFTER 066 (it re-creates kpm_talent_scored).
--       Additive only — no table renamed/dropped/altered.
--
-- WHY: the talent titles (Top Performer, Fast Improver, Consistent
--      Archer, Tournament Ready, Hidden Talent, Achievement Milestone)
--      previously had their thresholds hard-coded inside
--      kpm_talent_scored (migration 066). This moves them into ONE
--      single-row settings table so a Super Admin can change how
--      archers are rated with no SQL — and every report, list, funnel
--      and popup updates instantly (they all read this one function).
--
-- Real table : scoring.kpm_talent_config   (one row, id = 1)
-- Public view: public.kpm_talent_config    (security_invoker = true)
-- Follows the exact pattern of core.app_config / public.app_config (026).
--
-- SECURITY: read = any approved user (the SECURITY INVOKER report
--   functions must read it as the caller); write = super_admin only.
--
-- NOTE: development BANDS (Beginner…Talent Pool) remain fixed in
--   kpm_score_band() — only the title thresholds are configurable here.
--   Bands can be made configurable later the same way if needed.
-- ============================================================


-- ─── TABLE (single row, id = 1) ───────────────────────────────
CREATE TABLE IF NOT EXISTS scoring.kpm_talent_config (
  id                          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Top Performer: best verified score % >= X
  top_performer_min_pct       numeric     NOT NULL DEFAULT 85  CHECK (top_performer_min_pct       BETWEEN 0 AND 100),

  -- Fast Improver: (latest - first) pp >= X  AND  scores >= Y
  fast_improver_min_pp        numeric     NOT NULL DEFAULT 5   CHECK (fast_improver_min_pp        BETWEEN 0 AND 100),
  fast_improver_min_scores    int         NOT NULL DEFAULT 2   CHECK (fast_improver_min_scores    >= 1),

  -- Consistent Archer: scores >= X  AND  consistency >= Y  AND  avg % >= Z
  consistent_min_scores       int         NOT NULL DEFAULT 3   CHECK (consistent_min_scores       >= 1),
  consistent_min_consistency  numeric     NOT NULL DEFAULT 90  CHECK (consistent_min_consistency  BETWEEN 0 AND 100),
  consistent_min_avg_pct      numeric     NOT NULL DEFAULT 65  CHECK (consistent_min_avg_pct      BETWEEN 0 AND 100),

  -- Tournament Ready: tournaments >= X  AND  best tournament % >= Y
  tournament_ready_min_count  int         NOT NULL DEFAULT 1   CHECK (tournament_ready_min_count  >= 1),
  tournament_ready_min_pct    numeric     NOT NULL DEFAULT 75  CHECK (tournament_ready_min_pct    BETWEEN 0 AND 100),

  -- Hidden Talent: best % >= X  AND  score count <= school median (auto)
  hidden_talent_min_pct       numeric     NOT NULL DEFAULT 75  CHECK (hidden_talent_min_pct       BETWEEN 0 AND 100),

  -- Achievement Milestone: achievements earned >= X
  achievement_min_count       int         NOT NULL DEFAULT 1   CHECK (achievement_min_count       >= 1),

  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid        REFERENCES core.profiles(id) ON DELETE SET NULL
);

CREATE OR REPLACE TRIGGER scoring_kpm_talent_config_updated_at
  BEFORE UPDATE ON scoring.kpm_talent_config
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- Seed the single default row (idempotent — never overwrites a customised row).
INSERT INTO scoring.kpm_talent_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;


-- ─── RLS ──────────────────────────────────────────────────────
-- Read: any approved user (report functions run SECURITY INVOKER and must
--       read the config as the calling admin1 / admin2 / super_admin).
-- Write: super_admin only.
ALTER TABLE scoring.kpm_talent_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kpm_talent_config_approved_read" ON scoring.kpm_talent_config;
CREATE POLICY "kpm_talent_config_approved_read" ON scoring.kpm_talent_config
  FOR SELECT TO authenticated
  USING (core.is_approved());

DROP POLICY IF EXISTS "kpm_talent_config_super_manage" ON scoring.kpm_talent_config;
CREATE POLICY "kpm_talent_config_super_manage" ON scoring.kpm_talent_config
  FOR ALL TO authenticated
  USING (core.is_super_admin()) WITH CHECK (core.is_super_admin());


-- ─── GRANTS ───────────────────────────────────────────────────
GRANT SELECT, UPDATE ON scoring.kpm_talent_config TO authenticated;
GRANT ALL            ON scoring.kpm_talent_config TO service_role;


-- ─── PUBLIC VIEW (frontend supabase.from('kpm_talent_config')) ─
CREATE OR REPLACE VIEW public.kpm_talent_config
  WITH (security_invoker = true) AS
SELECT * FROM scoring.kpm_talent_config;

GRANT SELECT, UPDATE ON public.kpm_talent_config TO authenticated;


-- ─── RE-CREATE kpm_talent_scored TO READ THE CONFIG ───────────
-- Identical to migration 066 EXCEPT the talent-reason thresholds now come
-- from scoring.kpm_talent_config (via the cfg CTE) instead of literals.
-- The cfg CTE falls back to the original defaults if the row is ever missing,
-- so talent never silently breaks.
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
  cfg AS (   -- single config row, with hard defaults if the row is missing
    SELECT
      COALESCE(c.top_performer_min_pct,       85) AS top_performer_min_pct,
      COALESCE(c.fast_improver_min_pp,         5) AS fast_improver_min_pp,
      COALESCE(c.fast_improver_min_scores,     2) AS fast_improver_min_scores,
      COALESCE(c.consistent_min_scores,        3) AS consistent_min_scores,
      COALESCE(c.consistent_min_consistency,  90) AS consistent_min_consistency,
      COALESCE(c.consistent_min_avg_pct,      65) AS consistent_min_avg_pct,
      COALESCE(c.tournament_ready_min_count,   1) AS tournament_ready_min_count,
      COALESCE(c.tournament_ready_min_pct,    75) AS tournament_ready_min_pct,
      COALESCE(c.hidden_talent_min_pct,       75) AS hidden_talent_min_pct,
      COALESCE(c.achievement_min_count,        1) AS achievement_min_count
    FROM (SELECT 1) one
    LEFT JOIN scoring.kpm_talent_config c ON c.id = 1
  ),
  perf AS (
    SELECT ns.* FROM public.kpm_score_normalised_scores(p_filters) ns CROSS JOIN v
    WHERE (v.perf IS NULL OR ns.status = v.perf) AND ns.score_pct IS NOT NULL
  ),
  ach AS (
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
      CASE WHEN pa.best_pct >= cfg.top_performer_min_pct THEN 'Top Performer' END,
      CASE WHEN (pa.latest_pct - pa.first_pct) >= cfg.fast_improver_min_pp
            AND pa.score_count >= cfg.fast_improver_min_scores THEN 'Fast Improver' END,
      CASE WHEN pa.score_count >= cfg.consistent_min_scores
            AND pa.consistency_score >= cfg.consistent_min_consistency
            AND pa.avg_pct >= cfg.consistent_min_avg_pct THEN 'Consistent Archer' END,
      CASE WHEN pa.tournament_count >= cfg.tournament_ready_min_count
            AND pa.best_tournament_pct >= cfg.tournament_ready_min_pct THEN 'Tournament Ready' END,
      CASE WHEN pa.best_pct >= cfg.hidden_talent_min_pct AND sa2.sc <= sm.med THEN 'Hidden Talent' END,
      CASE WHEN public.kpm_score_band_index(pa.best_pct) > public.kpm_score_band_index(pa.first_pct) THEN 'Band Promotion' END,
      CASE WHEN COALESCE(ach.n, 0) >= cfg.achievement_min_count THEN 'Achievement Milestone' END
    ]::text[], NULL) AS talent_reasons
  FROM per_archer pa
  CROSS JOIN school_med sm
  CROSS JOIN cfg
  LEFT JOIN school_act sa2 ON sa2.school_id = pa.school_id
  LEFT JOIN ach ON ach.archer_id = pa.archer_id;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_talent_scored(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_talent_scored(jsonb) TO authenticated;


-- ─── NOTES ────────────────────────────────────────────────────
--  • One row only (id = 1). The Super Admin "Talent Rating" screen reads
--    and updates public.kpm_talent_config.
--  • Changing a value updates every talent number immediately — cards, funnel,
--    candidate list, breakdowns and the archer popup — because all of them go
--    through kpm_talent_scored.
--  • Titles/bands remain INTERNAL heuristics, not official KPM classification.
