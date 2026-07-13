-- ============================================================
-- Migration 017: Admin 2 User Management
-- ------------------------------------------------------------
-- Adds the lifecycle-tracking columns the Admin 2 User Management
-- page needs (reject / suspend attribution + admin notes), refreshes
-- the public.profiles passthrough view so the new columns are
-- reachable via PostgREST, and (PART 2) hardens profile RLS so
-- Admin 2 can never read or write a Super Admin account.
--
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       The CLI is not wired up to push migrations in this project.
--
-- Safe to re-run: every statement is idempotent.
-- Nothing here drops data or renames an existing column.
-- core.profiles already had: status (CHECK allows 'suspended'/'inactive'),
-- approved_at, approved_by, rejection_reason, state_id, pld_id, school_id,
-- updated_at — so those are intentionally NOT recreated here.
-- ============================================================

-- ─── PART 1: MISSING COLUMNS (required for the page) ─────────

ALTER TABLE core.profiles
  ADD COLUMN IF NOT EXISTS rejected_at       timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by       uuid,
  ADD COLUMN IF NOT EXISTS suspended_at      timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by      uuid,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS admin_notes       text;

-- Attribution FKs → core.profiles(id). Guarded so re-runs don't error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'core_profiles_rejected_by_fkey'
  ) THEN
    ALTER TABLE core.profiles
      ADD CONSTRAINT core_profiles_rejected_by_fkey
      FOREIGN KEY (rejected_by) REFERENCES core.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'core_profiles_suspended_by_fkey'
  ) THEN
    ALTER TABLE core.profiles
      ADD CONSTRAINT core_profiles_suspended_by_fkey
      FOREIGN KEY (suspended_by) REFERENCES core.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── REFRESH PUBLIC PASSTHROUGH VIEW ─────────────────────────
-- public.profiles was created as SELECT * at migration 006, so it does NOT
-- yet expose the columns added above. Re-running SELECT * picks them up.
-- (CREATE OR REPLACE keeps the existing columns in place and appends the new
--  ones, which Postgres allows.)

CREATE OR REPLACE VIEW public.profiles
  WITH (security_invoker = true) AS
SELECT * FROM core.profiles;

-- ============================================================
-- PART 2 (RECOMMENDED, security hardening — separable):
-- Stop Admin 2 from reading/writing Super Admin profiles at the
-- database level. The app already blocks this in the service +
-- UI layer (canManageUserWithRole), so PART 2 is defence-in-depth.
-- You may skip PART 2 if you prefer to keep the current policy;
-- the page still prevents Admin 2 from managing Super Admins.
-- ============================================================

-- Replace the single "admin (admin2 + super) full access" policy with two:
--   • Super Admin  → unrestricted on every profile row
--   • Admin 2      → full access to every row EXCEPT Super Admin rows
DROP POLICY IF EXISTS "core_profiles_admin2_full"     ON core.profiles;
DROP POLICY IF EXISTS "core_profiles_super_full"      ON core.profiles;
DROP POLICY IF EXISTS "core_profiles_admin2_nonsuper" ON core.profiles;

CREATE POLICY "core_profiles_super_full" ON core.profiles FOR ALL TO authenticated
  USING (core.is_super_admin())
  WITH CHECK (core.is_super_admin());

CREATE POLICY "core_profiles_admin2_nonsuper" ON core.profiles FOR ALL TO authenticated
  USING (core.is_admin() AND role <> 'super_admin')
  WITH CHECK (core.is_admin() AND role <> 'super_admin');

-- Notes:
--  • Existing self-access policies (own_read / own_update / own_insert),
--    coach-reads-linked and admin1-read-all are untouched, so a Super Admin
--    still manages their own profile via core_profiles_own_update.
--  • WITH CHECK (role <> 'super_admin') also stops an Admin 2 from promoting
--    anyone TO super_admin — the row would fail the check.
