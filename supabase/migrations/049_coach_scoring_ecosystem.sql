-- ============================================================
-- Migration 049: Coach scoring ecosystem — PLD Coach + coach self-scores
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- Coaches get their own competitive loop, separate from archers:
--   • A coach submits their OWN scores (score_submissions with
--     archer_id = the coach's id, status 'pending', no coach_id).
--   • The PLD COACH — a coach flagged is_pld_coach by Admin 2, scoped to
--     their own pld_id — validates those scores (approve → admin_approved,
--     or reject). PLD coaches also see/validate scores submitted BY the
--     school coaches of their PLD on behalf of archers ('coach_approved').
--   • coach_leaderboard(): approved-coach-only leaderboard of coaches' own
--     validated scores.
-- ============================================================

-- ─── 1. PLD Coach flag ───────────────────────────────────────────

ALTER TABLE core.profiles
  ADD COLUMN IF NOT EXISTS is_pld_coach boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW public.profiles
  WITH (security_invoker = true) AS
SELECT * FROM core.profiles;

-- Helper: is the caller an approved coach flagged as PLD coach?
CREATE OR REPLACE FUNCTION core.is_pld_coach()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT role = 'coach' AND status = 'approved' AND is_pld_coach
     FROM core.profiles WHERE id = auth.uid()),
    false
  )
$$;

-- Helper: the caller's pld_id.
CREATE OR REPLACE FUNCTION core.my_pld_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT pld_id FROM core.profiles WHERE id = auth.uid()
$$;

-- ─── 2. Coach submits their OWN score ────────────────────────────

DROP POLICY IF EXISTS "scoring_submissions_coach_self_insert" ON scoring.score_submissions;
CREATE POLICY "scoring_submissions_coach_self_insert" ON scoring.score_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    core.current_role() = 'coach' AND core.is_approved()
    AND archer_id = auth.uid()          -- their own score
    AND status = 'pending'
    AND approved_by IS NULL AND admin_approved_at IS NULL
  );
-- (own-read and own-update-pending policies already match on archer_id =
--  auth.uid() regardless of role, so coaches can see/withdraw their own.)

-- ─── 3. PLD Coach reads + validates scores in their PLD ──────────
-- Covers: coach self-scores (pending) and school-coach submissions
-- (coach_approved) where the SUBMITTING/OWNING coach is in the PLD.

