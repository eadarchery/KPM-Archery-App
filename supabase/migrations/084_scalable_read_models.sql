-- ============================================================
-- Migration 084: Scalable leaderboard/report read models
-- ------------------------------------------------------------
-- Run manually after 083, outside a busy period. Idempotent.
--
-- Live leaderboard views perform DISTINCT/window ranking work for every
-- browser request. These internal materialized views perform that work once;
-- approved callers receive small, cursor-paginated pages through guarded RPCs.
-- No client role receives direct access to the reporting schema.
--
-- After applying, enable Supabase Cron manually and call:
--   select public.refresh_leaderboard_snapshots();
-- every minute (or every 5 minutes until traffic justifies a shorter TTL).
-- ============================================================

CREATE SCHEMA IF NOT EXISTS reporting;
REVOKE ALL ON SCHEMA reporting FROM PUBLIC, anon, authenticated;

-- Remove dependent RPCs first so this migration remains safe to re-run while
-- evolving the internal materialized-view column list.
DROP FUNCTION IF EXISTS public.leaderboard_page(
  text, uuid, uuid, text, text, text, int, text, int, date, text, int
);
DROP FUNCTION IF EXISTS public.leaderboard_facets(text, uuid);
DROP FUNCTION IF EXISTS public.coach_leaderboard_page(numeric, uuid, int);
DROP FUNCTION IF EXISTS public.refresh_leaderboard_snapshots();

DROP MATERIALIZED VIEW IF EXISTS reporting.leaderboard_snapshot;
CREATE MATERIALIZED VIEW reporting.leaderboard_snapshot AS
WITH base AS (
  SELECT
    s.archer_id,
    s.round_id,
    p.name,
    p.archer_id AS archer_code,
    p.age,
    p.gender,
    p.state_id,
    p.school_id,
    p.pld_id,
    st.name AS state,
    st.code AS state_code,
    sc.name AS school,
    pl.name AS pld,
    COALESCE(s.bow_category, p.bow_category)::text AS bow_category,
    r.name AS round_name,
    r.category AS round_category,
    r.distance_m,
    COALESCE(
      p.birth_year,
      EXTRACT(YEAR FROM p.date_of_birth)::int,
      CASE WHEN p.age IS NOT NULL
           THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - p.age END
    ) AS birth_year,
    s.total_score AS best_score,
    s.max_score,
    s.date
  FROM scoring.score_submissions s
  JOIN core.profiles p ON p.id = s.archer_id
  JOIN scoring.rounds r ON r.id = s.round_id
  LEFT JOIN org.states st ON st.id = p.state_id
  LEFT JOIN org.schools sc ON sc.id = p.school_id
  LEFT JOIN org.plds pl ON pl.id = p.pld_id
  WHERE s.status = 'admin_approved'
    AND p.status = 'approved'
    AND p.role = 'archer'
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
      WHEN a.competition_age IS NULL THEN NULL
      WHEN a.competition_age <= 12 THEN 'U12'
      WHEN a.competition_age <= 15 THEN 'U15'
      WHEN a.competition_age <= 18 THEN 'U18'
      ELSE 'Open'
    END AS age_group
  FROM aged a
),
best AS (
  SELECT DISTINCT ON (archer_id, bow_category, round_category, distance_m)
    *
  FROM grouped
  ORDER BY archer_id, bow_category, round_category, distance_m,
           best_score DESC, date DESC
),
ranked AS (
  SELECT
    b.*,
    rank() OVER (
      PARTITION BY b.state_id, b.bow_category, b.round_category,
                   b.distance_m, b.age_group, b.gender
      ORDER BY b.best_score DESC, b.date DESC
    ) AS state_rank,
    rank() OVER (
      PARTITION BY b.bow_category, b.round_category,
                   b.distance_m, b.age_group, b.gender
      ORDER BY b.best_score DESC, b.date DESC
    ) AS national_rank
  FROM best b
)
SELECT
  r.archer_id::text || ':' || COALESCE(r.bow_category, '~') || ':' ||
    COALESCE(r.round_category, '~') || ':' || COALESCE(r.distance_m::text, '~') AS row_key,
  r.*
FROM ranked r;

