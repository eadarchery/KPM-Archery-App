-- ============================================================
-- Migration 087: Admin Password Reset Permission Validator
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent. Creates helper function for admin password reset validation.
--
-- WHY: Validate admin permissions before client-side password reset attempts.
--      Admin password resets are handled via Supabase client SDK (since the
--      managed service doesn't expose direct DB password updates). This function
--      provides server-side permission verification as an extra security layer.
-- ============================================================

-- Create helper function to validate admin can reset a user's password
CREATE OR REPLACE FUNCTION can_admin_reset_password(target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_role text;
  v_target_role text;
BEGIN
  -- Get the caller's ID and role
  v_actor_id := auth.uid();

  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  -- Get caller's role from profiles
  SELECT role INTO v_actor_role
  FROM profiles
  WHERE id = v_actor_id;

  -- Only super_admin and admin2 can reset passwords
  IF v_actor_role NOT IN ('super_admin', 'admin2') THEN
    RETURN false;
  END IF;

  -- Get target user's role
  SELECT role INTO v_target_role
  FROM profiles
  WHERE id = target_user_id;

  IF v_target_role IS NULL THEN
    RETURN false;
  END IF;

  -- Admin2 cannot modify super_admin accounts
  IF v_actor_role = 'admin2' AND v_target_role = 'super_admin' THEN
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

-- Create helper function to log password reset attempts
CREATE OR REPLACE FUNCTION log_password_reset(
  target_user_id uuid,
  reset_method text DEFAULT 'admin_direct'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_role text;
  v_target_role text;
BEGIN
  v_actor_id := auth.uid();

  IF v_actor_id IS NULL THEN
    RETURN;
  END IF;

  -- Get roles for audit
  SELECT role INTO v_actor_role FROM profiles WHERE id = v_actor_id;
  SELECT role INTO v_target_role FROM profiles WHERE id = target_user_id;

  -- Log the password reset action
  INSERT INTO audit_logs (
    user_id,
    actor_id,
    action,
    resource_type,
    resource_id,
    metadata,
    created_at
  ) VALUES (
    target_user_id,
    v_actor_id,
    'user.password_reset_' || reset_method,
    'auth',
    target_user_id::text,
    jsonb_build_object(
      'actor_role', v_actor_role,
      'target_role', v_target_role,
      'method', reset_method,
      'timestamp', now()::text
    ),
    now()
  );
EXCEPTION WHEN OTHERS THEN
  -- Silently fail - audit logging should not break the flow
  NULL;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION can_admin_reset_password(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION log_password_reset(uuid, text) TO authenticated;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
