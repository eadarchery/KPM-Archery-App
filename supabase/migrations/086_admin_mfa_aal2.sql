-- ============================================================
-- Migration 086: Require AAL2 sessions for application admins
-- ------------------------------------------------------------
-- Run manually after 085, immediately before deploying the frontend that
-- provides /admin-mfa. Applying this first will intentionally block existing
-- admin sessions from privileged reads until they enroll/verify TOTP.
-- ============================================================

CREATE OR REPLACE FUNCTION core.session_has_admin_mfa()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(auth.jwt()->>'aal' = 'aal2', false);
$$;

CREATE OR REPLACE FUNCTION core.current_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p.role IN ('admin1','admin2','super_admin')
      AND NOT core.session_has_admin_mfa() THEN NULL::public.user_role
    ELSE p.role
  END
  FROM core.profiles p
  WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION core.is_approved()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT p.status = 'approved'
      AND (
        p.role NOT IN ('admin1','admin2','super_admin')
        OR core.session_has_admin_mfa()
      )
    FROM core.profiles p
    WHERE p.id = auth.uid()
  ), false);
$$;

CREATE OR REPLACE FUNCTION core.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT p.role IN ('admin2','super_admin')
      AND p.status = 'approved'
      AND core.session_has_admin_mfa()
    FROM core.profiles p
    WHERE p.id = auth.uid()
  ), false);
$$;

CREATE OR REPLACE FUNCTION core.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT p.role = 'super_admin'
      AND p.status = 'approved'
      AND core.session_has_admin_mfa()
    FROM core.profiles p
    WHERE p.id = auth.uid()
  ), false);
$$;

-- Migration 059 used a direct role lookup, bypassing the shared helpers.
CREATE OR REPLACE FUNCTION core.can_admin_validate_archer(p_archer uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.user_role;
  v_state uuid;
  v_pld uuid;
  v_school uuid;
BEGIN
  v_role := core.current_role();
  IF v_role IS NULL OR NOT core.is_approved() THEN RETURN false; END IF;
  IF v_role IN ('admin2','super_admin') THEN RETURN true; END IF;
  IF v_role <> 'admin1' THEN RETURN false; END IF;

  SELECT p.state_id, p.pld_id, p.school_id
  INTO v_state, v_pld, v_school
  FROM core.profiles p
  WHERE p.id = p_archer;

  RETURN core.admin1_in_scope(auth.uid(), v_state, v_pld, v_school);
END;
$$;

REVOKE ALL ON FUNCTION core.session_has_admin_mfa() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.current_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.is_approved() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.is_super_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.can_admin_validate_archer(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION core.session_has_admin_mfa() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.current_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.is_approved() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.can_admin_validate_archer(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