CREATE UNIQUE INDEX reporting_leaderboard_snapshot_key_idx
  ON reporting.leaderboard_snapshot (row_key);
CREATE INDEX reporting_leaderboard_national_page_idx
  ON reporting.leaderboard_snapshot (best_score DESC, date DESC, row_key);
CREATE INDEX reporting_leaderboard_state_page_idx
  ON reporting.leaderboard_snapshot (state_id, best_score DESC, date DESC, row_key);
CREATE INDEX reporting_leaderboard_filters_idx
  ON reporting.leaderboard_snapshot
  (bow_category, round_category, distance_m, age_group, gender);

DROP MATERIALIZED VIEW IF EXISTS reporting.coach_leaderboard_snapshot;
CREATE MATERIALIZED VIEW reporting.coach_leaderboard_snapshot AS
WITH score_rollup AS (
  SELECT
    ss.archer_id AS coach_id,
    (array_agg(
      ss.total_score
      ORDER BY (ss.total_score::numeric / NULLIF(ss.max_score, 0)) DESC,
               ss.date DESC
    ))[1] AS best_score,
    (array_agg(
      ss.max_score
      ORDER BY (ss.total_score::numeric / NULLIF(ss.max_score, 0)) DESC,
               ss.date DESC
    ))[1] AS best_max,
    round(MAX(ss.total_score::numeric / NULLIF(ss.max_score, 0)) * 100, 1) AS best_pct,
    count(*) AS sessions,
    MAX(ss.date) AS last_date
  FROM scoring.score_submissions ss
  JOIN core.profiles cp
    ON cp.id = ss.archer_id
   AND cp.role = 'coach'
   AND cp.status = 'approved'
  WHERE ss.status = 'admin_approved'
  GROUP BY ss.archer_id
)
SELECT
  p.id::text AS row_key,
  p.id AS coach_id,
  p.name AS coach_name,
  s.name AS school_name,
  pl.name AS pld_name,
  sr.best_score,
  sr.best_max,
  sr.best_pct,
  sr.sessions,
  sr.last_date,
  row_number() OVER (ORDER BY sr.best_pct DESC NULLS LAST, p.id) AS rank
FROM score_rollup sr
JOIN core.profiles p ON p.id = sr.coach_id
LEFT JOIN org.schools s ON s.id = p.school_id
LEFT JOIN org.plds pl ON pl.id = p.pld_id;

CREATE UNIQUE INDEX reporting_coach_leaderboard_snapshot_key_idx
  ON reporting.coach_leaderboard_snapshot (row_key);
CREATE INDEX reporting_coach_leaderboard_page_idx
  ON reporting.coach_leaderboard_snapshot (best_pct DESC, coach_id);

REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM PUBLIC, anon, authenticated;

-- ─── Cursor-paginated archer leaderboard ───────────────────────────────────

