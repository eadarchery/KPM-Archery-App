-- ============================================================
-- Migration 067: KPM School / PLD / State Health — trusted, period-
--                based org-unit health status (extends 061–066).
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE only). Run AFTER 061–066.
--       Additive only — nothing renamed, dropped, or altered on tables.
--
-- WHY: KPM needs a one-glance view of which schools / PLDs / states are
-- healthy, weak, or need intervention. kpm_scope_health rolls up
-- participation, training, scores, retention, coach coverage and talent
-- per org unit and derives a Green / Yellow / Red status with reasons.
--
-- ⚠️ INTERNAL THRESHOLDS, NOT OFFICIAL KPM STANDARDS.
--   The health rules below are conservative INTERNAL defaults, exposed via
--   health_reasons[] so nothing is a black box. They are NOT KPM policy and
--   invent no official targets. Tune the constants freely.
--     Red    : no score/training activity in >90 days, OR no active coach,
--              OR active_ratio < 0.2 (with >=5 registered), OR 0 active, OR 0 registered.
--     Yellow : active_ratio < 0.5, OR avg improvement < 2pp, OR dropout > 40%,
--              OR any expired/expiring-90 cert, OR 0 training sessions, OR 0 scores.
--     Green  : none of the above.
--
-- SECURITY: SECURITY INVOKER. Units are derived from the RLS-scoped building
-- blocks, so admin1 sees only its assigned scope and admin2 sees national,
-- with no new policy. No student/coach detail beyond existing RLS.
--
-- REUSE: kpm_archer_activity_windows (064), kpm_talent_scored (066),
-- kpm_score_normalised_scores (065), kpm_filtered_training (062),
-- kpm_scoped_coaches (063). No duplicate scope logic.
--
-- NOTE: kpm_school_health / kpm_pld_health / kpm_state_health are exposed as
-- thin SERVICE wrappers over kpm_scope_health (fixed group_by) to avoid
-- repeating this 49-column shape as un-idempotent composite types.
--
-- FILTER PAYLOAD (shared jsonb ReportFilters): startDate, endDate, stateId,
--   pldId, schoolId, coachId, ageGroup, gender, bowCategory, roundId,
--   roundCategory, distanceM, scoreStatus, verifiedOnly.
-- ============================================================

