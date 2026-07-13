-- ============================================================
-- Migration 068: KPM Data Quality — trusted reporting on the
--                trustworthiness of the data itself (extends 061–067).
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE only). Run AFTER 061–066.
--       Additive only — nothing renamed, dropped, or altered on tables.
--
-- WHY: KPM reports are only as good as the data. These SECURITY INVOKER
-- functions surface missing fields, invalid scores, incomplete setups and
-- other quality problems as a normalised issue list + summary.
--
-- SEVERITY (INTERNAL, not KPM policy):
--   critical = report-breaking / invalid official number (e.g. score > max).
--   warning  = incomplete or needs admin review (e.g. missing gender/state).
--   info     = useful cleanup, not report-breaking (e.g. pending score).
--
-- SECURITY: SECURITY INVOKER. Everything is scoped through the existing KPM
-- building blocks (kpm_scoped_archers / kpm_scoped_coaches) + base-table RLS,
-- so admin1 sees only its assigned scope and admin2 sees national.
--
-- KNOWN NULL-CONSTRAINED (not checked — the DB already guarantees them):
--   score_submissions.round_id NOT NULL, training_logs.archer_id/date NOT NULL,
--   plds.state_id / schools.state_id NOT NULL.
--
-- FILTER PAYLOAD (shared jsonb ReportFilters): startDate, endDate, stateId,
--   pldId, schoolId, coachId, archerId, ageGroup, gender, bowCategory, roundId,
--   roundCategory, distanceM, sessionType. (scoreStatus/verifiedOnly are NOT
--   applied to score checks — DQ must see pending/rejected rows.)
-- ============================================================


