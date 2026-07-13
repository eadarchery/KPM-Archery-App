-- ============================================================
-- Migration 042: Coach approval finalizes an archer's own score
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- New rule:
--   • Archer-submitted score (starts 'pending') → the coach's approval makes it
--     FINAL ('admin_approved'). No Admin 2 step.
--   • Coach-submitted score (starts 'coach_approved', with photo justification)
--     → still requires Admin 2 approval, unchanged.
--
-- This requires two changes, because a guard trigger + RLS previously reserved
-- 'admin_approved' for admins only:
--   1. RLS: allow the coach's UPDATE to result in 'admin_approved'.
--   2. Guard: permit a coach to set 'admin_approved' ONLY when finalizing an
--      archer-submitted score (OLD.status = 'pending') on which they are the
--      assigned coach. All other paths still require an administrator.
-- ============================================================

-- ─── 1. RLS: coach UPDATE may end in admin_approved ────────────
DROP POLICY IF EXISTS "scoring_submissions_coach_manages_own" ON scoring.score_submissions;
CREATE POLICY "scoring_submissions_coach_manages_own" ON scoring.score_submissions
  FOR UPDATE TO authenticated
  USING (
    core.current_role() = 'coach' AND core.is_approved()
    AND coach_id = auth.uid()
    AND status IN ('pending','coach_approved')
  )
  WITH CHECK (
    core.current_role() = 'coach'
    AND coach_id = auth.uid()
    AND status IN ('pending','coach_approved','rejected','withdrawn','admin_approved')
  );

-- ─── 2. Guard: coach may finalize ONLY archer-originated scores ─
CREATE OR REPLACE FUNCTION core.guard_score_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR core.is_admin() THEN
    RETURN NEW;  -- service_role / admin2 / super_admin are trusted
  END IF;

  IF NEW.status = 'admin_approved' THEN
    -- Only allowed for the assigned coach finalizing an archer submission
    -- (which begins life as 'pending'). Coach-submitted scores start as
    -- 'coach_approved' and therefore still route to an administrator.
    IF NOT (TG_OP = 'UPDATE' AND OLD.status = 'pending'
            AND NEW.coach_id = auth.uid()
            AND core.current_role() = 'coach') THEN
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
