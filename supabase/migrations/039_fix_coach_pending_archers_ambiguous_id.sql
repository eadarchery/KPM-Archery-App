-- ============================================================
-- Migration 039: Fix "column reference 'id' is ambiguous" in
--                public.coach_pending_archers()
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE). Safe to re-run.
--
-- BUG: the function is declared RETURNS TABLE (id uuid, ...). Those output
-- column names become variables in scope, so the unqualified `WHERE id = auth.uid()`
-- in the coach lookup was ambiguous (OUT param `id` vs core.profiles.id) and the
-- whole RPC aborted for every coach → the coach's "Pending school registrations"
-- card failed to load.
--
-- FIX: alias the table (core.profiles AS pr) and qualify the column references in
-- the coach lookup. The RETURN QUERY already qualified its columns with `p.`.
-- ============================================================

CREATE OR REPLACE FUNCTION public.coach_pending_archers()
RETURNS TABLE (id uuid, name text, email text, archer_id text, requested_school_id uuid, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role   text;
  v_status text;
  v_school uuid;
BEGIN
  SELECT pr.role::text, pr.status, pr.school_id
    INTO v_role, v_status, v_school
  FROM core.profiles pr
  WHERE pr.id = auth.uid();

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