-- ─── ISSUE LIST (base) ─────────────────────────────────────────
-- One row per detected data-quality issue.
CREATE OR REPLACE FUNCTION public.kpm_data_quality_issues(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  entity_type text, entity_id uuid, entity_label text,
  category text, issue_type text, issue_message text, severity text,
  state_id uuid, pld_id uuid, school_id uuid, state text, pld text, school text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  w AS (
    SELECT
      COALESCE(NULLIF(left(NULLIF(p_filters->>'endDate',''), 10), '')::date, CURRENT_DATE) AS v_end,
      NULLIF(left(NULLIF(p_filters->>'startDate',''), 10), '')::date AS v_start
  ),
  arch AS (
    SELECT k.id, k.state_id, k.pld_id, k.school_id, k.coach_id, k.bow_category, k.gender,
           k.birth_year, k.age_group, p.name AS archer_name, p.date_of_birth, p.status AS profile_status,
           st.name AS state, pl.name AS pld, sch.name AS school
    FROM public.kpm_scoped_archers(p_filters) k
    JOIN core.profiles p ON p.id = k.id
    LEFT JOIN org.states  st  ON st.id  = k.state_id
    LEFT JOIN org.plds    pl  ON pl.id  = k.pld_id
    LEFT JOIN org.schools sch ON sch.id = k.school_id
  ),
  eq AS (
    SELECT DISTINCT ON (profile_id) profile_id, bow_brand, arrow_brand
    FROM scoring.equipment_setups WHERE active
    ORDER BY profile_id, created_at DESC
  ),
  sc AS (
    SELECT s.id, s.total_score, s.max_score, s.status, s.proof_url,
           s.age_group AS score_age_group, s.bow_category::text AS score_bow, s.date,
           r.max_score AS round_max, r.category AS round_cat,
           a.archer_name, a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
    FROM arch a
    JOIN scoring.score_submissions s ON s.archer_id = a.id
    JOIN scoring.rounds r ON r.id = s.round_id
    CROSS JOIN w
    WHERE s.date <= w.v_end AND (w.v_start IS NULL OR s.date >= w.v_start)
      AND (NULLIF(p_filters->>'roundId','')       IS NULL OR s.round_id   = (p_filters->>'roundId')::uuid)
      AND (NULLIF(p_filters->>'roundCategory','') IS NULL OR r.category   = p_filters->>'roundCategory')
      AND (NULLIF(p_filters->>'distanceM','')     IS NULL OR r.distance_m = (p_filters->>'distanceM')::int)
  ),
  tr AS (
    SELECT t.id, t.arrows_shot, t.session_type, t.coach_id, t.date,
           a.archer_name, a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
    FROM arch a
    JOIN scoring.training_logs t ON t.archer_id = a.id
    CROSS JOIN w
    WHERE t.date <= w.v_end AND (w.v_start IS NULL OR t.date >= w.v_start)
      AND (NULLIF(p_filters->>'sessionType','') IS NULL OR t.session_type = p_filters->>'sessionType')
  ),
  co AS (
    SELECT c.id, c.state_id, c.pld_id, c.school_id, c.is_certified_flag,
           c.has_valid_cert, c.has_expired_cert, c.has_nonexpiring_cert, c.max_cert_expiry,
           p.name AS coach_name, (cp.profile_id IS NOT NULL) AS has_profile,
           lk.active_links, lk.pending_links,
           st.name AS state, pl.name AS pld, sch.name AS school
    FROM public.kpm_scoped_coaches(p_filters) c
    JOIN core.profiles p ON p.id = c.id
    LEFT JOIN coaching.coach_profiles cp ON cp.profile_id = c.id
    LEFT JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE cal.status = 'active'))::int  AS active_links,
             (count(*) FILTER (WHERE cal.status = 'pending'))::int AS pending_links
      FROM coaching.coach_archer_links cal WHERE cal.coach_id = c.id
    ) lk ON true
    LEFT JOIN org.states  st  ON st.id  = c.state_id
    LEFT JOIN org.plds    pl  ON pl.id  = c.pld_id
    LEFT JOIN org.schools sch ON sch.id = c.school_id
    WHERE c.status = 'approved'
  ),
  sch_activity AS (
    SELECT school_id, max(d) AS last_act FROM (
      SELECT school_id, date AS d FROM sc WHERE school_id IS NOT NULL
      UNION ALL
      SELECT school_id, date AS d FROM tr WHERE school_id IS NOT NULL
    ) u GROUP BY school_id
  ),
  vis_sch AS (SELECT DISTINCT school_id FROM arch WHERE school_id IS NOT NULL),
  sdq AS (
    SELECT s2.id, s2.name, s2.active, s2.pld_id, s2.state_id, st.name AS state, pl.name AS pld,
           EXISTS (SELECT 1 FROM co WHERE co.school_id = s2.id) AS has_coach,
           (SELECT count(*) FROM arch WHERE arch.school_id = s2.id)::int AS archer_count,
           (SELECT last_act FROM sch_activity sa WHERE sa.school_id = s2.id) AS last_act
    FROM org.schools s2
    JOIN vis_sch v ON v.school_id = s2.id
    LEFT JOIN org.states st ON st.id = s2.state_id
    LEFT JOIN org.plds   pl ON pl.id = s2.pld_id
  )

  -- ══ PROFILE ══
  SELECT 'archer'::text, a.id, a.archer_name, 'profile'::text, 'missing_name'::text,
         'Archer profile has no name'::text, 'warning'::text,
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a WHERE a.archer_name IS NULL OR btrim(a.archer_name) = ''
  UNION ALL
  SELECT 'archer', a.id, a.archer_name, 'profile', 'missing_gender',
         'Archer has no gender recorded', 'warning',
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a WHERE a.gender IS NULL
  UNION ALL
  SELECT 'archer', a.id, a.archer_name, 'profile', 'missing_birth_date',
         'Archer has no date of birth or birth year (age group cannot be computed)', 'warning',
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a WHERE a.date_of_birth IS NULL AND a.birth_year IS NULL
  UNION ALL
  SELECT 'archer', a.id, a.archer_name, 'profile', 'missing_state',
         'Archer is not assigned to a state', 'warning',
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a WHERE a.state_id IS NULL
  UNION ALL
  SELECT 'archer', a.id, a.archer_name, 'profile', 'missing_school',
         'Archer is not assigned to a school', 'warning',
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a WHERE a.school_id IS NULL
  UNION ALL
  SELECT 'archer', a.id, a.archer_name, 'profile', 'missing_pld',
         'Archer is not assigned to a PLD', 'info',
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a WHERE a.pld_id IS NULL
  UNION ALL
  SELECT 'archer', a.id, a.archer_name, 'profile', 'missing_bow_category',
         'Archer has no bow category', 'info',
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a WHERE a.bow_category IS NULL
  UNION ALL
  SELECT 'archer', a.id, a.archer_name, 'profile', 'missing_coach_link',
         'Archer has no active coach link', 'info',
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a WHERE a.coach_id IS NULL
  UNION ALL
  SELECT 'archer', a.id, a.archer_name, 'profile', 'unapproved_profile',
         'Archer profile status is not approved', 'warning',
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a WHERE a.profile_status <> 'approved'

  -- ══ EQUIPMENT (admin2-readable only — see notes) ══
  UNION ALL
  SELECT 'archer', a.id, a.archer_name, 'equipment', 'no_equipment_setup',
         'Archer has no active equipment setup', 'info',
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a LEFT JOIN eq ON eq.profile_id = a.id WHERE eq.profile_id IS NULL
  UNION ALL
  SELECT 'archer', a.id, a.archer_name, 'equipment', 'equipment_missing_bow',
         'Equipment setup has no bow details', 'info',
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a JOIN eq ON eq.profile_id = a.id WHERE eq.bow_brand IS NULL
  UNION ALL
  SELECT 'archer', a.id, a.archer_name, 'equipment', 'equipment_missing_arrow',
         'Equipment setup has no arrow details', 'info',
         a.state_id, a.pld_id, a.school_id, a.state, a.pld, a.school
  FROM arch a JOIN eq ON eq.profile_id = a.id WHERE eq.arrow_brand IS NULL

  -- ══ SCORE ══
  UNION ALL
  SELECT 'score', sc.id, sc.archer_name, 'score', 'total_gt_max',
         'Total score exceeds the maximum score (invalid)', 'critical',
         sc.state_id, sc.pld_id, sc.school_id, sc.state, sc.pld, sc.school
  FROM sc WHERE sc.total_score > COALESCE(NULLIF(sc.max_score, 0), sc.round_max)
  UNION ALL
  SELECT 'score', sc.id, sc.archer_name, 'score', 'invalid_max_score',
         'Score has no valid maximum (submission and round max both missing/zero)', 'critical',
         sc.state_id, sc.pld_id, sc.school_id, sc.state, sc.pld, sc.school
  FROM sc WHERE COALESCE(NULLIF(sc.max_score, 0), sc.round_max) IS NULL OR COALESCE(NULLIF(sc.max_score, 0), sc.round_max) <= 0
  UNION ALL
  SELECT 'score', sc.id, sc.archer_name, 'score', 'max_mismatch',
         'Submission max_score differs from the round max_score', 'info',
         sc.state_id, sc.pld_id, sc.school_id, sc.state, sc.pld, sc.school
  FROM sc WHERE sc.max_score IS NOT NULL AND sc.round_max IS NOT NULL AND sc.max_score <> sc.round_max
  UNION ALL
  SELECT 'score', sc.id, sc.archer_name, 'score', 'tournament_no_proof',
         'Tournament score has no proof photo', 'warning',
         sc.state_id, sc.pld_id, sc.school_id, sc.state, sc.pld, sc.school
  FROM sc WHERE sc.round_cat = 'tournament' AND (sc.proof_url IS NULL OR btrim(sc.proof_url) = '')
  UNION ALL
  SELECT 'score', sc.id, sc.archer_name, 'score', 'missing_snapshot',
         'Score is missing its age-group / bow-category snapshot', 'info',
         sc.state_id, sc.pld_id, sc.school_id, sc.state, sc.pld, sc.school
  FROM sc WHERE sc.score_age_group IS NULL OR sc.score_bow IS NULL
  UNION ALL
  SELECT 'score', sc.id, sc.archer_name, 'score', 'pending_score',
         'Score is pending validation', 'info',
         sc.state_id, sc.pld_id, sc.school_id, sc.state, sc.pld, sc.school
  FROM sc WHERE sc.status = 'pending'
  UNION ALL
  SELECT 'score', sc.id, sc.archer_name, 'score', 'rejected_score',
         'Score was rejected', 'info',
         sc.state_id, sc.pld_id, sc.school_id, sc.state, sc.pld, sc.school
  FROM sc WHERE sc.status = 'rejected'

  -- ══ TRAINING ══
  UNION ALL
  SELECT 'training', tr.id, tr.archer_name, 'training', 'zero_arrows',
         'Training log has zero arrows shot', 'info',
         tr.state_id, tr.pld_id, tr.school_id, tr.state, tr.pld, tr.school
  FROM tr WHERE tr.arrows_shot = 0
  UNION ALL
  SELECT 'training', tr.id, tr.archer_name, 'training', 'suspicious_arrows',
         'Training log has an unusually high arrow count (>1000)', 'info',
         tr.state_id, tr.pld_id, tr.school_id, tr.state, tr.pld, tr.school
  FROM tr WHERE tr.arrows_shot > 1000
  UNION ALL
  SELECT 'training', tr.id, tr.archer_name, 'training', 'missing_session_type',
         'Training log has no session type', 'info',
         tr.state_id, tr.pld_id, tr.school_id, tr.state, tr.pld, tr.school
  FROM tr WHERE tr.session_type IS NULL
  UNION ALL
  SELECT 'training', tr.id, tr.archer_name, 'training', 'missing_coach',
         'Training log has no coach recorded', 'info',
         tr.state_id, tr.pld_id, tr.school_id, tr.state, tr.pld, tr.school
  FROM tr WHERE tr.coach_id IS NULL

  -- ══ COACH / CERTIFICATION ══
  UNION ALL
  SELECT 'coach', co.id, co.coach_name, 'coach', 'coach_no_profile',
         'Coach has no coach profile record', 'warning',
         co.state_id, co.pld_id, co.school_id, co.state, co.pld, co.school
  FROM co WHERE NOT co.has_profile
  UNION ALL
  SELECT 'coach', co.id, co.coach_name, 'coach', 'coach_no_valid_cert',
         'Coach has no valid certification', 'warning',
         co.state_id, co.pld_id, co.school_id, co.state, co.pld, co.school
  FROM co WHERE NOT co.has_valid_cert AND NOT co.has_expired_cert
  UNION ALL
  SELECT 'coach', co.id, co.coach_name, 'coach', 'coach_cert_flag_mismatch',
         'Coach is flagged certified but has no valid certification', 'warning',
         co.state_id, co.pld_id, co.school_id, co.state, co.pld, co.school
  FROM co WHERE co.is_certified_flag AND NOT co.has_valid_cert
  UNION ALL
  SELECT 'coach', co.id, co.coach_name, 'coach', 'coach_cert_expired',
         'Coach certification has expired', 'warning',
         co.state_id, co.pld_id, co.school_id, co.state, co.pld, co.school
  FROM co WHERE co.has_expired_cert AND NOT co.has_valid_cert
  UNION ALL
  SELECT 'coach', co.id, co.coach_name, 'coach', 'coach_cert_expiring_90',
         'Coach certification expires within 90 days', 'info',
         co.state_id, co.pld_id, co.school_id, co.state, co.pld, co.school
  FROM co WHERE co.has_valid_cert AND NOT co.has_nonexpiring_cert AND co.max_cert_expiry <= CURRENT_DATE + 90
  UNION ALL
  SELECT 'coach', co.id, co.coach_name, 'coach', 'coach_no_linked_archers',
         'Coach has no active linked archers', 'info',
         co.state_id, co.pld_id, co.school_id, co.state, co.pld, co.school
  FROM co WHERE COALESCE(co.active_links, 0) = 0
  UNION ALL
  SELECT 'coach', co.id, co.coach_name, 'coach', 'coach_pending_links',
         'Coach has pending link approvals', 'info',
         co.state_id, co.pld_id, co.school_id, co.state, co.pld, co.school
  FROM co WHERE COALESCE(co.pending_links, 0) > 0

  -- ══ ORGANISATION ══
  UNION ALL
  SELECT 'school', sdq.id, sdq.name, 'organisation', 'school_missing_pld',
         'School is not assigned to a PLD', 'info',
         sdq.state_id, sdq.pld_id, sdq.id, sdq.state, sdq.pld, sdq.name
  FROM sdq WHERE sdq.pld_id IS NULL
  UNION ALL
  SELECT 'school', sdq.id, sdq.name, 'organisation', 'inactive_school_with_archers',
         'School is inactive but still has archers', 'warning',
         sdq.state_id, sdq.pld_id, sdq.id, sdq.state, sdq.pld, sdq.name
  FROM sdq WHERE NOT sdq.active AND sdq.archer_count > 0
  UNION ALL
  SELECT 'school', sdq.id, sdq.name, 'organisation', 'active_school_no_coach',
         'Active school has no active coach', 'warning',
         sdq.state_id, sdq.pld_id, sdq.id, sdq.state, sdq.pld, sdq.name
  FROM sdq WHERE sdq.active AND NOT sdq.has_coach
  UNION ALL
  SELECT 'school', sdq.id, sdq.name, 'organisation', 'active_school_no_recent_activity',
         'Active school has archers but no score/training activity in 90 days', 'warning',
         sdq.state_id, sdq.pld_id, sdq.id, sdq.state, sdq.pld, sdq.name
  FROM sdq CROSS JOIN w
  WHERE sdq.active AND sdq.archer_count > 0 AND (sdq.last_act IS NULL OR sdq.last_act < w.v_end - 90);
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_data_quality_issues(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_data_quality_issues(jsonb) TO authenticated;


-- ─── SUMMARY (completeness % + severity counts) ────────────────
-- Domain quality % = share of that domain's entities with NO critical/warning
-- issue. Equipment % is share of archers WITH an equipment setup (admin2 only).
CREATE OR REPLACE FUNCTION public.kpm_data_quality_summary(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  overall_completeness_pct numeric, profile_completeness_pct numeric,
  score_quality_pct numeric, training_quality_pct numeric,
  coach_quality_pct numeric, org_quality_pct numeric, equipment_completeness_pct numeric,
  total_issues int, critical_issues int, warning_issues int, info_issues int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH iss AS (SELECT * FROM public.kpm_data_quality_issues(p_filters)),
  tot AS (
    SELECT
      (SELECT count(*) FROM public.kpm_scoped_archers(p_filters))::numeric AS archers,
      (SELECT count(*) FROM public.kpm_filtered_scores(p_filters))::numeric AS scores,
      (SELECT count(*) FROM public.kpm_filtered_training(p_filters))::numeric AS training,
      (SELECT count(*) FROM public.kpm_scoped_coaches(p_filters) WHERE status = 'approved')::numeric AS coaches,
      (SELECT count(DISTINCT school_id) FROM public.kpm_scoped_archers(p_filters) WHERE school_id IS NOT NULL)::numeric AS schools
  ),
  cw AS (
    SELECT
      count(DISTINCT entity_id) FILTER (WHERE category = 'profile'      AND severity IN ('critical','warning'))::numeric AS profile,
      count(DISTINCT entity_id) FILTER (WHERE category = 'score'        AND severity IN ('critical','warning'))::numeric AS score,
      count(DISTINCT entity_id) FILTER (WHERE category = 'training'     AND severity IN ('critical','warning'))::numeric AS training,
      count(DISTINCT entity_id) FILTER (WHERE category = 'coach'        AND severity IN ('critical','warning'))::numeric AS coach,
      count(DISTINCT entity_id) FILTER (WHERE category = 'organisation' AND severity IN ('critical','warning'))::numeric AS org,
      count(DISTINCT entity_id) FILTER (WHERE category = 'equipment')::numeric AS equip
    FROM iss
  )
  SELECT
    round(100 * (1 - (cw.profile + cw.score + cw.training + cw.coach + cw.org)
                     / NULLIF(tot.archers + tot.scores + tot.training + tot.coaches + tot.schools, 0)), 1),
    round(100 * (1 - cw.profile  / NULLIF(tot.archers, 0)), 1),
    round(100 * (1 - cw.score    / NULLIF(tot.scores, 0)), 1),
    round(100 * (1 - cw.training / NULLIF(tot.training, 0)), 1),
    round(100 * (1 - cw.coach    / NULLIF(tot.coaches, 0)), 1),
    round(100 * (1 - cw.org      / NULLIF(tot.schools, 0)), 1),
    round(100 * (1 - cw.equip    / NULLIF(tot.archers, 0)), 1),
    (SELECT count(*) FROM iss)::int,
    (SELECT count(*) FROM iss WHERE severity = 'critical')::int,
    (SELECT count(*) FROM iss WHERE severity = 'warning')::int,
    (SELECT count(*) FROM iss WHERE severity = 'info')::int
  FROM tot CROSS JOIN cw;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_data_quality_summary(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_data_quality_summary(jsonb) TO authenticated;


-- ─── BREAKDOWN (by issue_type | severity | category) ───────────
CREATE OR REPLACE FUNCTION public.kpm_data_quality_breakdown(
  p_group_by text  DEFAULT 'issue_type',
  p_filters  jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  group_key text, total int, critical int, warning int, info int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH iss AS (SELECT * FROM public.kpm_data_quality_issues(p_filters))
  SELECT
    CASE p_group_by WHEN 'severity' THEN severity WHEN 'category' THEN category ELSE issue_type END AS group_key,
    count(*)::int,
    (count(*) FILTER (WHERE severity = 'critical'))::int,
    (count(*) FILTER (WHERE severity = 'warning'))::int,
    (count(*) FILTER (WHERE severity = 'info'))::int
  FROM iss
  GROUP BY 1
  ORDER BY (count(*) FILTER (WHERE severity = 'critical')) DESC, count(*) DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_data_quality_breakdown(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_data_quality_breakdown(text, jsonb) TO authenticated;


-- ─── BY SCOPE (by state | pld | school) ────────────────────────
CREATE OR REPLACE FUNCTION public.kpm_data_quality_by_scope(
  p_group_by text  DEFAULT 'school',
  p_filters  jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  group_key text, group_label text, total int, critical int, warning int, info int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH iss AS (SELECT * FROM public.kpm_data_quality_issues(p_filters))
  SELECT
    CASE p_group_by WHEN 'state' THEN state_id::text WHEN 'pld' THEN pld_id::text ELSE school_id::text END AS group_key,
    COALESCE(max(CASE p_group_by WHEN 'state' THEN state WHEN 'pld' THEN pld ELSE school END), '—') AS group_label,
    count(*)::int,
    (count(*) FILTER (WHERE severity = 'critical'))::int,
    (count(*) FILTER (WHERE severity = 'warning'))::int,
    (count(*) FILTER (WHERE severity = 'info'))::int
  FROM iss
  GROUP BY 1
  ORDER BY (count(*) FILTER (WHERE severity = 'critical')) DESC, count(*) DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_data_quality_by_scope(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_data_quality_by_scope(text, jsonb) TO authenticated;


-- ─── NOTES / DATA LIMITATIONS ──────────────────────────────────
--  • Severity levels are INTERNAL, not KPM policy. Percentages are indicative:
--    domain quality % = entities with no critical/warning issue; totals come
--    from the building-block counts (score total honours scoreStatus if set).
--  • EQUIPMENT checks read scoring.equipment_setups, which is readable by
--    admin2/super_admin only (admin1 has no policy). So equipment_completeness
--    and equipment issues are reliable for admin2/national; for admin1 they
--    will look empty/low — treat as national-only until a scoped policy exists.
--  • DB-guaranteed NOT NULLs (round_id, training archer_id/date, plds.state_id,
--    schools.state_id) are not re-checked.
--  • Score checks intentionally ignore scoreStatus/verifiedOnly so pending and
--    rejected rows are visible to DQ.
--  • Each summary/breakdown/by_scope call re-runs the full issue scan — meant
--    for periodic reporting, not high-frequency polling. No UI wired.