CREATE FUNCTION public.leaderboard_page(
  p_scope          text DEFAULT 'national',
  p_state_id       uuid DEFAULT NULL,
  p_school_id      uuid DEFAULT NULL,
  p_bow_category   text DEFAULT NULL,
  p_gender         text DEFAULT NULL,
  p_round_category text DEFAULT NULL,
  p_distance_m     int DEFAULT NULL,
  p_age_group      text DEFAULT NULL,
  p_after_score    int DEFAULT NULL,
  p_after_date     date DEFAULT NULL,
  p_after_key      text DEFAULT NULL,
  p_limit          int DEFAULT 50
)
RETURNS TABLE (
  row_key text,
  archer_id uuid,
  name text,
  age int,
  gender text,
  state_id uuid,
  school_id uuid,
  pld_id uuid,
  state text,
  state_code text,
  school text,
  pld text,
  bow_category text,
  round_name text,
  round_category text,
  distance_m int,
  competition_age int,
  age_group text,
  best_score int,
  max_score int,
  date date,
  state_rank bigint,
  national_rank bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
BEGIN
  IF auth.uid() IS NULL OR NOT core.is_approved() THEN
    RAISE EXCEPTION 'Approved account required.' USING ERRCODE = '42501';
  END IF;
  IF p_scope NOT IN ('national', 'state') THEN
    RAISE EXCEPTION 'Invalid leaderboard scope.' USING ERRCODE = '22023';
  END IF;
  IF p_scope = 'state' AND p_state_id IS NULL THEN
    RAISE EXCEPTION 'State scope requires a state.' USING ERRCODE = '22023';
  END IF;
  IF p_after_score IS NOT NULL AND (p_after_date IS NULL OR p_after_key IS NULL) THEN
    RAISE EXCEPTION 'Incomplete leaderboard cursor.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    l.row_key, l.archer_id, l.name, l.age, l.gender,
    l.state_id, l.school_id, l.pld_id,
    l.state, l.state_code, l.school, l.pld,
    l.bow_category, l.round_name, l.round_category, l.distance_m,
    l.competition_age, l.age_group, l.best_score, l.max_score, l.date,
    l.state_rank, l.national_rank
  FROM reporting.leaderboard_snapshot l
  WHERE (p_scope = 'national' OR l.state_id = p_state_id)
    AND (p_school_id IS NULL OR l.school_id = p_school_id)
    AND (p_bow_category IS NULL OR l.bow_category = p_bow_category)
    AND (p_gender IS NULL OR l.gender = p_gender)
    AND (p_round_category IS NULL OR l.round_category = p_round_category)
    AND (p_distance_m IS NULL OR l.distance_m = p_distance_m)
    AND (p_age_group IS NULL OR l.age_group = p_age_group)
    AND (
      p_after_score IS NULL
      OR l.best_score < p_after_score
      OR (l.best_score = p_after_score AND l.date < p_after_date)
      OR (l.best_score = p_after_score AND l.date = p_after_date AND l.row_key > p_after_key)
    )
  ORDER BY l.best_score DESC, l.date DESC, l.row_key
  LIMIT v_limit + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.leaderboard_page(
  text, uuid, uuid, text, text, text, int, text, int, date, text, int
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_page(
  text, uuid, uuid, text, text, text, int, text, int, date, text, int
) TO authenticated;

CREATE FUNCTION public.leaderboard_facets(
  p_scope text DEFAULT 'national',
  p_state_id uuid DEFAULT NULL
)
RETURNS TABLE (round_categories text[], distances_m int[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT core.is_approved() THEN
    RAISE EXCEPTION 'Approved account required.' USING ERRCODE = '42501';
  END IF;
  IF p_scope NOT IN ('national', 'state') THEN
    RAISE EXCEPTION 'Invalid leaderboard scope.' USING ERRCODE = '22023';
  END IF;
  IF p_scope = 'state' AND p_state_id IS NULL THEN
    RETURN QUERY SELECT ARRAY[]::text[], ARRAY[]::int[];
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(
      array_agg(DISTINCT l.round_category ORDER BY l.round_category)
        FILTER (WHERE l.round_category IS NOT NULL),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT l.distance_m ORDER BY l.distance_m)
        FILTER (WHERE l.distance_m IS NOT NULL),
      ARRAY[]::int[]
    )
  FROM reporting.leaderboard_snapshot l
  WHERE p_scope = 'national' OR l.state_id = p_state_id;
END;
$$;

REVOKE ALL ON FUNCTION public.leaderboard_facets(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_facets(text, uuid) TO authenticated;

-- ─── Cursor-paginated coach leaderboard ────────────────────────────────────

CREATE FUNCTION public.coach_leaderboard_page(
  p_after_pct numeric DEFAULT NULL,
  p_after_coach uuid DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  coach_id uuid,
  coach_name text,
  school_name text,
  pld_name text,
  best_score int,
  best_max int,
  best_pct numeric,
  sessions bigint,
  last_date date,
  rank bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
BEGIN
  IF NOT (
    core.is_admin()
    OR (core.current_role() = 'coach' AND core.is_approved())
  ) THEN
    RAISE EXCEPTION 'Approved coach or administrator required.' USING ERRCODE = '42501';
  END IF;
  IF p_after_pct IS NOT NULL AND p_after_coach IS NULL THEN
    RAISE EXCEPTION 'Incomplete coach leaderboard cursor.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    c.coach_id, c.coach_name, c.school_name, c.pld_name,
    c.best_score, c.best_max, c.best_pct, c.sessions, c.last_date, c.rank
  FROM reporting.coach_leaderboard_snapshot c
  WHERE p_after_pct IS NULL
     OR c.best_pct < p_after_pct
     OR (c.best_pct = p_after_pct AND c.coach_id > p_after_coach)
  ORDER BY c.best_pct DESC NULLS LAST, c.coach_id
  LIMIT v_limit + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.coach_leaderboard_page(numeric, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_leaderboard_page(numeric, uuid, int) TO authenticated;

-- ─── Small report aggregates ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.report_validation_summary(
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  pending_training bigint,
  pending_tournament bigint,
  approved bigint,
  rejected bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    count(*) FILTER (
      WHERE s.status IN ('pending', 'coach_approved')
        AND s.round_category IS DISTINCT FROM 'tournament'
    )::bigint,
    count(*) FILTER (
      WHERE s.status IN ('pending', 'coach_approved')
        AND s.round_category = 'tournament'
    )::bigint,
    count(*) FILTER (WHERE s.status = 'admin_approved')::bigint,
    count(*) FILTER (WHERE s.status = 'rejected')::bigint
  FROM public.kpm_filtered_scores(p_filters) s
  WHERE (SELECT core.is_approved());
$$;

REVOKE ALL ON FUNCTION public.report_validation_summary(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_validation_summary(jsonb) TO authenticated;

-- ─── Cursor-paginated Admin user directory ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_users_page(
  p_search text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_state_id uuid DEFAULT NULL,
  p_pld_id uuid DEFAULT NULL,
  p_school_id uuid DEFAULT NULL,
  p_after_created timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid, email text, name text, age int, role text, status text,
  archer_code text, coach_id uuid, rejection_reason text,
  approved_by uuid, approved_at timestamptz, rejected_at timestamptz,
  rejected_by uuid, suspended_at timestamptz, suspended_by uuid,
  suspension_reason text, admin_notes text, phone text, gender text,
  bow_category text, avatar_url text, is_pld_coach boolean,
  school_id uuid, pld_id uuid, state_id uuid, requested_school_id uuid,
  created_at timestamptz, updated_at timestamptz,
  school_name text, pld_name text, state_name text, state_code text,
  link_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_search text := NULLIF(trim(p_search), '');
BEGIN
  IF NOT core.is_admin() THEN
    RAISE EXCEPTION 'Administrator required.' USING ERRCODE = '42501';
  END IF;
  IF p_after_created IS NOT NULL AND p_after_id IS NULL THEN
    RAISE EXCEPTION 'Incomplete user cursor.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.email, p.name, p.age, p.role::text, p.status,
    p.archer_id, p.coach_id, p.rejection_reason,
    p.approved_by, p.approved_at, p.rejected_at,
    p.rejected_by, p.suspended_at, p.suspended_by,
    p.suspension_reason, p.admin_notes, p.phone, p.gender,
    p.bow_category::text, p.avatar_url, p.is_pld_coach,
    p.school_id, p.pld_id, p.state_id, p.requested_school_id,
    p.created_at, p.updated_at,
    sc.name, pl.name, st.name, st.code,
    CASE
      WHEN p.role = 'coach' THEN (
        SELECT count(*) FROM coaching.coach_archer_links cal
        WHERE cal.coach_id = p.id AND cal.status = 'active'
      )
      WHEN p.role = 'archer' THEN (
        SELECT count(*) FROM coaching.coach_archer_links cal
        WHERE cal.archer_id = p.id AND cal.status = 'active'
      )
      ELSE 0
    END
  FROM core.profiles p
  LEFT JOIN org.schools sc ON sc.id = p.school_id
  LEFT JOIN org.plds pl ON pl.id = p.pld_id
  LEFT JOIN org.states st ON st.id = p.state_id
  WHERE (p_role IS NULL OR p.role::text = p_role)
    AND (p_status IS NULL OR p.status = p_status)
    AND (p_state_id IS NULL OR p.state_id = p_state_id)
    AND (p_pld_id IS NULL OR p.pld_id = p_pld_id)
    AND (p_school_id IS NULL OR p.school_id = p_school_id)
    AND (
      v_search IS NULL
      OR lower(COALESCE(p.name, '')) LIKE '%' || lower(v_search) || '%'
      OR lower(COALESCE(p.email, '')) LIKE '%' || lower(v_search) || '%'
      OR lower(COALESCE(p.archer_id, '')) LIKE '%' || lower(v_search) || '%'
    )
    AND (
      p_after_created IS NULL
      OR (p.created_at, p.id) < (p_after_created, p_after_id)
    )
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT v_limit + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_users_page(
  text, text, text, uuid, uuid, uuid, timestamptz, uuid, int
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_users_page(
  text, text, text, uuid, uuid, uuid, timestamptz, uuid, int
) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_user_summary()
RETURNS TABLE (
  total bigint, pending bigint, approved bigint, rejected bigint, suspended bigint,
  archers bigint, coaches bigint, admin1 bigint, admin2 bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE p.status = 'pending'),
    count(*) FILTER (WHERE p.status = 'approved'),
    count(*) FILTER (WHERE p.status = 'rejected'),
    count(*) FILTER (WHERE p.status = 'suspended'),
    count(*) FILTER (WHERE p.role = 'archer'),
    count(*) FILTER (WHERE p.role = 'coach'),
    count(*) FILTER (WHERE p.role = 'admin1'),
    count(*) FILTER (WHERE p.role = 'admin2')
  FROM core.profiles p
  WHERE (SELECT core.is_admin());
$$;

REVOKE ALL ON FUNCTION public.admin_user_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_user_links(p_user uuid)
RETURNS TABLE (
  id uuid, coach_id uuid, archer_id uuid, status text,
  linked_at timestamptz, unlinked_at timestamptz,
  other_id uuid, other_name text, other_archer_code text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    cal.id, cal.coach_id, cal.archer_id, cal.status,
    cal.linked_at, cal.unlinked_at,
    other.id, other.name, other.archer_id
  FROM coaching.coach_archer_links cal
  JOIN core.profiles other
    ON other.id = CASE WHEN cal.coach_id = p_user THEN cal.archer_id ELSE cal.coach_id END
  WHERE (SELECT core.is_admin())
    AND cal.status = 'active'
    AND (cal.coach_id = p_user OR cal.archer_id = p_user)
  ORDER BY cal.linked_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_user_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_links(uuid) TO authenticated;

-- ─── Refresh entry point for Supabase Cron ──────────────────────────────────

CREATE FUNCTION public.refresh_leaderboard_snapshots()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY reporting.leaderboard_snapshot;
  REFRESH MATERIALIZED VIEW CONCURRENTLY reporting.coach_leaderboard_snapshot;
  RETURN clock_timestamp();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_leaderboard_snapshots() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_leaderboard_snapshots() TO service_role;

-- Indexes for the live write tables feeding refreshes and report RPCs.
CREATE INDEX IF NOT EXISTS scoring_submissions_reporting_idx
  ON scoring.score_submissions (archer_id, date DESC, status)
  INCLUDE (round_id, total_score, max_score);
CREATE INDEX IF NOT EXISTS scoring_submissions_leaderboard_idx
  ON scoring.score_submissions (archer_id, round_id, total_score DESC, date DESC)
  INCLUDE (max_score, bow_category)
  WHERE status = 'admin_approved';
CREATE INDEX IF NOT EXISTS core_profiles_archer_state_idx
  ON core.profiles (state_id, id) WHERE role = 'archer';
CREATE INDEX IF NOT EXISTS core_profiles_archer_pld_idx
  ON core.profiles (pld_id, id) WHERE role = 'archer';
CREATE INDEX IF NOT EXISTS core_profiles_archer_school_idx
  ON core.profiles (school_id, id) WHERE role = 'archer';
CREATE INDEX IF NOT EXISTS coaching_cal_active_archer_coach_idx
  ON coaching.coach_archer_links (archer_id, coach_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS core_profiles_admin_page_idx
  ON core.profiles (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS core_profiles_admin_status_role_page_idx
  ON core.profiles (status, role, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS core_profiles_name_trgm_idx
  ON core.profiles USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS core_profiles_email_trgm_idx
  ON core.profiles USING gin (lower(email) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS core_profiles_archer_code_trgm_idx
  ON core.profiles USING gin (lower(archer_id) gin_trgm_ops);

NOTIFY pgrst, 'reload schema';
