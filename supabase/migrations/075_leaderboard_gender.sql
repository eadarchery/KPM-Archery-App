-- ============================================================
-- Migration 075: Leaderboard gender division
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE VIEW). Run AFTER 059.
--       Additive only — recreates the public.leaderboard view.
--
-- WHY: the leaderboard could not be filtered or divided by gender. This
--      recreates the view exposing p.gender AND adds gender to the rank
--      partitions — so a gender-filtered board ranks 1..N within that
--      gender, exactly like the bow / category / distance / age divisions
--      already do. (This board is already a multi-division board where the
--      rank is within a division, so gender is just one more dimension.)
--
-- Identical to migration 059's view EXCEPT: gender is selected, and added
-- to both the state_rank and national_rank PARTITION BY clauses.
--
-- ⚠️ SECURITY NOTE (intentional): this view is SECURITY DEFINER (no
--    security_invoker), exactly like migration 059. That is REQUIRED and safe:
--    a leaderboard must show every approved archer's best score to every
--    viewer, but scoring.score_submissions RLS lets an archer read only their
--    OWN scores. With security_invoker the board would collapse to just the
--    viewer's own row. The WHERE clause (status = 'admin_approved' AND
--    p.status = 'approved' AND p.role = 'archer') is the security boundary —
--    only validated, public board data is exposed (no emails/phones, no
--    pending/rejected scores, no unapproved accounts). The Supabase linter
--    "security_definer_view" finding on public.leaderboard is expected and can
--    be acknowledged. Do NOT flip this to security_invoker without first adding
--    public-read RLS policies to score_submissions AND profiles.
-- ============================================================

DROP VIEW IF EXISTS public.leaderboard;
CREATE VIEW public.leaderboard AS
WITH base AS (
  SELECT
    s.archer_id,
    s.round_id,
    p.name                                  AS name,
    p.archer_id                             AS archer_code,
    p.age                                   AS age,
    p.gender                                AS gender,
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
  RANK() OVER (PARTITION BY b.state_id, b.bow_category, b.round_category, b.distance_m, b.age_group, b.gender
               ORDER BY b.best_score DESC, b.date DESC) AS state_rank,
  RANK() OVER (PARTITION BY b.bow_category, b.round_category, b.distance_m, b.age_group, b.gender
               ORDER BY b.best_score DESC, b.date DESC) AS national_rank
FROM best b;

GRANT SELECT ON public.leaderboard TO authenticated;