CREATE OR REPLACE FUNCTION public.kpm_scope_health(
  p_group_by text  DEFAULT 'school',
  p_filters  jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  scope_type text, unit_id uuid, unit_name text, parent_state text, parent_pld text,
  registered_archers int, active_archers int, new_archers int, returning_archers int,
  inactive_archers int, active_ratio numeric,
  training_sessions int, total_arrows bigint, avg_arrows_per_session numeric,
  active_training_archers int, active_training_coaches int, last_training_date date,
  scores_submitted int, verified_scores int, pending_scores int, rejected_scores int,
  avg_score_pct numeric, median_score_pct numeric, avg_improvement_pp numeric, last_score_date date,
  retention_rate numeric, dropout_rate numeric,
  inactive_30 int, inactive_60 int, inactive_90 int, inactive_180 int, inactive_365 int,
  total_coaches int, active_coaches int, certified_coaches int, uncertified_coaches int,
  coach_to_active_archer_ratio numeric, certs_expired int, certs_expiring_90 int,
  schools_without_active_coach int,
  talent_candidates int, tournament_ready int, fast_improvers int, talent_pool int,
  last_activity_date date,
  health_status text, health_score numeric, health_reasons text[], needs_attention boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  w AS (
    SELECT v_end, COALESCE(vs, v_end - 90) AS v_start
    FROM (
      SELECT
        COALESCE(NULLIF(left(NULLIF(p_filters->>'endDate',''), 10), '')::date, CURRENT_DATE) AS v_end,
        NULLIF(left(NULLIF(p_filters->>'startDate',''), 10), '')::date AS vs
    ) x
  ),
  aw AS (
    SELECT a.*, CASE p_group_by WHEN 'state' THEN a.state_id WHEN 'pld' THEN a.pld_id ELSE a.school_id END AS ukey
    FROM public.kpm_archer_activity_windows(p_filters) a
  ),
  ts AS (
    SELECT t.*, CASE p_group_by WHEN 'state' THEN t.state_id WHEN 'pld' THEN t.pld_id ELSE t.school_id END AS ukey
    FROM public.kpm_talent_scored(p_filters) t
  ),
  ns AS (
    SELECT n.*, CASE p_group_by WHEN 'state' THEN n.state_id WHEN 'pld' THEN n.pld_id ELSE n.school_id END AS ukey
    FROM public.kpm_score_normalised_scores(p_filters) n
  ),
  ft AS (
    SELECT f.*, CASE p_group_by WHEN 'state' THEN f.state_id WHEN 'pld' THEN f.pld_id ELSE f.school_id END AS ukey
    FROM public.kpm_filtered_training(p_filters) f
  ),
  co AS (
    SELECT c.*, CASE p_group_by WHEN 'state' THEN c.state_id WHEN 'pld' THEN c.pld_id ELSE c.school_id END AS ukey
    FROM public.kpm_scoped_coaches(p_filters) c
  ),
  -- ── per-unit aggregates ──
  part AS (
    SELECT aw.ukey,
      count(*)::int AS registered,
      (count(*) FILTER (WHERE aw.active_current))::int AS active,
      (count(*) FILTER (WHERE aw.registered_at >= w.v_start))::int AS new_archers,
      (count(*) FILTER (WHERE aw.active_current AND aw.active_previous))::int AS returning,
      (count(*) FILTER (WHERE NOT aw.active_current))::int AS inactive,
      (count(*) FILTER (WHERE aw.effective_inactive_days >= 30))::int  AS inactive_30,
      (count(*) FILTER (WHERE aw.effective_inactive_days >= 60))::int  AS inactive_60,
      (count(*) FILTER (WHERE aw.effective_inactive_days >= 90))::int  AS inactive_90,
      (count(*) FILTER (WHERE aw.effective_inactive_days >= 180))::int AS inactive_180,
      (count(*) FILTER (WHERE aw.effective_inactive_days >= 365))::int AS inactive_365,
      round(100.0 * count(*) FILTER (WHERE aw.active_previous AND aw.active_current)
            / NULLIF(count(*) FILTER (WHERE aw.active_previous), 0), 1) AS retention_rate,
      round(100.0 * count(*) FILTER (WHERE aw.active_previous AND NOT aw.active_current)
            / NULLIF(count(*) FILTER (WHERE aw.active_previous), 0), 1) AS dropout_rate,
      max(aw.last_activity) AS last_activity_date
    FROM aw CROSS JOIN w
    WHERE aw.ukey IS NOT NULL
    GROUP BY aw.ukey
  ),
  scor AS (
    SELECT ns.ukey,
      count(*)::int AS submitted,
      (count(*) FILTER (WHERE ns.status = 'admin_approved'))::int AS verified,
      (count(*) FILTER (WHERE ns.status = 'pending'))::int AS pending,
      (count(*) FILTER (WHERE ns.status = 'rejected'))::int AS rejected,
      round(avg(ns.score_pct) FILTER (WHERE ns.status = 'admin_approved'), 1) AS avg_pct,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ns.score_pct)
             FILTER (WHERE ns.status = 'admin_approved'))::numeric, 1) AS median_pct,
      max(ns.date) AS last_score_date
    FROM ns
    WHERE ns.ukey IS NOT NULL
    GROUP BY ns.ukey
  ),
  impr AS (
    SELECT ts.ukey, round(avg(ts.improvement_pp) FILTER (WHERE ts.score_count >= 2), 1) AS avg_improvement
    FROM ts WHERE ts.ukey IS NOT NULL GROUP BY ts.ukey
  ),
  tal AS (
    SELECT ts.ukey,
      (count(*) FILTER (WHERE cardinality(ts.talent_reasons) >= 1))::int AS candidates,
      (count(*) FILTER (WHERE 'Tournament Ready' = ANY(ts.talent_reasons)))::int AS tournament_ready,
      (count(*) FILTER (WHERE 'Fast Improver' = ANY(ts.talent_reasons)))::int AS fast_improvers,
      (count(*) FILTER (WHERE ts.current_band = 'Talent Pool'))::int AS talent_pool
    FROM ts WHERE ts.ukey IS NOT NULL GROUP BY ts.ukey
  ),
  trn AS (
    SELECT ft.ukey,
      count(*)::int AS sessions,
      COALESCE(sum(ft.arrows_shot), 0)::bigint AS arrows,
      round(avg(ft.arrows_shot), 1) AS avg_arrows,
      count(DISTINCT ft.archer_id)::int AS active_training_archers,
      count(DISTINCT ft.coach_id)::int AS active_training_coaches,
      max(ft.date) AS last_training_date
    FROM ft WHERE ft.ukey IS NOT NULL GROUP BY ft.ukey
  ),
  cch AS (
    SELECT co.ukey,
      count(*)::int AS total_coaches,
      (count(*) FILTER (WHERE co.status = 'approved'))::int AS active_coaches,
      (count(*) FILTER (WHERE co.status = 'approved' AND co.has_valid_cert))::int AS certified,
      (count(*) FILTER (WHERE co.status = 'approved' AND NOT co.has_valid_cert))::int AS uncertified,
      (count(*) FILTER (WHERE co.status = 'approved' AND NOT co.has_valid_cert AND co.has_expired_cert))::int AS certs_expired,
      (count(*) FILTER (WHERE co.status = 'approved' AND co.has_valid_cert AND NOT co.has_nonexpiring_cert
                        AND co.max_cert_expiry <= CURRENT_DATE + 90))::int AS certs_expiring_90
    FROM co WHERE co.ukey IS NOT NULL GROUP BY co.ukey
  ),
  -- schools (with archers) in each unit lacking an approved coach — scoped-data only
  unit_schools AS (SELECT DISTINCT aw.school_id, aw.state_id, aw.pld_id FROM aw WHERE aw.school_id IS NOT NULL),
  sch_has_coach AS (SELECT DISTINCT co.school_id FROM co WHERE co.status = 'approved' AND co.school_id IS NOT NULL),
  snc AS (
    SELECT
      CASE p_group_by WHEN 'state' THEN us.state_id WHEN 'pld' THEN us.pld_id ELSE us.school_id END AS ukey,
      (count(*) FILTER (WHERE us.school_id NOT IN (SELECT school_id FROM sch_has_coach)))::int AS schools_without_coach
    FROM unit_schools us GROUP BY 1
  ),
  -- ── unit universe (only units the caller can see) + names ──
  uid AS (
    SELECT DISTINCT ukey FROM (
      SELECT ukey FROM aw UNION SELECT ukey FROM co UNION SELECT ukey FROM ft UNION SELECT ukey FROM ns
    ) z WHERE ukey IS NOT NULL
  ),
  units AS (
    SELECT uid.ukey,
      COALESCE(st.name, pl.name, sc.name) AS uname,
      CASE p_group_by WHEN 'school' THEN sst.name WHEN 'pld' THEN pst.name ELSE NULL END AS parent_state,
      CASE p_group_by WHEN 'school' THEN spl.name ELSE NULL END AS parent_pld
    FROM uid
    LEFT JOIN org.states  st ON p_group_by = 'state'  AND st.id = uid.ukey
    LEFT JOIN org.plds    pl ON p_group_by = 'pld'    AND pl.id = uid.ukey
    LEFT JOIN org.schools sc ON p_group_by = 'school' AND sc.id = uid.ukey
    LEFT JOIN org.states  sst ON p_group_by = 'school' AND sst.id = sc.state_id
    LEFT JOIN org.plds    spl ON p_group_by = 'school' AND spl.id = sc.pld_id
    LEFT JOIN org.states  pst ON p_group_by = 'pld'    AND pst.id = pl.state_id
  ),
  -- ── assemble metrics ──
  m AS (
    SELECT
      u.ukey, u.uname, u.parent_state, u.parent_pld, w.v_end,
      COALESCE(part.registered, 0) AS registered,
      COALESCE(part.active, 0) AS active,
      COALESCE(part.new_archers, 0) AS new_archers,
      COALESCE(part.returning, 0) AS returning,
      COALESCE(part.inactive, 0) AS inactive,
      round(COALESCE(part.active, 0)::numeric / NULLIF(part.registered, 0), 3) AS active_ratio,
      COALESCE(trn.sessions, 0) AS training_sessions,
      COALESCE(trn.arrows, 0) AS total_arrows,
      trn.avg_arrows,
      COALESCE(trn.active_training_archers, 0) AS active_training_archers,
      COALESCE(trn.active_training_coaches, 0) AS active_training_coaches,
      trn.last_training_date,
      COALESCE(scor.submitted, 0) AS scores_submitted,
      COALESCE(scor.verified, 0) AS verified_scores,
      COALESCE(scor.pending, 0) AS pending_scores,
      COALESCE(scor.rejected, 0) AS rejected_scores,
      scor.avg_pct, scor.median_pct, impr.avg_improvement, scor.last_score_date,
      part.retention_rate, part.dropout_rate,
      COALESCE(part.inactive_30, 0) AS inactive_30,
      COALESCE(part.inactive_60, 0) AS inactive_60,
      COALESCE(part.inactive_90, 0) AS inactive_90,
      COALESCE(part.inactive_180, 0) AS inactive_180,
      COALESCE(part.inactive_365, 0) AS inactive_365,
      COALESCE(cch.total_coaches, 0) AS total_coaches,
      COALESCE(cch.active_coaches, 0) AS active_coaches,
      COALESCE(cch.certified, 0) AS certified_coaches,
      COALESCE(cch.uncertified, 0) AS uncertified_coaches,
      round(COALESCE(part.active, 0)::numeric / NULLIF(cch.active_coaches, 0), 1) AS coach_ratio,
      COALESCE(cch.certs_expired, 0) AS certs_expired,
      COALESCE(cch.certs_expiring_90, 0) AS certs_expiring_90,
      COALESCE(snc.schools_without_coach, 0) AS schools_without_coach,
      COALESCE(tal.candidates, 0) AS talent_candidates,
      COALESCE(tal.tournament_ready, 0) AS tournament_ready,
      COALESCE(tal.fast_improvers, 0) AS fast_improvers,
      COALESCE(tal.talent_pool, 0) AS talent_pool,
      part.last_activity_date
    FROM units u
    CROSS JOIN w
    LEFT JOIN part ON part.ukey = u.ukey
    LEFT JOIN scor ON scor.ukey = u.ukey
    LEFT JOIN impr ON impr.ukey = u.ukey
    LEFT JOIN trn  ON trn.ukey  = u.ukey
    LEFT JOIN cch  ON cch.ukey  = u.ukey
    LEFT JOIN snc  ON snc.ukey  = u.ukey
    LEFT JOIN tal  ON tal.ukey  = u.ukey
  ),
  hu AS (
    SELECT
      p_group_by AS scope_type, m.ukey AS unit_id, m.uname AS unit_name, m.parent_state, m.parent_pld,
      m.registered AS registered_archers, m.active AS active_archers, m.new_archers,
      m.returning AS returning_archers, m.inactive AS inactive_archers, m.active_ratio,
      m.training_sessions, m.total_arrows, m.avg_arrows AS avg_arrows_per_session,
      m.active_training_archers, m.active_training_coaches, m.last_training_date,
      m.scores_submitted, m.verified_scores, m.pending_scores, m.rejected_scores,
      m.avg_pct AS avg_score_pct, m.median_pct AS median_score_pct, m.avg_improvement AS avg_improvement_pp, m.last_score_date,
      m.retention_rate, m.dropout_rate,
      m.inactive_30, m.inactive_60, m.inactive_90, m.inactive_180, m.inactive_365,
      m.total_coaches, m.active_coaches, m.certified_coaches, m.uncertified_coaches,
      m.coach_ratio AS coach_to_active_archer_ratio, m.certs_expired, m.certs_expiring_90, m.schools_without_coach AS schools_without_active_coach,
      m.talent_candidates, m.tournament_ready, m.fast_improvers, m.talent_pool,
      m.last_activity_date,
      CASE
        WHEN m.registered = 0 THEN 'Red'
        WHEN m.last_activity_date IS NULL OR (m.v_end - m.last_activity_date) > 90
             OR m.active_coaches = 0
             OR (m.registered >= 5 AND COALESCE(m.active_ratio, 0) < 0.2)
             OR m.active = 0 THEN 'Red'
        WHEN COALESCE(m.active_ratio, 1) < 0.5
             OR (m.avg_improvement IS NOT NULL AND m.avg_improvement < 2)
             OR COALESCE(m.dropout_rate, 0) > 40
             OR m.certs_expired > 0 OR m.certs_expiring_90 > 0
             OR m.training_sessions = 0
             OR m.scores_submitted = 0 THEN 'Yellow'
        ELSE 'Green'
      END AS health_status,
      GREATEST(0, LEAST(100, round(
          50
          + 25 * COALESCE(m.active_ratio, 0)
          + LEAST(15, GREATEST(-15, COALESCE(m.avg_improvement, 0) * 2))
          + CASE WHEN m.active_coaches > 0 THEN 10 ELSE -25 END
          - 0.25 * COALESCE(m.dropout_rate, 0)
          + CASE WHEN m.talent_candidates > 0 THEN 5 ELSE 0 END
          + CASE WHEN m.last_activity_date IS NULL OR (m.v_end - m.last_activity_date) > 90 THEN -30 ELSE 0 END
      , 1))) AS health_score,
      array_remove(ARRAY[
        CASE WHEN m.last_activity_date IS NULL OR (m.v_end - m.last_activity_date) > 90 THEN 'No recent activity' END,
        CASE WHEN m.registered > 0 AND COALESCE(m.active_ratio, 0) < 0.5 THEN 'Low active archer ratio' END,
        CASE WHEN m.registered > 0 AND m.active_coaches = 0 THEN 'No active coach' END,
        CASE WHEN m.avg_improvement IS NOT NULL AND m.avg_improvement < 2 THEN 'Low score improvement' END,
        CASE WHEN COALESCE(m.dropout_rate, 0) > 40 THEN 'High dropout rate' END,
        CASE WHEN m.certs_expired > 0 OR m.certs_expiring_90 > 0 OR (m.active_coaches > 0 AND m.certified_coaches = 0) THEN 'Certification issue' END,
        CASE WHEN m.training_sessions = 0 THEN 'Low training activity' END,
        CASE WHEN m.registered > 0 AND m.scores_submitted = 0 THEN 'Data incomplete' END,
        CASE WHEN m.registered > 0 AND m.new_archers::numeric / NULLIF(m.registered, 0) >= 0.2 THEN 'Strong growth' END,
        CASE WHEN m.avg_improvement >= 5 THEN 'Strong improvement' END,
        CASE WHEN m.talent_candidates >= 3 OR m.tournament_ready > 0 THEN 'Strong talent pipeline' END
      ]::text[], NULL) AS health_reasons
    FROM m
  )
  SELECT hu.*, (hu.health_status <> 'Green') AS needs_attention
  FROM hu
  ORDER BY CASE hu.health_status WHEN 'Red' THEN 0 WHEN 'Yellow' THEN 1 ELSE 2 END, hu.health_score ASC NULLS FIRST, hu.unit_name;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_scope_health(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_scope_health(text, jsonb) TO authenticated;


-- ─── NATIONAL HEALTH SUMMARY (per scope level) ─────────────────
-- One row per scope level (state / pld / school): unit counts by status.
CREATE OR REPLACE FUNCTION public.kpm_national_health_summary(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  scope_type text, total_units int, green int, yellow int, red int,
  needs_attention int, avg_health_score numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH h AS (
    SELECT scope_type, health_status, health_score, needs_attention FROM public.kpm_scope_health('state',  p_filters)
    UNION ALL
    SELECT scope_type, health_status, health_score, needs_attention FROM public.kpm_scope_health('pld',    p_filters)
    UNION ALL
    SELECT scope_type, health_status, health_score, needs_attention FROM public.kpm_scope_health('school', p_filters)
  )
  SELECT
    scope_type,
    count(*)::int,
    (count(*) FILTER (WHERE health_status = 'Green'))::int,
    (count(*) FILTER (WHERE health_status = 'Yellow'))::int,
    (count(*) FILTER (WHERE health_status = 'Red'))::int,
    (count(*) FILTER (WHERE needs_attention))::int,
    round(avg(health_score), 1)
  FROM h
  GROUP BY scope_type
  ORDER BY CASE scope_type WHEN 'state' THEN 0 WHEN 'pld' THEN 1 ELSE 2 END;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_national_health_summary(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_national_health_summary(jsonb) TO authenticated;


-- ─── NOTES / DATA LIMITATIONS ──────────────────────────────────
--  • Health thresholds are INTERNAL conservative defaults (see header), fully
--    exposed via health_reasons[]. Not KPM classification; invent no targets.
--  • Units are derived from RLS-scoped building blocks, so a unit with zero
--    visible archers/coaches/activity simply does not appear (can't be
--    assessed) rather than showing as a false Red.
--  • schools_without_active_coach counts only schools that have archers in
--    scope (consistent RLS); for a school unit it is 0 or 1.
--  • Achievement-derived talent signals inherit 066's limitation (admin1
--    cannot read user_achievements). health_score is a sortable heuristic.
--  • This function nests every KPM building block; it is intended for periodic
--    reporting, not high-frequency polling. No UI wired.
