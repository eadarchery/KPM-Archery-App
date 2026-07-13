-- ============================================================
-- Migration 059: Calendar-year age groups, category/distance-aware
--                leaderboard, and unlinked-archer admin validation
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run. Run AFTER 050 and 057.
--
--   NOTE ON NUMBERING: the previous migration set had duplicate 055/056/057
--   filenames. The highest real migration is 058_preferred_language. This file
--   is 059 — the next free number — and only ADDS objects; it never edits or
--   drops prior migrations' data.
--
-- Delivers four things:
--   1. profiles.birth_year — the basis for calendar-year (competition) age.
--      Backfilled from date_of_birth, else derived from the legacy age column.
--   2. score_submissions age snapshot — competition_year / competition_age /
--      age_group frozen at submission time (badges + history stay correct when
--      the archer moves up a group next year). age_group CHECK widened to the
--      U12/U15/U18/Open system while still accepting legacy rows.
--   3. public.leaderboard rebuilt: best score per archer × bow × round category
--      × distance, with LIVE competition age group, and ranks partitioned by
--      (…+ age group) for both state and national. Auto-rolls every 1 January.
--   4. Unlinked-archer admin validation: scoped SECURITY DEFINER RPCs so
--      Admin 1 (within scope) and Admin 2 can list unlinked archers and
--      approve/reject the pending scores of archers who have no active coach.
--
-- Nothing here removes a permission, RLS policy, audit path or approval control.
-- ============================================================


-- ─── 1. PROFILE BIRTH YEAR ─────────────────────────────────────

ALTER TABLE core.profiles
  ADD COLUMN IF NOT EXISTS birth_year int;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'core_profiles_birth_year_check') THEN
    ALTER TABLE core.profiles ADD CONSTRAINT core_profiles_birth_year_check
      CHECK (birth_year IS NULL OR (birth_year BETWEEN 1900 AND 2100));
  END IF;
END $$;

-- Backfill: prefer an explicit date_of_birth, else derive from the legacy `age`
-- column against the current year. Never overwrite a birth_year already set.
UPDATE core.profiles
   SET birth_year = EXTRACT(YEAR FROM date_of_birth)::int
 WHERE birth_year IS NULL AND date_of_birth IS NOT NULL;

UPDATE core.profiles
   SET birth_year = EXTRACT(YEAR FROM CURRENT_DATE)::int - age
 WHERE birth_year IS NULL AND age IS NOT NULL AND age BETWEEN 1 AND 120;

-- Refresh the passthrough view so PostgREST exposes birth_year.
CREATE OR REPLACE VIEW public.profiles WITH (security_invoker = true) AS
SELECT * FROM core.profiles;


-- ─── 2. SCORE AGE-GROUP SNAPSHOT ───────────────────────────────
-- Frozen at submission so tournament results and badges keep the group the
-- archer competed in, even after the calendar year rolls over.

ALTER TABLE scoring.score_submissions
  ADD COLUMN IF NOT EXISTS competition_year int,
  ADD COLUMN IF NOT EXISTS competition_age  int;

-- Widen the legacy age_group CHECK (was u14/u18/u21/open) to accept the new
-- U12/U15/U18/Open system while still allowing any legacy rows already stored.
ALTER TABLE scoring.score_submissions
  DROP CONSTRAINT IF EXISTS score_submissions_age_group_check;
ALTER TABLE scoring.score_submissions
  ADD CONSTRAINT score_submissions_age_group_check
  CHECK (age_group IS NULL OR age_group IN
    ('U12','U15','U18','Open','u12','u14','u15','u18','u21','open'));

