-- ============================================================
-- Migration 025: Reports / Analytics Foundation
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--
-- Read-only aggregate views that power the Admin 2 national and Admin 1
-- scoped report pages WITHOUT shipping every score/profile row to the client.
--
-- No new tables, no data changes. All views are security_invoker = true, so
-- each caller only aggregates rows their existing RLS already lets them read:
--   • admin2 / super_admin  → national (core.is_admin / admin2_full policies)
--   • admin1                → national READ (admin1_read_all / admin1_reads),
--                             the Admin 1 page narrows to assigned scope on top
--   • archer / coach        → their own RLS slice (they never call these)
--
-- Score-based metrics count ONLY status = 'admin_approved' (validated). The
-- cross-join inflation problem is avoided by expanding profiles→scores in a
-- CTE and pulling school counts from a separate subquery.
-- ============================================================

-- ─── STATE ACTIVITY ──────────────────────────────────────────
CREATE OR REPLACE VIEW public.report_state_activity
  WITH (security_invoker = true) AS
WITH archer_scores AS (
  SELECT p.id AS profile_id, p.role, p.status AS profile_status,
         p.state_id, p.pld_id, p.school_id,
         s.id AS score_id, s.status AS score_status, s.total_score
  FROM core.profiles p
  LEFT JOIN scoring.score_submissions s ON s.archer_id = p.id
),
school_counts AS (
  SELECT state_id, count(*) FILTER (WHERE active) AS schools_total
  FROM org.schools GROUP BY state_id
)
SELECT
  st.id   AS state_id,
  st.name AS state,
  st.code AS state_code,
  count(DISTINCT a.profile_id) FILTER (WHERE a.role = 'archer')                                  AS registered_archers,
  count(DISTINCT a.profile_id) FILTER (WHERE a.role = 'archer' AND a.score_status = 'admin_approved') AS active_archers,
  count(DISTINCT a.profile_id) FILTER (WHERE a.role = 'coach')                                   AS coaches,
  COALESCE(scs.schools_total, 0)                                                                 AS schools_total,
  count(DISTINCT a.school_id)  FILTER (WHERE a.score_status = 'admin_approved')                  AS schools_reporting,
  count(a.score_id)                                                                              AS scores_submitted,
  count(a.score_id)            FILTER (WHERE a.score_status = 'admin_approved')                  AS approved_scores,
  COALESCE(round(avg(a.total_score) FILTER (WHERE a.score_status = 'admin_approved'))::int, 0)   AS avg_score,
  COALESCE(max(a.total_score)       FILTER (WHERE a.score_status = 'admin_approved'), 0)         AS top_score
FROM org.states st
LEFT JOIN archer_scores a ON a.state_id = st.id
LEFT JOIN school_counts scs ON scs.state_id = st.id
GROUP BY st.id, st.name, st.code, scs.schools_total;

GRANT SELECT ON public.report_state_activity TO authenticated;

-- ─── PLD ACTIVITY ────────────────────────────────────────────
CREATE OR REPLACE VIEW public.report_pld_activity
  WITH (security_invoker = true) AS
WITH archer_scores AS (
  SELECT p.id AS profile_id, p.role, p.pld_id, p.school_id,
         s.id AS score_id, s.status AS score_status, s.total_score
  FROM core.profiles p
  LEFT JOIN scoring.score_submissions s ON s.archer_id = p.id
),
school_counts AS (
  SELECT pld_id, count(*) FILTER (WHERE active) AS schools_total
  FROM org.schools WHERE pld_id IS NOT NULL GROUP BY pld_id
)
SELECT
  pl.id    AS pld_id,
  pl.name  AS pld,
  pl.state_id,
  st.name  AS state,
  st.code  AS state_code,
  count(DISTINCT a.profile_id) FILTER (WHERE a.role = 'archer')                                  AS registered_archers,
  count(DISTINCT a.profile_id) FILTER (WHERE a.role = 'archer' AND a.score_status = 'admin_approved') AS active_archers,
  count(DISTINCT a.profile_id) FILTER (WHERE a.role = 'coach')                                   AS coaches,
  COALESCE(scs.schools_total, 0)                                                                 AS schools_total,
  count(DISTINCT a.school_id)  FILTER (WHERE a.score_status = 'admin_approved')                  AS schools_reporting,
  count(a.score_id)                                                                              AS scores_submitted,
  count(a.score_id)            FILTER (WHERE a.score_status = 'admin_approved')                  AS approved_scores,
  COALESCE(max(a.total_score)  FILTER (WHERE a.score_status = 'admin_approved'), 0)              AS top_score
