-- ============================================================
-- Migration 037: Repair Admin 2 access to profiles
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run.
--
-- SYMPTOM: Admin 2 (approved) cannot see pending users nor approve
-- them; only Super Admin sees the user list.
--
-- ROOT CAUSE: the Admin-2 cross-user policy on core.profiles went
-- missing (a DROP from 017 PART 2 / 031 / 033 landed without its
-- matching CREATE), leaving Admin 2 with only core_profiles_own_read
-- → it can read/write ONLY its own row. Super Admin kept
-- core_profiles_super_full, which is why only Super Admin sees data.
--
-- This migration re-asserts a KNOWN-GOOD end state:
--   • core.is_admin() / is_super_admin() helper functions
--   • RLS enabled on core.profiles
--   • Super Admin  → full access to every profile row
--   • Admin 2      → full access to every row EXCEPT super_admin rows
-- Self / coach / admin1 read policies are left untouched.
-- ============================================================

-- ─── 1. Ensure the helper functions are correct ────────────────

CREATE OR REPLACE FUNCTION core.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT role IN ('admin2','super_admin') AND status = 'approved'
     FROM core.profiles WHERE id = auth.uid()),
    false
  )
$$;

CREATE OR REPLACE FUNCTION core.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT role = 'super_admin' AND status = 'approved'
     FROM core.profiles WHERE id = auth.uid()),
    false
  )
$$;

-- ─── 2. Ensure RLS is on ───────────────────────────────────────

ALTER TABLE core.profiles ENABLE ROW LEVEL SECURITY;

-- ─── 3. Re-assert the admin profile policies (clean end state) ──
-- Drop every known variant name, then create exactly two.

DROP POLICY IF EXISTS "core_profiles_admin2_full"     ON core.profiles;
DROP POLICY IF EXISTS "core_profiles_super_full"      ON core.profiles;
DROP POLICY IF EXISTS "core_profiles_admin2_nonsuper" ON core.profiles;

-- Super Admin → unrestricted on every profile row.
CREATE POLICY "core_profiles_super_full" ON core.profiles FOR ALL TO authenticated
  USING (core.is_super_admin())
  WITH CHECK (core.is_super_admin());

-- Admin 2 → full access to every row EXCEPT super_admin rows.
-- (Also blocks Admin 2 from promoting anyone TO super_admin.)
CREATE POLICY "core_profiles_admin2_nonsuper" ON core.profiles FOR ALL TO authenticated
  USING (core.is_admin() AND role <> 'super_admin')
  WITH CHECK (core.is_admin() AND role <> 'super_admin');

-- ─── 4. Sanity check — run this SELECT after applying ──────────
-- Expect to see: core_profiles_own_read, core_profiles_own_update,
-- core_profiles_own_insert, core_profiles_coach_reads_linked,
-- core_profiles_admin1_read_all, core_profiles_super_full,
-- core_profiles_admin2_nonsuper.
--
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'core' AND tablename = 'profiles'
--   ORDER BY policyname;
