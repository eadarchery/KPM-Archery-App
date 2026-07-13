-- ============================================================
-- Migration 040: Super-Admin permanent user deletion (end-to-end)
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR, as the default
--       (postgres) role — NOT with the "authenticated" role selector,
--       or the function won't own the privileges to delete auth.users.
--       Idempotent (CREATE OR REPLACE). Safe to re-run.
--
-- Permanently deletes a user and ALL their data:
--   • their profile + everything that cascades from it (archer/coach profile,
--     coach links, own scores/training/equipment, certifications, notification
--     reads, achievements, change requests, school assignments)
--   • their auth.users login (cascades auth identities/sessions)
--   • de-attaches every remaining reference so nothing blocks the delete:
--       - nullable references → set NULL (de-attributed)
--       - NOT NULL references (authored articles/notifications/achievements) →
--         reassigned to the deleting Super Admin so that content survives
--
-- SECURITY: only a Super Admin may run it, and never on their own account.
-- Runs SECURITY DEFINER (as the function owner) so no service-role key is ever
-- needed in the frontend.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_target uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_email  text;
  v_name   text;
  fk       RECORD;
BEGIN
  IF NOT core.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can permanently delete users.';
  END IF;

  IF p_target = v_caller THEN
    RAISE EXCEPTION 'You cannot delete your own account.';
  END IF;

  SELECT email, name INTO v_email, v_name FROM core.profiles WHERE id = p_target;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User not found.';
  END IF;

  -- De-attach every FK column referencing core.profiles(id) whose ON DELETE is
  -- NO ACTION / RESTRICT (confdeltype a/r) — these would otherwise block the
  -- delete. CASCADE (c) and SET NULL (n) columns are handled by the FK itself.
  FOR fk IN
    SELECT n.nspname AS sch, c.relname AS tbl, a.attname AS col, a.attnotnull AS notnull
    FROM pg_constraint con
    JOIN pg_class      c  ON c.oid  = con.conrelid
    JOIN pg_namespace  n  ON n.oid  = c.relnamespace
    JOIN pg_attribute  a  ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
    JOIN pg_class      fc ON fc.oid = con.confrelid
    JOIN pg_namespace  fn ON fn.oid = fc.relnamespace
    WHERE con.contype = 'f'
      AND fn.nspname = 'core' AND fc.relname = 'profiles'
      AND con.confdeltype IN ('a', 'r')
  LOOP
    IF fk.notnull THEN
      -- Reassign authored/required references to the deleting Super Admin.
      EXECUTE format('UPDATE %I.%I SET %I = $2 WHERE %I = $1', fk.sch, fk.tbl, fk.col, fk.col)
        USING p_target, v_caller;
    ELSE
      EXECUTE format('UPDATE %I.%I SET %I = NULL WHERE %I = $1', fk.sch, fk.tbl, fk.col, fk.col)
        USING p_target;
    END IF;
  END LOOP;

  -- Remove the user's own data (cascades) and their login.
  DELETE FROM core.profiles WHERE id = p_target;
  DELETE FROM auth.users    WHERE id = p_target;

  PERFORM public.log_audit(
    v_caller, 'super_admin.user_deleted', 'profile', p_target,
    jsonb_build_object('email', v_email, 'name', v_name)
  );
END $$;

REVOKE ALL     ON FUNCTION public.admin_delete_user(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
