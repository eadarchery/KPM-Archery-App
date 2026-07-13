-- ============================================================
-- Migration 018: Admin 1 Approval Scope
-- ------------------------------------------------------------
-- Lets an Admin 1 approve/reject ONLY users inside their assigned
-- (or derived) school / PLD / state scope.
--
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Required for Admin 1 approve/reject to work — Admin 1 has no
--       UPDATE policy on profiles until PART 3 below is applied.
--
-- Safe to re-run: every statement is idempotent. No data dropped,
-- no columns renamed. Existing admin1 national READ stays as-is
-- (the Approval Center filters to scope on the client + write RLS).
-- ============================================================

-- ─── PART 1: ASSIGNED-SCOPE COLUMNS ──────────────────────────
-- Separate from the admin's own location (state_id/pld_id/school_id),
-- so "where the admin is" stays distinct from "what they may approve".

ALTER TABLE core.profiles
  ADD COLUMN IF NOT EXISTS assigned_state_id  uuid,
  ADD COLUMN IF NOT EXISTS assigned_pld_id    uuid,
  ADD COLUMN IF NOT EXISTS assigned_school_id uuid,
  ADD COLUMN IF NOT EXISTS scope_type         text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'core_profiles_scope_type_check') THEN
    ALTER TABLE core.profiles ADD CONSTRAINT core_profiles_scope_type_check
      CHECK (scope_type IS NULL OR scope_type IN ('national','state','pld','school'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'core_profiles_assigned_state_fkey') THEN
    ALTER TABLE core.profiles ADD CONSTRAINT core_profiles_assigned_state_fkey
      FOREIGN KEY (assigned_state_id) REFERENCES org.states(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'core_profiles_assigned_pld_fkey') THEN
    ALTER TABLE core.profiles ADD CONSTRAINT core_profiles_assigned_pld_fkey
      FOREIGN KEY (assigned_pld_id) REFERENCES org.plds(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'core_profiles_assigned_school_fkey') THEN
    ALTER TABLE core.profiles ADD CONSTRAINT core_profiles_assigned_school_fkey
      FOREIGN KEY (assigned_school_id) REFERENCES org.schools(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Refresh the public passthrough view so scope columns are reachable.
CREATE OR REPLACE VIEW public.profiles
  WITH (security_invoker = true) AS
SELECT * FROM core.profiles;

-- ─── PART 2: SCOPE-MATCH FUNCTION ────────────────────────────
-- Mirrors src/lib/scope.ts exactly. SECURITY DEFINER so it can read the
-- admin's own scope row regardless of the caller's RLS. Default DENY:
-- returns false whenever scope can't be positively matched.

CREATE OR REPLACE FUNCTION core.admin1_in_scope(
  p_admin  uuid,
  p_state  uuid,
  p_pld    uuid,
  p_school uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_type text;
  v_as uuid; v_ap uuid; v_asch uuid;   -- assigned_*
  v_os uuid; v_op uuid; v_osch uuid;   -- own location
BEGIN
  SELECT scope_type, assigned_state_id, assigned_pld_id, assigned_school_id,
         state_id, pld_id, school_id
    INTO v_type, v_as, v_ap, v_asch, v_os, v_op, v_osch
  FROM core.profiles WHERE id = p_admin;

  -- 1. Explicit assignment
  IF v_type = 'national' THEN RETURN true; END IF;
  IF v_type = 'school' AND v_asch IS NOT NULL THEN RETURN COALESCE(p_school = v_asch, false); END IF;
  IF v_type = 'pld'    AND v_ap   IS NOT NULL THEN RETURN COALESCE(p_pld   = v_ap,   false); END IF;
  IF v_type = 'state'  AND v_as   IS NOT NULL THEN RETURN COALESCE(p_state = v_as,   false); END IF;

  -- 2. Derived from the admin's own location (most specific first)
  IF v_osch IS NOT NULL THEN RETURN COALESCE(p_school = v_osch, false); END IF;
  IF v_op   IS NOT NULL THEN RETURN COALESCE(p_pld   = v_op,   false); END IF;
  IF v_os   IS NOT NULL THEN RETURN COALESCE(p_state = v_os,   false); END IF;

  -- 3. No scope → deny
  RETURN false;
END $$;

REVOKE ALL     ON FUNCTION core.admin1_in_scope(uuid,uuid,uuid,uuid) FROM public;
GRANT  EXECUTE ON FUNCTION core.admin1_in_scope(uuid,uuid,uuid,uuid) TO authenticated;

-- ─── PART 3: SCOPED UPDATE POLICY ────────────────────────────
-- Admin 1 may UPDATE only archer/coach profiles inside their scope. The
-- WITH CHECK also blocks role escalation (new row must still be archer/coach)
-- and moving a user out of scope. admin2/super_admin policies are untouched.

DROP POLICY IF EXISTS "core_profiles_admin1_approve_in_scope" ON core.profiles;
CREATE POLICY "core_profiles_admin1_approve_in_scope" ON core.profiles FOR UPDATE TO authenticated
USING (
  core.current_role() = 'admin1' AND core.is_approved()
  AND role IN ('archer','coach')
  AND core.admin1_in_scope(auth.uid(), state_id, pld_id, school_id)
)
WITH CHECK (
  core.current_role() = 'admin1'
  AND role IN ('archer','coach')
  AND core.admin1_in_scope(auth.uid(), state_id, pld_id, school_id)
);

-- Notes:
--  • Admin 1's national READ policy (core_profiles_admin1_read_all) is kept, so
--    the Overview page and the read-only "Outside scope" tab still work. Scope
--    is enforced on WRITE here + on the client.
--  • To also scope archer extension fields (age_group / dominant_hand) for
--    Admin 1, add a similar scoped SELECT policy on coaching.archer_profiles
--    later — left as a follow-up (bow_category/age are already on core.profiles).