FROM org.plds pl
JOIN org.states st ON st.id = pl.state_id
LEFT JOIN archer_scores a ON a.pld_id = pl.id
LEFT JOIN school_counts scs ON scs.pld_id = pl.id
GROUP BY pl.id, pl.name, pl.state_id, st.name, st.code, scs.schools_total;

GRANT SELECT ON public.report_pld_activity TO authenticated;

-- ─── SCHOOL ACTIVITY ─────────────────────────────────────────
CREATE OR REPLACE VIEW public.report_school_activity
  WITH (security_invoker = true) AS
WITH profile_scores AS (
  SELECT p.id AS profile_id, p.role, p.school_id,
         s.id AS score_id, s.status AS score_status, s.date AS score_date
  FROM core.profiles p
  LEFT JOIN scoring.score_submissions s ON s.archer_id = p.id
)
SELECT
  sc.id    AS school_id,
  sc.name  AS school,
  sc.pld_id,
  pl.name  AS pld,
  sc.state_id,
  st.name  AS state,
  st.code  AS state_code,
  sc.active,
  count(DISTINCT ps.profile_id) FILTER (WHERE ps.role = 'archer')                                  AS registered_archers,
  count(DISTINCT ps.profile_id) FILTER (WHERE ps.role = 'archer' AND ps.score_status = 'admin_approved') AS active_archers,
  count(DISTINCT ps.profile_id) FILTER (WHERE ps.role = 'coach')                                   AS coaches,
  count(ps.score_id)                                                                               AS scores_submitted,
  count(ps.score_id)            FILTER (WHERE ps.score_status = 'admin_approved')                  AS approved_scores,
  max(ps.score_date)                                                                               AS last_activity
FROM org.schools sc
JOIN org.states st ON st.id = sc.state_id
LEFT JOIN org.plds pl ON pl.id = sc.pld_id
LEFT JOIN profile_scores ps ON ps.school_id = sc.id
GROUP BY sc.id, sc.name, sc.pld_id, pl.name, sc.state_id, st.name, st.code, sc.active;

GRANT SELECT ON public.report_school_activity TO authenticated;

-- ─── EMERGING TALENTS ────────────────────────────────────────
-- One row per approved archer who has at least one validated score.
-- Ranked client-side by best_score; improvement shown as best-vs-average.
CREATE OR REPLACE VIEW public.report_emerging_talents
  WITH (security_invoker = true) AS
SELECT
  p.id        AS archer_id,
  p.name,
  p.archer_id AS archer_code,
  p.age,
  p.bow_category,
  p.state_id,
  p.pld_id,
  p.school_id,
  st.name  AS state,
  st.code  AS state_code,
  pl.name  AS pld,
  sc.name  AS school,
  count(s.id)        FILTER (WHERE s.status = 'admin_approved')                 AS approved_count,
  COALESCE(max(s.total_score) FILTER (WHERE s.status = 'admin_approved'), 0)    AS best_score,
  COALESCE(round(avg(s.total_score) FILTER (WHERE s.status = 'admin_approved'))::int, 0) AS avg_score,
  max(s.date)        FILTER (WHERE s.status = 'admin_approved')                 AS last_score_date
FROM core.profiles p
LEFT JOIN scoring.score_submissions s ON s.archer_id = p.id
LEFT JOIN org.states  st ON st.id = p.state_id
LEFT JOIN org.plds    pl ON pl.id = p.pld_id
LEFT JOIN org.schools sc ON sc.id = p.school_id
WHERE p.role = 'archer' AND p.status = 'approved'
GROUP BY p.id, p.name, p.archer_id, p.age, p.bow_category,
         p.state_id, p.pld_id, p.school_id, st.name, st.code, pl.name, sc.name
HAVING count(s.id) FILTER (WHERE s.status = 'admin_approved') > 0;

GRANT SELECT ON public.report_emerging_talents TO authenticated;

-- ─── NOTES / TODO ────────────────────────────────────────────
--  • These views are all-time snapshots. Date-range filtering for trends and
--    summary cards is done in the service against scoring.score_submissions.
--  • "active_archers" = archers with >=1 admin_approved score (reporting
--    activity), distinct from "registered_archers" (all archer profiles).
--  • Deeper analytics (recent-improvement windows, consistency, validation
--    turnaround time) are computed/extended in src/services/reports.ts later.
