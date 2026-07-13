-- ============================================================
-- Migration 056: Coach rejects a pending school-code registration
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run. Run AFTER 034 (and 039).
--
-- Completes the official coach approval model from migration 034: coaches
-- could APPROVE pending archers who registered with their school code, but
-- had no way to REJECT a registration that doesn't belong to them (wrong
-- school, unknown person, duplicate). This RPC mirrors coach_approve_archer's
-- scope checks exactly:
--
--   • caller must be an APPROVED coach with a school
--   • target must be a PENDING archer whose requested_school_id = coach's school
--
-- On rejection:
--   • profile status → 'rejected', rejection_reason stored
--   • requested_school_id is CLEARED so a genuine archer who simply used the
--     wrong code can be given the correct code and re-claim it (status is
--     reset to 'pending' by the re-claim path below)
--   • audit log entry 'coach.archer_registration_rejected'
--
-- Admin 1 / Admin 2 oversight is unchanged: they see all approvals and
-- rejections in the audit log, and can still correct any profile from the
-- User Manager (admin override paths already audited).
-- ============================================================

CREATE OR REPLACE FUNCTION public.coach_reject_archer(p_archer_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coach     uuid;
  v_school    uuid;
  v_role      text;
  v_status    text;
  v_a_role    text;
  v_a_status  text;
  v_a_school  uuid;
  v_a_name    text;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A rejection reason is required.';
  END IF;

  SELECT id, role::text, status, school_id INTO v_coach, v_role, v_status, v_school
  FROM core.profiles WHERE id = auth.uid();
  IF v_role <> 'coach' OR v_status <> 'approved' OR v_school IS NULL THEN
    RAISE EXCEPTION 'Only an approved coach assigned to a school may reject archers.';
  END IF;

  SELECT role::text, status, requested_school_id, name
    INTO v_a_role, v_a_status, v_a_school, v_a_name
  FROM core.profiles WHERE id = p_archer_id;
  IF v_a_role IS NULL OR v_a_role <> 'archer' OR v_a_status <> 'pending' THEN
    RAISE EXCEPTION 'Target is not a pending archer.';
  END IF;
  IF v_a_school IS DISTINCT FROM v_school THEN
    RAISE EXCEPTION 'This archer did not request your school.';
  END IF;

  UPDATE core.profiles
     SET status              = 'rejected',
         rejection_reason    = trim(p_reason),
         requested_school_id = NULL
   WHERE id = p_archer_id;

  PERFORM public.log_audit(
    v_coach, 'coach.archer_registration_rejected', 'profile', p_archer_id,
    jsonb_build_object('school_id', v_school, 'archer_name', v_a_name, 'reason', trim(p_reason))
  );
END $$;
REVOKE ALL     ON FUNCTION public.coach_reject_archer(uuid, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.coach_reject_archer(uuid, text) TO authenticated;

-- ─── ALLOW A REJECTED ARCHER TO RE-CLAIM WITH A CORRECT CODE ────
-- claim_school_code (034) only allowed status='pending'. A wrong-code archer
-- who was rejected should be able to enter the right code and return to the
-- correct coach's queue — without being able to touch approved accounts.

CREATE OR REPLACE FUNCTION public.claim_school_code(p_code text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_school_id   uuid;
  v_school_name text;
  v_role        text;
  v_status      text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT role::text, status INTO v_role, v_status FROM core.profiles WHERE id = auth.uid();
  IF v_role <> 'archer' OR v_status NOT IN ('pending', 'rejected') THEN
    RAISE EXCEPTION 'Only a pending archer can claim a school code.';
  END IF;

  SELECT id, name INTO v_school_id, v_school_name FROM org.schools
   WHERE reg_code = upper(trim(p_code)) AND active = true
   LIMIT 1;
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Invalid school code.';
  END IF;

  UPDATE core.profiles
     SET requested_school_id = v_school_id,
         status              = 'pending',      -- re-enter the approval queue
         rejection_reason    = NULL
   WHERE id = auth.uid();
  RETURN v_school_name;
END $$;
REVOKE ALL     ON FUNCTION public.claim_school_code(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.claim_school_code(text) TO authenticated;

-- ─── NOTES ─────────────────────────────────────────────────────
--  • The profile self-guard (031–033) still locks status/school_id on direct
--    self-updates; the status reset above happens only inside this SECURITY
--    DEFINER RPC after the code is validated, so an archer still cannot
--    self-approve — they can only re-queue as 'pending' for a real school.
--  • Coaches remain unable to touch archers outside their school: both RPCs
--    hard-check requested_school_id = coach.school_id.
