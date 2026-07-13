-- ============================================================
-- Migration 024: Score Validation + Leaderboard Audit
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--
-- Purpose (additive only — no renames, no data loss):
--   1. Add scoring.rounds.category so the Admin 2 "Round Type" filter works.
--      (Admin 2 Scores page already embeds round.category; the column was
--       missing, which made the whole score query fail. This unbreaks it.)
--   2. Create public.leaderboard — a correctness-safe ranking view that only
--      counts admin-approved scores of approved archers. Replaces the broken
--      `leaderboard_view` / api-only `leaderboard` the frontend referenced.
--
-- Safe to re-run: every statement is idempotent.
-- The score status flow, RLS, achievement auto-grant trigger and audit
-- triggers are already correct (migrations 004 / 006 / 007) and untouched.
-- ============================================================

-- ─── PART 1: ROUND CATEGORY ──────────────────────────────────
-- training | tournament | practice | selection. Default 'training' so no
-- existing row is left NULL. public.rounds is SELECT * so it auto-exposes it.

ALTER TABLE scoring.rounds
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'training';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scoring_rounds_category_check') THEN
    ALTER TABLE scoring.rounds ADD CONSTRAINT scoring_rounds_category_check
      CHECK (category IN ('training','tournament','practice','selection'));
  END IF;
END $$;

-- Classify the seeded competition rounds as 'tournament' so the filter is
-- meaningful out of the box. Only touches rows still on the default.
UPDATE scoring.rounds
   SET category = 'tournament'
 WHERE category = 'training'
   AND (name LIKE 'WA %' OR name LIKE 'MABF %');

-- ─── PART 2: PUBLIC LEADERBOARD VIEW ─────────────────────────
-- Best admin-approved score per archer, per bow category. Plain view (NOT
-- security_invoker) so it can aggregate across all archers as public ranking
-- data — mirrors the design of api.leaderboard (migration 007). It exposes
-- only ranking-safe columns (name, school, scores), never private fields.
--
-- Correctness guarantees baked into the WHERE clause:
--   • only status = 'admin_approved'  → pending/coach_approved/rejected/
--     withdrawn/draft scores never appear
--   • only approved, archer-role profiles
-- Tournament scores requiring Admin 2 approval are therefore excluded until
-- they reach 'admin_approved'.

CREATE OR REPLACE VIEW public.leaderboard AS
WITH best AS (
  SELECT DISTINCT ON (s.archer_id, p.bow_category)
    s.archer_id,
    p.name           AS name,
    p.archer_id      AS archer_code,
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

-- ─── NOTES / TODO (documented, not changed here) ─────────────
--  • Archer self-submission: there is no /archer/scores page yet. The archer
--    INSERT RLS policy (scoring_submissions_archer_inserts) already exists, so
--    a future page can submit status='pending' without new SQL.
--  • Coach approval of archer-submitted scores: the coach UPDATE policy
--    (scoring_submissions_coach_approves) requires coach_id = auth.uid(), but
--    archer inserts don't set coach_id. Wire coach_id on submit (or relax the
--    policy to linked-archer) when the archer page ships.
--  • Tournament vs training is modelled per-round (category above), not per
--    submission, and there is no separate proof_status column — score.status
--    is the single source of truth. Revisit if per-submission proof review is
--    needed.
