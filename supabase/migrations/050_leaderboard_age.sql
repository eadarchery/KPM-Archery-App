-- ============================================================
-- Migration 050: Leaderboard exposes archer age (for age-group filtering)
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- Same view as migration 024 plus p.age, so the leaderboard pages can filter
-- by age group (U14 / U18 / U21 / Open). Still only admin-approved scores of
-- approved archers; still ranking-safe columns only.
-- ============================================================

DROP VIEW IF EXISTS public.leaderboard;
CREATE VIEW public.leaderboard AS
WITH best AS (
  SELECT DISTINCT ON (s.archer_id, p.bow_category)
    s.archer_id,
    p.name           AS name,
    p.archer_id      AS archer_code,
    p.age            AS age,
    p.state_id,
    p.school_id,
    p.pld_id,
    st.name          AS state,
    st.code          AS state_code,
    sc.name          AS school,
    pl.name          AS pld,
    p.bow_category,
    r.name           AS round_name,
    r.category       AS round_category,
    s.total_score    AS best_score,
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
  ORDER BY s.archer_id, p.bow_category, s.total_score DESC, s.date DESC
)
SELECT
  b.*,
  RANK() OVER (PARTITION BY b.state_id, b.bow_category
               ORDER BY b.best_score DESC, b.date DESC) AS state_rank,
  RANK() OVER (PARTITION BY b.bow_category
               ORDER BY b.best_score DESC, b.date DESC) AS national_rank
FROM best b;

GRANT SELECT ON public.leaderboard TO authenticated;
