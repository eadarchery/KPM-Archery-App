-- ============================================================
-- Migration 052: Admin 1 multi-scope (checkbox assignments)
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- An Admin 1 can now care for MULTIPLE states / PLDs / schools:
--   • tick a STATE   → every PLD and school inside it is in scope
--   • tick a PLD     → every school inside it is in scope
--   • tick SCHOOLS   → only those schools
--   Effective scope = the UNION of all ticks.
--
-- Backwards compatible: an Admin 1 with NO assignment rows keeps the old
-- behaviour (single assigned scope from migration 018, else derived from
-- their own location). core.admin1_in_scope keeps its signature, so the
-- existing RLS policy (core_profiles_admin1_approve_in_scope) is untouched.
-- ============================================================

-- ─── 1. Assignments table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS core.admin1_scopes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  level      text NOT NULL CHECK (level IN ('state','pld','school')),
  ref_id     uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin1_scopes_unique UNIQUE (admin_id, level, ref_id)
);
CREATE INDEX IF NOT EXISTS admin1_scopes_admin_idx ON core.admin1_scopes(admin_id);

ALTER TABLE core.admin1_scopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin1_scopes_admin_manage" ON core.admin1_scopes;
CREATE POLICY "admin1_scopes_admin_manage" ON core.admin1_scopes
  FOR ALL TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

DROP POLICY IF EXISTS "admin1_scopes_own_read" ON core.admin1_scopes;
CREATE POLICY "admin1_scopes_own_read" ON core.admin1_scopes
  FOR SELECT TO authenticated USING (admin_id = auth.uid());

CREATE OR REPLACE VIEW public.admin1_scopes
  WITH (security_invoker = true) AS
SELECT * FROM core.admin1_scopes;

GRANT SELECT, INSERT, UPDATE, DELETE ON core.admin1_scopes   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin1_scopes TO authenticated;
GRANT ALL ON core.admin1_scopes TO service_role;

-- ─── 2. Scope function: multi-scope union, with legacy fallback ──

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
  v_has_multi boolean;
  v_type text;
  v_as uuid; v_ap uuid; v_asch uuid;   -- assigned_* (legacy single scope)
  v_os uuid; v_op uuid; v_osch uuid;   -- own location (derived fallback)
BEGIN
  -- Multi-scope assignments win when any exist: in scope if ANY tick matches
  -- (state tick covers the whole state; pld tick the whole pld; school exact).
  SELECT EXISTS (SELECT 1 FROM core.admin1_scopes WHERE admin_id = p_admin)
    INTO v_has_multi;

  IF v_has_multi THEN
    RETURN EXISTS (
      SELECT 1 FROM core.admin1_scopes s
      WHERE s.admin_id = p_admin
        AND (
          (s.level = 'state'  AND s.ref_id = p_state)
          OR (s.level = 'pld'    AND s.ref_id = p_pld)
          OR (s.level = 'school' AND s.ref_id = p_school)
        )
    );
  END IF;

  -- Legacy single scope (migration 018), unchanged.
  SELECT scope_type, assigned_state_id, assigned_pld_id, assigned_school_id,
         state_id, pld_id, school_id
    INTO v_type, v_as, v_ap, v_asch, v_os, v_op, v_osch
  FROM core.profiles WHERE id = p_admin;

  IF v_type = 'national' THEN RETURN true; END IF;
  IF v_type = 'school' AND v_asch IS NOT NULL THEN RETURN COALESCE(p_school = v_asch, false); END IF;
  IF v_type = 'pld'    AND v_ap   IS NOT NULL THEN RETURN COALESCE(p_pld   = v_ap,   false); END IF;
  IF v_type = 'state'  AND v_as   IS NOT NULL THEN RETURN COALESCE(p_state = v_as,   false); END IF;

  IF v_osch IS NOT NULL THEN RETURN COALESCE(p_school = v_osch, false); END IF;
  IF v_op   IS NOT NULL THEN RETURN COALESCE(p_pld   = v_op,   false); END IF;
  IF v_os   IS NOT NULL THEN RETURN COALESCE(p_state = v_os,   false); END IF;

  RETURN false;
END $$;

REVOKE ALL     ON FUNCTION core.admin1_in_scope(uuid,uuid,uuid,uuid) FROM public;
GRANT  EXECUTE ON FUNCTION core.admin1_in_scope(uuid,uuid,uuid,uuid) TO authenticated;