-- Backfill the snapshot for existing admin-relevant rows where we can derive a
-- birth year. Uses the submission's own date year as the competition year so a
-- 2024 score keeps its 2024 group. Legacy rows with no birth basis stay NULL
-- (the UI shows them as "—", never a wrong group).
WITH derived AS (
  SELECT s.id,
         EXTRACT(YEAR FROM s.date)::int AS c_year,
         COALESCE(
           p.birth_year,
           EXTRACT(YEAR FROM p.date_of_birth)::int,
           CASE WHEN p.age IS NOT NULL THEN EXTRACT(YEAR FROM s.date)::int - p.age END
         ) AS b_year
  FROM scoring.score_submissions s
  JOIN core.profiles p ON p.id = s.archer_id
)
UPDATE scoring.score_submissions s
   SET competition_year = d.c_year,
       competition_age  = d.c_year - d.b_year,
       age_group = CASE
         WHEN d.b_year IS NULL THEN s.age_group
         WHEN (d.c_year - d.b_year) <= 12 THEN 'U12'
         WHEN (d.c_year - d.b_year) <= 15 THEN 'U15'
         WHEN (d.c_year - d.b_year) <= 18 THEN 'U18'
         ELSE 'Open'
       END
  FROM derived d
 WHERE d.id = s.id
   AND d.b_year IS NOT NULL
   AND s.competition_age IS NULL;   -- only fill rows not yet snapshotted


