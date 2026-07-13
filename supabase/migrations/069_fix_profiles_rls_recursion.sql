-- ============================================================
-- Migration 069: HOTFIX — RLS infinite recursion on core.profiles
-- ------------------------------------------------------------
--   ⚠️  RUN THIS IMMEDIATELY IN THE SUPABASE SQL EDITOR.
--       LOGIN IS BROKEN UNTIL THIS RUNS (error 42P17:
--       "infinite recursion detected in policy for relation profiles").
--       Idempotent — safe to run more than once.
--
-- WHAT BROKE: migration 063 (Part A) added admin1 SELECT policies on
-- coaching.coach_profiles / certification.certifications /
-- coaching.coach_archer_links whose USING clause subqueries core.profiles
-- inline. core.profiles ALREADY has a policy that subqueries
-- coaching.coach_archer_links inline ("core_profiles_coach_reads_linked",
-- migration 006). Postgres expands policy quals at PLAN time, so:
--     profiles → coach_archer_links → profiles → …  = 42P17
-- The error fires for EVERY select on profiles regardless of the caller's
-- role (all policies are OR-expanded into the plan), which is why no
-- account could log in — auth succeeded, the profile fetch then failed.
--
-- THE FIX: replace the inline profiles subquery with a SECURITY DEFINER
-- helper (same pattern as core.is_admin / core.current_role /
-- core.admin1_in_scope). Function bodies are opaque to the planner, so the
-- cycle is broken; plpgsql is never inlined. The helper returns the same
-- boolean the inline subquery produced — no scope widening: the caller
-- must still be an approved admin1, and the helper only reports whether a
-- given profile sits inside that admin's assigned scope.
-- ============================================================

-- ─── SECURITY DEFINER helper (breaks the policy cycle) ─────────
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

-- ─── Recreate the three 063 policies WITHOUT inline profiles reads ──
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

-- ─── NOTES ─────────────────────────────────────────────────────
--  • Behaviour is IDENTICAL to 063's intent: admin1 can read coach
--    profiles / certifications / links only for coaches inside their
--    assigned scope. Admin2/super_admin and own-row policies untouched.
--  • Migration 063 in the repo has been patched the same way, so
--    re-running 063 later can no longer reintroduce the recursion.
--  • Rule for future policies: NEVER subquery core.profiles inline from a
--    policy on a table that core.profiles' own policies subquery back
--    (coach_archer_links!). Go through a SECURITY DEFINER helper instead.
