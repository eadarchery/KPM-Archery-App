-- ============================================================
-- Migration 033: Security Audit Final Follow-up
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run. Run AFTER 031 and 032.
--
-- Closes score-submission, certification, profile-scope and article gaps found
-- in the second cross-check:
--   1. No coach INSERT policy on score_submissions → coach submit was RLS-blocked.
--   2. Score UPDATE policies too loose → archer/coach could self-set admin_approved
--      or forge approved_by / admin_approved_at (guard trigger now blocks this).
--   3. Coach could not withdraw a coach_approved submission (policy required pending).
--   5. Coach could not withdraw a certification (no coach update for non-pending);
--      the loose WITH CHECK also let a coach self-approve a pending cert.
--   6. Profile self-guard did not lock Admin 1 scope fields (self scope expansion).
--   7. Article read only checked published_at → archived/audience not enforced.
-- (4 cert storage path + 8 proof PDF mime are FRONTEND/Dashboard fixes — see notes.)
-- ============================================================

-- ─── 1 + 3: SCORE SUBMISSION COACH POLICIES ────────────────────

-- Coach may INSERT a score ONLY for a linked archer, as coach_approved, with no
-- admin fields pre-set.
DROP POLICY IF EXISTS "scoring_submissions_coach_inserts_linked" ON scoring.score_submissions;
CREATE POLICY "scoring_submissions_coach_inserts_linked" ON scoring.score_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    core.current_role() = 'coach' AND core.is_approved()
    AND coach_id = auth.uid()
    AND status = 'coach_approved'
    AND approved_by IS NULL
    AND admin_approved_at IS NULL
    AND EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.coach_id = auth.uid()
        AND cal.archer_id = scoring.score_submissions.archer_id
        AND cal.status = 'active'
    )
  );

-- Coach may UPDATE their own pending/coach_approved rows (approve, reject,
-- withdraw). Admin-only transitions are blocked by the guard trigger below.
DROP POLICY IF EXISTS "scoring_submissions_coach_approves"     ON scoring.score_submissions;
DROP POLICY IF EXISTS "scoring_submissions_coach_manages_own"  ON scoring.score_submissions;
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
    AND status IN ('pending','coach_approved','rejected','withdrawn')
  );

-- Archer may edit/withdraw ONLY their own pending submission (cannot jump to
-- coach_approved/admin_approved).
DROP POLICY IF EXISTS "scoring_submissions_archer_updates_pending" ON scoring.score_submissions;
CREATE POLICY "scoring_submissions_archer_updates_pending" ON scoring.score_submissions
  FOR UPDATE TO authenticated
  USING (archer_id = auth.uid() AND status = 'pending')
  WITH CHECK (archer_id = auth.uid() AND status IN ('pending','withdrawn'));

-- ─── 2: SCORE SUBMISSION ADMIN-FIELD GUARD ─────────────────────
-- Hard floor: only an admin can mark a score admin_approved or set/alter the
-- admin approval attribution. Defends even if a policy is later loosened.

CREATE OR REPLACE FUNCTION core.guard_score_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR core.is_admin() THEN
    RETURN NEW;  -- service_role / admin2 / super_admin are trusted here
  END IF;

  IF NEW.status = 'admin_approved' THEN
    RAISE EXCEPTION 'Only an administrator can mark a score admin-approved.';
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

-- ─── 5: CERTIFICATION COACH UPDATE (withdraw, no self-approve) ──
-- Coach may edit / withdraw their own pending or rejected certs, never approve
-- their own and never touch an approved/withdrawn/expired record.
DROP POLICY IF EXISTS "cert_coach_updates_own_pending" ON certification.certifications;
DROP POLICY IF EXISTS "cert_coach_updates_own"         ON certification.certifications;
CREATE POLICY "cert_coach_updates_own" ON certification.certifications
  FOR UPDATE TO authenticated
  USING  (coach_id = auth.uid() AND core.is_approved() AND status IN ('pending','rejected'))
  WITH CHECK (coach_id = auth.uid() AND status IN ('pending','rejected','withdrawn'));