-- ─── 3. LEADERBOARD VIEW (category + distance + live age group) ─
-- Best admin-approved score per archer × bow category × round category ×
-- distance. Age group is computed LIVE from birth_year against the current
-- year, so every 1 January archers roll into the correct group automatically.
--
-- Ranks:
--   • state_rank    — PARTITION BY state, bow, round_category, distance, age_group
--   • national_rank — PARTITION BY bow, round_category, distance, age_group
-- (Ranking is always within an age group, so a clean board appears once the
--  page filters by category/distance/age; unfiltered, each group keeps its own
--  #1 — the frontend shows those dimensions on every row.)

DROP VIEW IF EXISTS public.leaderboard;
CREATE VIEW public.leaderboard AS
WITH base AS (
  SELECT
    s.archer_id,
    s.round_id,
    p.name                                  AS name,
    p.archer_id                             AS archer_code,
    p.age                                   AS age,
    p.state_id, p.school_id, p.pld_id,
    st.name                                 AS state,
    st.code                                 AS state_code,
    sc.name                                 AS school,
    pl.name                                 AS pld,
    COALESCE(s.bow_category, p.bow_category) AS bow_category,
    r.name                                  AS round_name,
    r.category                              AS round_category,
    r.distance_m                            AS distance_m,
    COALESCE(
      p.birth_year,
      EXTRACT(YEAR FROM p.date_of_birth)::int,
      CASE WHEN p.age IS NOT NULL THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - p.age END
    )                                       AS birth_year,
    s.total_score                           AS best_score,
    s.max_score,
    s.date
  FROM scoring.score_submissions s
  JOIN core.profiles    p  ON p.id  = s.archer_id
  JOIN scoring.rounds   r  ON r.id  = s.round_id
  LEFT JOIN org.states  st ON st.id = p.state_id
  LEFT JOIN org.schools sc ON sc.id = p.school_id
  LEFT JOIN org.plds    pl ON pl.id = p.pld_id
  WHERE s.status = 'admin_approved'
    AND p.status = 'approved'
    AND p.role   = 'archer'
),
aged AS (
  SELECT
    b.*,
    EXTRACT(YEAR FROM CURRENT_DATE)::int AS competition_year,
    CASE WHEN b.birth_year IS NOT NULL
         THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - b.birth_year END AS competition_age
  FROM base b
),
grouped AS (
  SELECT
    a.*,
    CASE
      WHEN a.competition_age IS NULL      THEN NULL
      WHEN a.competition_age <= 12        THEN 'U12'
      WHEN a.competition_age <= 15        THEN 'U15'
      WHEN a.competition_age <= 18        THEN 'U18'
      ELSE 'Open'
    END AS age_group
  FROM aged a
),
best AS (
  SELECT DISTINCT ON (archer_id, bow_category, round_category, distance_m)
    *
  FROM grouped
  ORDER BY archer_id, bow_category, round_category, distance_m, best_score DESC, date DESC
)
SELECT
  b.*,
  RANK() OVER (PARTITION BY b.state_id, b.bow_category, b.round_category, b.distance_m, b.age_group
               ORDER BY b.best_score DESC, b.date DESC) AS state_rank,
  RANK() OVER (PARTITION BY b.bow_category, b.round_category, b.distance_m, b.age_group
               ORDER BY b.best_score DESC, b.date DESC) AS national_rank
FROM best b;

GRANT SELECT ON public.leaderboard TO authenticated;


-- ─── 4. UNLINKED-ARCHER ADMIN VALIDATION ───────────────────────
-- An archer with no ACTIVE coach link has nobody to validate their scores.
-- These helpers let Admin 1 (within scope) and Admin 2 / Super Admin see and
-- validate those archers' pending scores, without loosening any table policy.

-- 4a. Does this archer currently have an active coach link?
CREATE OR REPLACE FUNCTION core.archer_has_active_coach(p_archer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM coaching.coach_archer_links
    WHERE archer_id = p_archer AND status = 'active'
  );
$$;
REVOKE ALL     ON FUNCTION core.archer_has_active_coach(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION core.archer_has_active_coach(uuid) TO authenticated;

-- 4b. Can the CALLER validate this archer? admin2/super = yes; admin1 = only
--     within their assigned scope (reuses core.admin1_in_scope from 052).
CREATE OR REPLACE FUNCTION core.can_admin_validate_archer(p_archer uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role  text;
  v_state uuid; v_pld uuid; v_school uuid;
BEGIN
  SELECT role::text INTO v_role FROM core.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role IN ('admin2','super_admin') THEN RETURN true; END IF;
  IF v_role <> 'admin1' THEN RETURN false; END IF;

  SELECT state_id, pld_id, school_id INTO v_state, v_pld, v_school
  FROM core.profiles WHERE id = p_archer;
  RETURN core.admin1_in_scope(auth.uid(), v_state, v_pld, v_school);
END $$;
REVOKE ALL     ON FUNCTION core.can_admin_validate_archer(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION core.can_admin_validate_archer(uuid) TO authenticated;

-- 4c. Approved archers with NO active coach link, scoped to the caller.
--     Powers the "Unlinked archers" admin list/alert (Task 10).
CREATE OR REPLACE FUNCTION public.admin_unlinked_archers()
RETURNS TABLE (
  id uuid, name text, archer_id text, email text,
  state_id uuid, pld_id uuid, school_id uuid,
  state_name text, pld_name text, school_name text,
  last_coach_name text, last_score_date date
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.name, p.archer_id, p.email,
    p.state_id, p.pld_id, p.school_id,
    st.name, pl.name, sc.name,
    lc.name AS last_coach_name,
    ls.last_date AS last_score_date
  FROM core.profiles p
  LEFT JOIN org.states  st ON st.id = p.state_id
  LEFT JOIN org.plds    pl ON pl.id = p.pld_id
  LEFT JOIN org.schools sc ON sc.id = p.school_id
  -- most recent coach link (active or not) → "last coach"
  LEFT JOIN LATERAL (
    SELECT cp.name
    FROM coaching.coach_archer_links cal
    JOIN core.profiles cp ON cp.id = cal.coach_id
    WHERE cal.archer_id = p.id
    ORDER BY cal.linked_at DESC NULLS LAST
    LIMIT 1
  ) lc ON true
  LEFT JOIN LATERAL (
    SELECT max(s.date) AS last_date
    FROM scoring.score_submissions s
    WHERE s.archer_id = p.id
  ) ls ON true
  WHERE p.role = 'archer'
    AND p.status = 'approved'
    AND NOT core.archer_has_active_coach(p.id)
    AND core.can_admin_validate_archer(p.id)
  ORDER BY ls.last_date DESC NULLS LAST, p.name;
END $$;
REVOKE ALL     ON FUNCTION public.admin_unlinked_archers() FROM public;
GRANT  EXECUTE ON FUNCTION public.admin_unlinked_archers() TO authenticated;

-- 4d. Pending scores of unlinked archers, scoped to the caller (Task 9 queue).
CREATE OR REPLACE FUNCTION public.admin_unlinked_pending_scores()
RETURNS TABLE (
  id uuid, archer_id uuid, archer_name text, archer_code text,
  round_id uuid, round_name text, round_category text,
  total_score int, max_score int, date date,
  bow_category text, age_group text, proof_url text,
  state_id uuid, pld_id uuid, school_id uuid,
  school_name text, state_code text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.archer_id, p.name, p.archer_id,
    s.round_id, r.name, r.category,
    s.total_score, s.max_score, s.date,
    s.bow_category::text, s.age_group, s.proof_url,
    p.state_id, p.pld_id, p.school_id,
    sc.name, st.code, s.created_at
  FROM scoring.score_submissions s
  JOIN core.profiles    p  ON p.id  = s.archer_id
  JOIN scoring.rounds   r  ON r.id  = s.round_id
  LEFT JOIN org.schools sc ON sc.id = p.school_id
  LEFT JOIN org.states  st ON st.id = p.state_id
  WHERE s.status = 'pending'
    AND p.role = 'archer'
    AND NOT core.archer_has_active_coach(s.archer_id)
    AND core.can_admin_validate_archer(s.archer_id)
  ORDER BY s.created_at ASC;
END $$;
REVOKE ALL     ON FUNCTION public.admin_unlinked_pending_scores() FROM public;
GRANT  EXECUTE ON FUNCTION public.admin_unlinked_pending_scores() TO authenticated;

-- 4e. Approve / reject a pending score of an UNLINKED archer, scoped.
--     approve → admin_approved (counts on the leaderboard, grants badges via
--     the existing trigger); reject → rejected with reason. Guard trigger from
--     033 still runs; here auth.uid() is an admin so admin fields are allowed.
CREATE OR REPLACE FUNCTION public.admin_validate_unlinked_score(
  p_id uuid, p_approve boolean, p_reason text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_archer uuid;
  v_status text;
  v_name   text;
BEGIN
  SELECT s.archer_id, s.status INTO v_archer, v_status
  FROM scoring.score_submissions s WHERE s.id = p_id;
  IF v_archer IS NULL THEN
    RAISE EXCEPTION 'Score not found.';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending score can be validated here.';
  END IF;
  IF core.archer_has_active_coach(v_archer) THEN
    RAISE EXCEPTION 'This archer has an active coach — use the coach validation flow.';
  END IF;
  IF NOT core.can_admin_validate_archer(v_archer) THEN
    RAISE EXCEPTION 'This archer is outside your validation scope.';
  END IF;

  SELECT name INTO v_name FROM core.profiles WHERE id = v_archer;

  IF p_approve THEN
    UPDATE scoring.score_submissions
       SET status = 'admin_approved',
           admin_approved_at = now(),
           approved_by = auth.uid(),
           rejection_reason = NULL
     WHERE id = p_id;
    -- Badges: same path admin approval uses elsewhere.
    PERFORM public.check_and_grant_achievements(v_archer);
    PERFORM public.log_audit(auth.uid(), 'score.admin_validated_unlinked', 'score_submission', p_id,
      jsonb_build_object('archer_name', v_name));
  ELSE
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
      RAISE EXCEPTION 'A rejection reason is required.';
    END IF;
    UPDATE scoring.score_submissions
       SET status = 'rejected', rejection_reason = trim(p_reason)
     WHERE id = p_id;
    PERFORM public.log_audit(auth.uid(), 'score.admin_rejected_unlinked', 'score_submission', p_id,
      jsonb_build_object('archer_name', v_name, 'reason', trim(p_reason)));
  END IF;
END $$;
REVOKE ALL     ON FUNCTION public.admin_validate_unlinked_score(uuid, boolean, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.admin_validate_unlinked_score(uuid, boolean, text) TO authenticated;

-- ─── NOTES ─────────────────────────────────────────────────────
--  • birth_year is self-editable by the archer: the 031–033 profile self-guard
--    locks role/status/scope/coach only, so an archer updating their own
--    birth_year/date_of_birth passes RLS with no new policy needed.
--  • The unlinked RPCs are SECURITY DEFINER but every one re-checks the caller
--    via can_admin_validate_archer, so Admin 1 can only ever see/act within
--    their assigned scope; Admin 2 / Super Admin keep their existing full reach.
--  • Coaches and normal linked-archer validation are untouched — an archer WITH
--    an active coach never appears in these queues (the RPCs exclude them).
