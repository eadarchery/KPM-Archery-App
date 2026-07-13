-- ============================================================
-- Migration 063: KPM Coach Coverage & Certification Expiry
--                trusted, period-aware reporting (extends 061/062).
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE / DROP POLICY IF EXISTS).
--       Run AFTER 061 (needs kpm_scoped_archers) and 062. Additive
--       only — nothing renamed, dropped, or altered on tables.
--
-- WHY: KPM must monitor coach availability, certification status and
-- whether schools / PLDs / states have enough certified coaching. There
-- was no trusted aggregate. These SECURITY INVOKER functions provide it.
--
-- ⚠️ SECURITY-RELEVANT ADDITIVE CHANGE (Part A below):
--   coaching.coach_profiles, certification.certifications and
--   coaching.coach_archer_links only had OWN + admin2 (core.is_admin)
--   read policies — admin1 could read NONE of them, so SECURITY INVOKER
--   coverage RPCs would return empty for regional admins. Part A adds
--   admin1 SCOPE-LIMITED SELECT policies (via core.admin1_in_scope on the
--   coach's profile), mirroring migration 054 for scores/training. This
--   only ADDS scoped read for admin1; admin2/coach/archer access is
--   unchanged. Remove Part A if you want coach coverage to stay
--   admin2-national only.
--
-- CERTIFICATION SOURCE OF TRUTH: certification.certifications drives all
-- official cert status/expiry. coaching.coach_profiles.is_certified is a
-- FALLBACK only, surfaced as `certified_by_flag_only` (coaches flagged
-- certified but with NO valid certification record) so the data conflict
-- is visible rather than silently trusted.
--
-- FILTER PAYLOAD (shared jsonb ReportFilters) honoured here:
--   stateId, pldId, schoolId, coachId, gender          → coach scope
--   certificationStatus ('certified'|'expiring'|'expired'|'uncertified')
--   certificationLevel  (matches certificate_level)
--   startDate, endDate  → activity metrics only (ratio, stale, workload);
--                         coach headcount is a CURRENT snapshot.
--   ageGroup / bowCategory are archer attributes → ignored for coaches.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PART A — admin1 scope-limited READ policies (enablement)
-- ════════════════════════════════════════════════════════════
-- ⚠️ RECURSION FIX (069): these policies must NOT subquery core.profiles
-- inline. core.profiles' own "coach reads linked archers" policy (006)
-- subqueries coach_archer_links, so an inline profiles read here creates
-- profiles → coach_archer_links → profiles plan-time recursion (42P17) and
-- breaks EVERY profiles select — including login. The SECURITY DEFINER
-- helper below is opaque to the planner and breaks the cycle. If you ran an
-- older 063 and login broke, run 069_fix_profiles_rls_recursion.sql.

CREATE OR REPLACE FUNCTION core.admin1_profile_in_scope(
  p_admin   uuid,
  p_profile uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_state uuid; v_pld uuid; v_school uuid;
BEGIN
  SELECT p.state_id, p.pld_id, p.school_id
    INTO v_state, v_pld, v_school
  FROM core.profiles p
  WHERE p.id = p_profile;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN core.admin1_in_scope(p_admin, v_state, v_pld, v_school);
END;
$$;

REVOKE ALL ON FUNCTION core.admin1_profile_in_scope(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION core.admin1_profile_in_scope(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "coaching_coach_profiles_admin1_reads" ON coaching.coach_profiles;
CREATE POLICY "coaching_coach_profiles_admin1_reads"
  ON coaching.coach_profiles FOR SELECT TO authenticated
  USING (
    core.current_role() = 'admin1' AND core.is_approved()
    AND core.admin1_profile_in_scope(auth.uid(), coaching.coach_profiles.profile_id)
  );

DROP POLICY IF EXISTS "cert_admin1_reads" ON certification.certifications;
CREATE POLICY "cert_admin1_reads"
  ON certification.certifications FOR SELECT TO authenticated
  USING (
    core.current_role() = 'admin1' AND core.is_approved()
    AND core.admin1_profile_in_scope(auth.uid(), certification.certifications.coach_id)
  );

DROP POLICY IF EXISTS "coaching_cal_admin1_reads" ON coaching.coach_archer_links;
CREATE POLICY "coaching_cal_admin1_reads"
  ON coaching.coach_archer_links FOR SELECT TO authenticated
  USING (
    core.current_role() = 'admin1' AND core.is_approved()
    AND core.admin1_profile_in_scope(auth.uid(), coaching.coach_archer_links.coach_id)
  );


-- ════════════════════════════════════════════════════════════
-- PART B — SECURITY INVOKER reporting functions
-- ════════════════════════════════════════════════════════════

-- ─── SCOPED COACH POPULATION (+ certification rollup) ──────────
-- One row per coach (role='coach') in scope, with a per-coach certification
-- rollup so no coach is double-counted across multiple certifications.
-- cert_status ∈ certified | expiring (≤180d) | expired | uncertified.
CREATE OR REPLACE FUNCTION public.kpm_scoped_coaches(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  id uuid, state_id uuid, pld_id uuid, school_id uuid,
  gender text, status text, created_at timestamptz,
  is_certified_flag boolean, profile_cert_level text,
  experience_years int, specialization text[],
  has_valid_cert boolean, has_expired_cert boolean, has_nonexpiring_cert boolean,
  max_cert_expiry date, latest_cert_level text, eff_level text, cert_status text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH cert_roll AS (
    SELECT
      c.coach_id,
      bool_or(c.status = 'approved' AND (c.expiry_date IS NULL OR c.expiry_date >= CURRENT_DATE)) AS has_valid,
      bool_or(c.status = 'approved' AND c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE) AS has_expired,
      bool_or(c.status = 'approved' AND c.expiry_date IS NULL) AS has_nonexpiring,
      max(c.expiry_date) FILTER (WHERE c.status = 'approved') AS max_expiry,
      (array_agg(c.certificate_level ORDER BY c.issued_date DESC NULLS LAST)
        FILTER (WHERE c.status = 'approved' AND c.certificate_level IS NOT NULL))[1] AS latest_level
    FROM certification.certifications c
    GROUP BY c.coach_id
  ),
  base AS (
    SELECT
      p.id, p.state_id, p.pld_id, p.school_id, p.gender, p.status, p.created_at,
      COALESCE(cp.is_certified, false) AS is_certified_flag,
      cp.certification_level AS profile_cert_level,
      cp.experience_years,
      cp.specialization,
      COALESCE(cr.has_valid, false)       AS has_valid_cert,
      COALESCE(cr.has_expired, false)     AS has_expired_cert,
      COALESCE(cr.has_nonexpiring, false) AS has_nonexpiring_cert,
      cr.max_expiry                       AS max_cert_expiry,
      cr.latest_level                     AS latest_cert_level,
      COALESCE(cr.latest_level, cp.certification_level) AS eff_level,
      CASE
        WHEN COALESCE(cr.has_valid, false) AND NOT COALESCE(cr.has_nonexpiring, false)
             AND cr.max_expiry <= CURRENT_DATE + 180 THEN 'expiring'
        WHEN COALESCE(cr.has_valid, false)   THEN 'certified'
        WHEN COALESCE(cr.has_expired, false) THEN 'expired'
        ELSE 'uncertified'
      END AS cert_status
    FROM core.profiles p
    LEFT JOIN coaching.coach_profiles cp ON cp.profile_id = p.id
    LEFT JOIN cert_roll cr ON cr.coach_id = p.id
    WHERE p.role = 'coach'
      AND (NULLIF(p_filters->>'stateId','')  IS NULL OR p.state_id  = (p_filters->>'stateId')::uuid)
      AND (NULLIF(p_filters->>'pldId','')    IS NULL OR p.pld_id    = (p_filters->>'pldId')::uuid)
      AND (NULLIF(p_filters->>'schoolId','') IS NULL OR p.school_id = (p_filters->>'schoolId')::uuid)
      AND (NULLIF(p_filters->>'coachId','')  IS NULL OR p.id        = (p_filters->>'coachId')::uuid)
      AND (NULLIF(p_filters->>'gender','')   IS NULL OR p.gender    = p_filters->>'gender')
  )
  SELECT
    id, state_id, pld_id, school_id, gender, status, created_at,
    is_certified_flag, profile_cert_level, experience_years, specialization,
    has_valid_cert, has_expired_cert, has_nonexpiring_cert, max_cert_expiry,
    latest_cert_level, eff_level, cert_status
  FROM base
  WHERE (NULLIF(p_filters->>'certificationStatus','') IS NULL OR cert_status = p_filters->>'certificationStatus')
    AND (NULLIF(p_filters->>'certificationLevel','')  IS NULL OR eff_level  = p_filters->>'certificationLevel');
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_scoped_coaches(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_scoped_coaches(jsonb) TO authenticated;


-- ─── COVERAGE SUMMARY (single row) ─────────────────────────────
-- "active" coach = approved account (the available workforce). Expiring
-- buckets are CUMULATIVE (≤30 ⊂ ≤90 ⊂ ≤180 days) over coaches whose
-- furthest valid certification lapses within the window.
CREATE OR REPLACE FUNCTION public.kpm_coach_coverage_summary(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  total_coaches int, active_coaches int,
  certified_coaches int, uncertified_coaches int, expired_cert_coaches int,
  expiring_30 int, expiring_90 int, expiring_180 int,
  certified_by_flag_only int,
  active_archers int, archers_per_active_coach numeric,
  schools_with_active_coach int, schools_without_active_coach int,
  plds_with_active_coach int, states_with_active_coach int,
  avg_linked_per_active_coach numeric,
  coaches_no_linked_archers int, coaches_stale int, pending_link_approvals int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH co AS (SELECT * FROM public.kpm_scoped_coaches(p_filters)),
       ac AS (SELECT * FROM co WHERE status = 'approved'),
       fs AS (SELECT archer_id, status FROM public.kpm_filtered_scores(p_filters)),
       ft AS (SELECT archer_id FROM public.kpm_filtered_training(p_filters)),
       val_arch AS (SELECT DISTINCT archer_id FROM fs WHERE status = 'admin_approved'),
       active_arch AS (
         SELECT archer_id FROM fs
         UNION
         SELECT archer_id FROM ft
       ),
       link_agg AS (
         SELECT cal.coach_id, count(*) FILTER (WHERE cal.status = 'active') AS active_links
         FROM coaching.coach_archer_links cal
         JOIN ac ON ac.id = cal.coach_id
         GROUP BY cal.coach_id
       ),
       coach_act AS (
         SELECT cal.coach_id,
           bool_or(cal.status = 'active') AS has_active_link,
           bool_or(cal.status = 'active' AND aa.archer_id IS NOT NULL) AS has_active_student
         FROM coaching.coach_archer_links cal
         JOIN ac ON ac.id = cal.coach_id
         LEFT JOIN (SELECT DISTINCT archer_id FROM active_arch) aa ON aa.archer_id = cal.archer_id
         GROUP BY cal.coach_id
       ),
       sch AS (
         SELECT id, state_id, pld_id FROM org.schools
         WHERE active
           AND (NULLIF(p_filters->>'stateId','')  IS NULL OR state_id = (p_filters->>'stateId')::uuid)
           AND (NULLIF(p_filters->>'pldId','')    IS NULL OR pld_id   = (p_filters->>'pldId')::uuid)
           AND (NULLIF(p_filters->>'schoolId','') IS NULL OR id       = (p_filters->>'schoolId')::uuid)
       ),
       sch_cov AS (SELECT DISTINCT school_id FROM ac WHERE school_id IS NOT NULL)
  SELECT
    (SELECT count(*) FROM co)::int,
    (SELECT count(*) FROM ac)::int,
    (SELECT count(*) FROM ac WHERE has_valid_cert)::int,
    (SELECT count(*) FROM ac WHERE NOT has_valid_cert)::int,
    (SELECT count(*) FROM ac WHERE NOT has_valid_cert AND has_expired_cert)::int,
    (SELECT count(*) FROM ac WHERE has_valid_cert AND NOT has_nonexpiring_cert AND max_cert_expiry <= CURRENT_DATE + 30)::int,
    (SELECT count(*) FROM ac WHERE has_valid_cert AND NOT has_nonexpiring_cert AND max_cert_expiry <= CURRENT_DATE + 90)::int,
    (SELECT count(*) FROM ac WHERE has_valid_cert AND NOT has_nonexpiring_cert AND max_cert_expiry <= CURRENT_DATE + 180)::int,
    (SELECT count(*) FROM ac WHERE is_certified_flag AND NOT has_valid_cert)::int,
    (SELECT count(*) FROM val_arch)::int,
    round((SELECT count(*) FROM val_arch)::numeric / NULLIF((SELECT count(*) FROM ac), 0), 2),
    (SELECT count(*) FROM sch_cov)::int,
    (SELECT count(*) FROM sch WHERE id NOT IN (SELECT school_id FROM sch_cov))::int,
    (SELECT count(DISTINCT pld_id)   FROM ac WHERE pld_id   IS NOT NULL)::int,
    (SELECT count(DISTINCT state_id) FROM ac WHERE state_id IS NOT NULL)::int,
    round((SELECT COALESCE(sum(active_links), 0) FROM link_agg)::numeric / NULLIF((SELECT count(*) FROM ac), 0), 2),
    (SELECT count(*) FROM ac WHERE id NOT IN (SELECT coach_id FROM link_agg WHERE active_links > 0))::int,
    (SELECT count(*) FROM coach_act WHERE has_active_link AND NOT has_active_student)::int,
    (SELECT count(*) FROM coaching.coach_archer_links cal JOIN ac ON ac.id = cal.coach_id WHERE cal.status = 'pending')::int;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_coach_coverage_summary(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_coach_coverage_summary(jsonb) TO authenticated;


-- ─── COVERAGE BREAKDOWN (grouped) ──────────────────────────────
-- p_group_by ∈ state | pld | school | certification_level | certification_status
--              | specialization | experience_band | gender | coach_status
-- Operates over APPROVED coaches, except 'coach_status' which spans all
-- statuses to show the approved/pending/inactive split. specialization
-- UNNESTs the array (a coach appears once per specialization).
CREATE OR REPLACE FUNCTION public.kpm_coach_coverage_breakdown(
  p_group_by text  DEFAULT 'state',
  p_filters  jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  group_key text, group_label text,
  coaches int, certified int, uncertified int, expired int, expiring_soon int,
  avg_experience numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pop AS (
    SELECT * FROM public.kpm_scoped_coaches(p_filters)
    WHERE p_group_by = 'coach_status' OR status = 'approved'
  ),
  keyed AS (
    -- Non-specialization dimensions: one row per coach.
    SELECT
      CASE p_group_by
        WHEN 'state'                THEN b.state_id::text
        WHEN 'pld'                  THEN b.pld_id::text
        WHEN 'school'               THEN b.school_id::text
        WHEN 'certification_level'  THEN b.eff_level
        WHEN 'certification_status' THEN b.cert_status
        WHEN 'gender'               THEN b.gender
        WHEN 'coach_status'         THEN b.status
        WHEN 'experience_band'      THEN CASE
               WHEN b.experience_years IS NULL THEN 'Unknown'
               WHEN b.experience_years <= 2 THEN '0-2'
               WHEN b.experience_years <= 5 THEN '3-5'
               WHEN b.experience_years <= 10 THEN '6-10'
               ELSE '10+' END
      END AS gkey,
      b.id, b.has_valid_cert, b.has_expired_cert, b.has_nonexpiring_cert,
      b.max_cert_expiry, b.experience_years
    FROM pop b
    WHERE p_group_by <> 'specialization'
    UNION ALL
    -- specialization: one row per (coach × specialization tag).
    SELECT
      s.tag AS gkey,
      b.id, b.has_valid_cert, b.has_expired_cert, b.has_nonexpiring_cert,
      b.max_cert_expiry, b.experience_years
    FROM pop b, unnest(COALESCE(b.specialization, ARRAY[]::text[])) AS s(tag)
    WHERE p_group_by = 'specialization'
  )
  SELECT
    gkey,
    COALESCE(gkey, '—'),
    count(DISTINCT id)::int,
    (count(DISTINCT id) FILTER (WHERE has_valid_cert))::int,
    (count(DISTINCT id) FILTER (WHERE NOT has_valid_cert))::int,
    (count(DISTINCT id) FILTER (WHERE NOT has_valid_cert AND has_expired_cert))::int,
    (count(DISTINCT id) FILTER (WHERE has_valid_cert AND NOT has_nonexpiring_cert AND max_cert_expiry <= CURRENT_DATE + 180))::int,
    round(avg(experience_years), 1)
  FROM keyed
  GROUP BY gkey
  ORDER BY count(DISTINCT id) DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_coach_coverage_breakdown(text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_coach_coverage_breakdown(text, jsonb) TO authenticated;


-- ─── COACH WORKLOAD (per-coach list) ───────────────────────────
-- Approved coaches with link counts + whether their active students have
-- any score/training activity in the window. has_recent_activity=false on
-- a coach WITH active links flags a "stale" coaching relationship.
CREATE OR REPLACE FUNCTION public.kpm_coach_workload(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  coach_id uuid, coach_name text, state text, pld text, school text,
  cert_status text, linked_total int, linked_active int, linked_inactive int,
  pending_links int, active_students_with_activity int, has_recent_activity boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH co AS (SELECT * FROM public.kpm_scoped_coaches(p_filters) WHERE status = 'approved'),
       active_arch AS (
         SELECT archer_id FROM public.kpm_filtered_scores(p_filters)
         UNION
         SELECT archer_id FROM public.kpm_filtered_training(p_filters)
       ),
       links AS (
         SELECT cal.coach_id,
           count(*)::int AS linked_total,
           (count(*) FILTER (WHERE cal.status = 'active'))::int   AS linked_active,
           (count(*) FILTER (WHERE cal.status = 'inactive'))::int AS linked_inactive,
           (count(*) FILTER (WHERE cal.status = 'pending'))::int  AS pending_links,
           (count(*) FILTER (WHERE cal.status = 'active' AND aa.archer_id IS NOT NULL))::int AS active_students_activity
         FROM coaching.coach_archer_links cal
         JOIN co ON co.id = cal.coach_id
         LEFT JOIN (SELECT DISTINCT archer_id FROM active_arch) aa ON aa.archer_id = cal.archer_id
         GROUP BY cal.coach_id
       )
  SELECT
    co.id, p.name, st.name, pl.name, sc.name, co.cert_status,
    COALESCE(l.linked_total, 0), COALESCE(l.linked_active, 0), COALESCE(l.linked_inactive, 0),
    COALESCE(l.pending_links, 0), COALESCE(l.active_students_activity, 0),
    COALESCE(l.active_students_activity, 0) > 0
  FROM co
  JOIN core.profiles p ON p.id = co.id
  LEFT JOIN org.states  st ON st.id = co.state_id
  LEFT JOIN org.plds    pl ON pl.id = co.pld_id
  LEFT JOIN org.schools sc ON sc.id = co.school_id
  LEFT JOIN links l ON l.coach_id = co.id
  ORDER BY COALESCE(l.linked_active, 0) DESC, p.name;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_coach_workload(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_coach_workload(jsonb) TO authenticated;


-- ─── CERTIFICATION EXPIRY (per-coach list) ─────────────────────
-- Approved coaches that have a certification record (valid or expired),
-- ordered soonest-to-lapse / most-overdue first. days_to_expiry is NULL
-- for a non-expiring certification, negative when already expired.
CREATE OR REPLACE FUNCTION public.kpm_certification_expiry(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  coach_id uuid, coach_name text, state text, pld text, school text,
  cert_status text, latest_cert_level text, max_cert_expiry date, days_to_expiry int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH co AS (
    SELECT * FROM public.kpm_scoped_coaches(p_filters)
    WHERE status = 'approved' AND (has_valid_cert OR has_expired_cert)
  )
  SELECT
    co.id, p.name, st.name, pl.name, sc.name,
    co.cert_status, co.latest_cert_level, co.max_cert_expiry,
    CASE WHEN co.has_nonexpiring_cert THEN NULL
         WHEN co.max_cert_expiry IS NOT NULL THEN (co.max_cert_expiry - CURRENT_DATE) END
  FROM co
  JOIN core.profiles p ON p.id = co.id
  LEFT JOIN org.states  st ON st.id = co.state_id
  LEFT JOIN org.plds    pl ON pl.id = co.pld_id
  LEFT JOIN org.schools sc ON sc.id = co.school_id
  ORDER BY co.max_cert_expiry ASC NULLS LAST, p.name;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_certification_expiry(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_certification_expiry(jsonb) TO authenticated;


-- ─── NOTES / DATA LIMITATIONS ──────────────────────────────────
--  • "Too many archers / too few coaches" needs a KPM-defined ratio
--    threshold — NOT invented here. schools_without_active_coach (zero
--    coaches, objective) is provided; the raw archers_per_active_coach
--    ratio lets KPM apply its own threshold later.
--  • cert_status source of truth = certification.certifications;
--    is_certified is fallback only (see certified_by_flag_only).
--  • Expiring buckets are cumulative (≤30 ⊂ ≤90 ⊂ ≤180 days).
--  • ageGroup / bowCategory filters do not apply to coaches (ignored).
--  • No UI wired; typed service in src/services/kpmMetrics.ts.
