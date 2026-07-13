-- ============================================================
-- Migration 034: School-code archer registration + coach approval
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run. Run AFTER 031–033.
--
-- Flow:
--   • Each school has one shared reg_code. A coach gives it to an archer.
--   • Archer registers, enters the code → it resolves ONLY to the school name
--     for confirmation (no public school list is ever exposed).
--   • Archer is created pending and tagged with requested_school_id (via RPC —
--     the client never sets school_id directly).
--   • Any APPROVED coach assigned to that school sees the pending archer and
--     approves → status=approved, school_id=requested_school_id, coach_id=coach,
--     active coach_archer_link, audit log.
--
-- All cross-account writes go through SECURITY DEFINER RPCs (no broad coach
-- UPDATE policy on core.profiles). The self-guard from 031–033 still prevents an
-- archer from self-approving or changing their assigned school after approval
-- (status + school_id remain locked on self-update; requested_school_id is the
-- only pre-approval field an archer may hold, and it is set via RPC).
-- ============================================================

-- ─── 1. SCHOOL REGISTRATION CODE ───────────────────────────────

ALTER TABLE org.schools ADD COLUMN IF NOT EXISTS reg_code text;

UPDATE org.schools
   SET reg_code = upper(substr(md5(gen_random_uuid()::text), 1, 8))
 WHERE reg_code IS NULL;

ALTER TABLE org.schools
  ALTER COLUMN reg_code SET DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 8));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_schools_reg_code_key') THEN
    ALTER TABLE org.schools ADD CONSTRAINT org_schools_reg_code_key UNIQUE (reg_code);
  END IF;
END $$;

-- ─── 2. ARCHER'S REQUESTED SCHOOL ──────────────────────────────
-- Set before approval (the only scope field an archer may hold). NOT in the
-- profile self-guard lock list, so the claim RPC can set it; the OFFICIAL
-- school_id stays locked on self-update.

ALTER TABLE core.profiles
  ADD COLUMN IF NOT EXISTS requested_school_id uuid REFERENCES org.schools(id) ON DELETE SET NULL;

-- Refresh passthrough views so the new columns are reachable via PostgREST.
CREATE OR REPLACE VIEW public.schools  WITH (security_invoker = true) AS SELECT * FROM org.schools;
CREATE OR REPLACE VIEW public.profiles WITH (security_invoker = true) AS SELECT * FROM core.profiles;

-- ─── 3. RESOLVE CODE → SCHOOL NAME (anon, confirmation only) ────
-- Returns ONLY the matched active school's name (or NULL). No list is exposed.

CREATE OR REPLACE FUNCTION public.resolve_school_code(p_code text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT name FROM org.schools
  WHERE reg_code = upper(trim(p_code)) AND active = true
  LIMIT 1
$$;
REVOKE ALL     ON FUNCTION public.resolve_school_code(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.resolve_school_code(text) TO anon, authenticated;

-- ─── 4. CLAIM CODE → set requested_school_id (pending archer) ───

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
  IF v_role <> 'archer' OR v_status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending archer can claim a school code.';
  END IF;

  SELECT id, name INTO v_school_id, v_school_name FROM org.schools
   WHERE reg_code = upper(trim(p_code)) AND active = true
   LIMIT 1;
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Invalid school code.';
  END IF;

  UPDATE core.profiles SET requested_school_id = v_school_id WHERE id = auth.uid();
  RETURN v_school_name;
END $$;
REVOKE ALL     ON FUNCTION public.claim_school_code(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.claim_school_code(text) TO authenticated;

-- ─── 5. COACH QUEUE: pending archers requesting the coach's school ─

CREATE OR REPLACE FUNCTION public.coach_pending_archers()
RETURNS TABLE (id uuid, name text, email text, archer_id text, requested_school_id uuid, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role   text;
  v_status text;
  v_school uuid;
BEGIN
  SELECT role::text, status, school_id INTO v_role, v_status, v_school
  FROM core.profiles WHERE id = auth.uid();

  IF v_role <> 'coach' OR v_status <> 'approved' OR v_school IS NULL THEN
    RETURN;  -- not an approved coach with a school → empty set
  END IF;

  RETURN QUERY
    SELECT p.id, p.name, p.email, p.archer_id, p.requested_school_id, p.created_at
    FROM core.profiles p
    WHERE p.role = 'archer' AND p.status = 'pending'
      AND p.requested_school_id = v_school
    ORDER BY p.created_at DESC;
END $$;
REVOKE ALL     ON FUNCTION public.coach_pending_archers() FROM public;
GRANT  EXECUTE ON FUNCTION public.coach_pending_archers() TO authenticated;

-- ─── 6. COACH APPROVES A PENDING ARCHER (scoped) ───────────────

CREATE OR REPLACE FUNCTION public.coach_approve_archer(p_archer_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coach     uuid;
  v_school    uuid;
  v_role      text;
  v_status    text;
  v_pld       uuid;
  v_state     uuid;
  v_a_role    text;
  v_a_status  text;
  v_a_school  uuid;
  v_a_name    text;
BEGIN
  SELECT id, role::text, status, school_id INTO v_coach, v_role, v_status, v_school
  FROM core.profiles WHERE id = auth.uid();
  IF v_role <> 'coach' OR v_status <> 'approved' OR v_school IS NULL THEN
    RAISE EXCEPTION 'Only an approved coach assigned to a school may approve archers.';
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

  SELECT pld_id, state_id INTO v_pld, v_state FROM org.schools WHERE id = v_school;

  UPDATE core.profiles
     SET status      = 'approved',
         school_id   = v_school,
         pld_id      = COALESCE(pld_id, v_pld),
         state_id    = COALESCE(state_id, v_state),
         coach_id    = v_coach,
         approved_by = v_coach,
         approved_at = now()
   WHERE id = p_archer_id;

  INSERT INTO coaching.coach_archer_links (coach_id, archer_id, status, linked_at, approved_at, approved_by)
  VALUES (v_coach, p_archer_id, 'active', now(), now(), v_coach)
  ON CONFLICT (coach_id, archer_id) DO UPDATE
     SET status = 'active', approved_at = now(), approved_by = v_coach, unlinked_at = NULL;

  PERFORM public.log_audit(
    v_coach, 'coach.archer_approved', 'profile', p_archer_id,
    jsonb_build_object('school_id', v_school, 'archer_name', v_a_name)
  );
END $$;
REVOKE ALL     ON FUNCTION public.coach_approve_archer(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.coach_approve_archer(uuid) TO authenticated;

-- ─── NOTES ─────────────────────────────────────────────────────
--  • SECURITY DEFINER bypasses RLS (no broad coach UPDATE policy needed); the
--    profile self-guard trigger still runs but its self-check only fires when
--    auth.uid() = row id, so a coach writing the ARCHER's row is allowed while an
--    archer still cannot self-approve or change their own school_id/status.
--  • reg_code IS exposed on public.schools (readable by APPROVED users only;
--    anon/pending cannot read org tables). The security gate is coach approval,
--    not code secrecy. To restrict reg_code to own-school coaches only, replace
--    the public.schools column with a my_school_reg_code() RPC later.