-- ─── 6: PROFILE SELF-GUARD — also lock Admin 1 scope fields ────
-- Supersedes the function from 032; trigger re-asserted below.

CREATE OR REPLACE FUNCTION core.guard_profile_privilege()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR core.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.id = auth.uid()
       AND (NEW.role NOT IN ('archer','coach') OR NEW.status <> 'pending') THEN
      RAISE EXCEPTION 'Self-registered accounts must be a pending archer or coach.';
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() = OLD.id AND (
        NEW.role               IS DISTINCT FROM OLD.role
     OR NEW.status             IS DISTINCT FROM OLD.status
     OR NEW.approved_by        IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at        IS DISTINCT FROM OLD.approved_at
     OR NEW.rejected_by        IS DISTINCT FROM OLD.rejected_by
     OR NEW.rejected_at        IS DISTINCT FROM OLD.rejected_at
     OR NEW.suspended_by       IS DISTINCT FROM OLD.suspended_by
     OR NEW.suspended_at       IS DISTINCT FROM OLD.suspended_at
     OR NEW.suspension_reason  IS DISTINCT FROM OLD.suspension_reason
     OR NEW.admin_notes        IS DISTINCT FROM OLD.admin_notes
     OR NEW.school_id          IS DISTINCT FROM OLD.school_id
     OR NEW.pld_id             IS DISTINCT FROM OLD.pld_id
     OR NEW.state_id           IS DISTINCT FROM OLD.state_id
     OR NEW.coach_id           IS DISTINCT FROM OLD.coach_id
     -- Admin 1 approval-scope fields (a scoped admin must not self-expand scope):
     OR NEW.scope_type         IS DISTINCT FROM OLD.scope_type
     OR NEW.assigned_state_id  IS DISTINCT FROM OLD.assigned_state_id
     OR NEW.assigned_pld_id    IS DISTINCT FROM OLD.assigned_pld_id
     OR NEW.assigned_school_id IS DISTINCT FROM OLD.assigned_school_id
  ) THEN
    RAISE EXCEPTION 'You cannot change protected account fields (role, status, approval, scope or coach link) on your own profile.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS core_profiles_guard_privilege ON core.profiles;
CREATE TRIGGER core_profiles_guard_privilege
  BEFORE INSERT OR UPDATE ON core.profiles
  FOR EACH ROW EXECUTE FUNCTION core.guard_profile_privilege();

-- ─── 7: ARTICLE READ — status + audience at the DB layer ───────
-- Normal users may read ONLY published articles whose audience is 'all' or their
-- own role. Drafts and archived articles are never visible to non-admins.
-- (admin2 + super keep full access via articles_admin2_full.)
DROP POLICY IF EXISTS "articles_approved_read_published" ON content.articles;
CREATE POLICY "articles_approved_read_published" ON content.articles
  FOR SELECT TO authenticated
  USING (
    core.is_approved()
    AND status = 'published'
    AND published_at IS NOT NULL AND published_at <= now()
    AND (
      audience::text = 'all'
      OR audience::text = (SELECT role::text FROM core.profiles WHERE id = auth.uid())
    )
  );

-- ─── NOTES (frontend / Dashboard — not SQL) ────────────────────
--  • #4 Certification upload path: the frontend now uploads to
--    '{coachId}/...' (was 'coach-certifications/{coachId}/...') so it satisfies
--    the certifications policy foldername[1] = auth.uid().
--  • #5 The frontend now WITHDRAWS a certification (status='withdrawn') instead of
--    DELETE, and no longer removes the storage object — so no storage delete
--    policy is required.
--  • #8 Proof files may be PDF. Set the 'proof-photos' bucket's allowed MIME types
--    to: image/png, image/jpeg, image/webp, application/pdf (Dashboard → Storage).