-- Helper: does this submission fall in the PLD coach's validation scope?
--   a) a coach's OWN score (owner is a coach in my PLD), or
--   b) a school coach's submission for an archer (submitting coach in my PLD).
CREATE OR REPLACE FUNCTION core.pld_coach_scope(p_owner uuid, p_coach uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  -- Never their own submissions: a PLD coach cannot self-validate their own
  -- score nor a score they themselves submitted for an archer.
  SELECT core.is_pld_coach()
    AND p_owner IS DISTINCT FROM auth.uid()
    AND p_coach IS DISTINCT FROM auth.uid()
    AND (
      EXISTS (SELECT 1 FROM core.profiles sub
              WHERE sub.id = p_owner AND sub.role = 'coach' AND sub.pld_id = core.my_pld_id())
      OR
      EXISTS (SELECT 1 FROM core.profiles sc
              WHERE sc.id = p_coach AND sc.role = 'coach' AND sc.pld_id = core.my_pld_id())
    )
$$;

DROP POLICY IF EXISTS "scoring_submissions_pldcoach_reads" ON scoring.score_submissions;
CREATE POLICY "scoring_submissions_pldcoach_reads" ON scoring.score_submissions
  FOR SELECT TO authenticated
  USING (core.pld_coach_scope(archer_id, coach_id));

DROP POLICY IF EXISTS "scoring_submissions_pldcoach_validates" ON scoring.score_submissions;
CREATE POLICY "scoring_submissions_pldcoach_validates" ON scoring.score_submissions
  FOR UPDATE TO authenticated
  USING (
    core.pld_coach_scope(archer_id, coach_id)
    AND status IN ('pending', 'coach_approved')
  )
  WITH CHECK (status IN ('admin_approved', 'rejected'));

-- ─── 4. Guard trigger: allow PLD-coach finalisation ──────────────
-- Supersedes 042's function (same behaviour plus the PLD-coach path).

CREATE OR REPLACE FUNCTION core.guard_score_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF auth.uid() IS NULL OR core.is_admin() THEN
    RETURN NEW;  -- service_role / admin2 / super_admin are trusted
  END IF;

  IF NEW.status = 'admin_approved' THEN
    v_ok := false;
    -- Assigned coach finalising an archer-submitted score (migration 042).
    IF TG_OP = 'UPDATE' AND OLD.status = 'pending'
       AND NEW.coach_id = auth.uid() AND core.current_role() = 'coach' THEN
      v_ok := true;
    END IF;
    -- PLD coach finalising: a coach's own score (pending) or a school
    -- coach's archer submission (coach_approved) inside their PLD.
    IF NOT v_ok AND TG_OP = 'UPDATE'
       AND OLD.status IN ('pending', 'coach_approved')
       AND core.pld_coach_scope(NEW.archer_id, NEW.coach_id) THEN
      v_ok := true;
    END IF;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'Only an administrator can mark a score admin-approved.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.approved_by IS NOT NULL OR NEW.admin_approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'You cannot set administrator approval fields on a score.';
    END IF;
  ELSE
    IF NEW.approved_by      IS DISTINCT FROM OLD.approved_by
       OR NEW.admin_approved_at IS DISTINCT FROM OLD.admin_approved_at THEN
      RAISE EXCEPTION 'You cannot change administrator approval fields on a score.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS scoring_submissions_guard ON scoring.score_submissions;
CREATE TRIGGER scoring_submissions_guard
  BEFORE INSERT OR UPDATE ON scoring.score_submissions
  FOR EACH ROW EXECUTE FUNCTION core.guard_score_submission();

-- ─── 5. Coaches-only leaderboard ─────────────────────────────────
-- Coaches' RLS cannot read other coaches' scores, so the leaderboard is a
-- SECURITY DEFINER function restricted to approved coaches and admins.

CREATE OR REPLACE FUNCTION public.coach_leaderboard()
RETURNS TABLE (
  coach_id uuid, coach_name text, school_name text, pld_name text,
  best_score int, best_max int, best_pct numeric, sessions bigint, last_date date
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (core.is_admin() OR (core.current_role() = 'coach' AND core.is_approved())) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.name, s.name, pl.name,
    b.best_score, b.best_max, b.best_pct, b.sessions, b.last_date
  FROM (
    SELECT
      ss.archer_id AS cid,
      (array_agg(ss.total_score ORDER BY (ss.total_score::numeric / NULLIF(ss.max_score,0)) DESC))[1] AS best_score,
      (array_agg(ss.max_score  ORDER BY (ss.total_score::numeric / NULLIF(ss.max_score,0)) DESC))[1] AS best_max,
      ROUND(MAX(ss.total_score::numeric / NULLIF(ss.max_score,0)) * 100, 1) AS best_pct,
      count(*) AS sessions,
      MAX(ss.date) AS last_date
    FROM scoring.score_submissions ss
    JOIN core.profiles cp ON cp.id = ss.archer_id AND cp.role = 'coach'
    WHERE ss.status = 'admin_approved'
    GROUP BY ss.archer_id
  ) b
  JOIN core.profiles p ON p.id = b.cid
  LEFT JOIN org.schools s ON s.id = p.school_id
  LEFT JOIN org.plds   pl ON pl.id = p.pld_id
  ORDER BY b.best_pct DESC NULLS LAST;
END $$;

REVOKE ALL     ON FUNCTION public.coach_leaderboard() FROM public;
GRANT  EXECUTE ON FUNCTION public.coach_leaderboard() TO authenticated;
