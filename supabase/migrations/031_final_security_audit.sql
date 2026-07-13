-- ============================================================
-- Migration 031: Final Security Audit — profile privilege hardening
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       It is idempotent and safe to re-run.
--
-- Closes a privilege-escalation gap at the DATABASE layer (defense in depth;
-- the UI + service layers already block these, but RLS must too):
--
--   ISSUE 1 (critical): core_profiles_own_update only checked `id = auth.uid()`,
--     so any authenticated user could PATCH their own profile row and set
--     role='super_admin' / status='approved' directly via PostgREST. A guard
--     trigger now makes a user's OWN role + status immutable to themselves.
--
--   ISSUE 2: public.handle_new_user() trusted raw_user_meta_data->>'role', so a
--     crafted sign-up could create a (pending) super_admin/admin row. Self
--     sign-up is now clamped to a pending archer/coach.
--
--   ISSUE 3 (defense in depth): re-assert the profile policies from migration
--     017 PART 2 so Admin 2 can never read/write a Super Admin row nor promote
--     anyone TO super_admin — guaranteed even if 017 PART 2 was skipped.
--
-- Legitimate flows are unaffected:
--   • Users editing their own profile change name/phone/avatar/etc. (not role/status).
--   • Admins act on OTHER users' rows (auth.uid() <> row id) → governed by RLS.
--   • Manual super-admin seeding via SQL Editor / service_role has auth.uid() = NULL,
--     so the self-guard is skipped and seeding still works.
-- ============================================================

-- ─── ISSUE 2: clamp self sign-up role ──────────────────────────
-- Only archer/coach may be self-assigned at registration; status stays pending.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO core.profiles (id, email, name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    CASE
      WHEN (NEW.raw_user_meta_data->>'role') IN ('archer','coach')
        THEN (NEW.raw_user_meta_data->>'role')::user_role
      ELSE 'archer'::user_role
    END,
    'pending'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ─── ISSUE 1: a user can never change their OWN role / status ───
-- Also clamps a self-INSERT (edge case) to a pending non-privileged account.

CREATE OR REPLACE FUNCTION core.guard_profile_privilege()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Super admins are fully trusted; SQL Editor / service_role has auth.uid() = NULL.
  IF auth.uid() IS NULL OR core.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.id = auth.uid()
       AND (NEW.role NOT IN ('archer','coach') OR NEW.status <> 'pending') THEN
      RAISE EXCEPTION 'Self-registered accounts must be a pending archer or coach.';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: editing your OWN row cannot change role or account status.
  IF auth.uid() = OLD.id
     AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'You cannot change your own role or account status.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS core_profiles_guard_privilege ON core.profiles;
CREATE TRIGGER core_profiles_guard_privilege
  BEFORE INSERT OR UPDATE ON core.profiles
  FOR EACH ROW EXECUTE FUNCTION core.guard_profile_privilege();

-- ─── ISSUE 3: re-assert Admin 2 vs Super Admin profile policies ─
-- (Identical to migration 017 PART 2 — safe to run again.)

DROP POLICY IF EXISTS "core_profiles_admin2_full"     ON core.profiles;
DROP POLICY IF EXISTS "core_profiles_super_full"      ON core.profiles;
DROP POLICY IF EXISTS "core_profiles_admin2_nonsuper" ON core.profiles;

CREATE POLICY "core_profiles_super_full" ON core.profiles FOR ALL TO authenticated
  USING (core.is_super_admin())
  WITH CHECK (core.is_super_admin());

CREATE POLICY "core_profiles_admin2_nonsuper" ON core.profiles FOR ALL TO authenticated
  USING (core.is_admin() AND role <> 'super_admin')
  WITH CHECK (core.is_admin() AND role <> 'super_admin');

-- ─── NOTES ─────────────────────────────────────────────────────
--  • After this runs: no archer/coach/admin1/admin2 can self-promote; Admin 2
--    cannot touch Super Admin rows nor promote anyone to Super Admin; the only
--    way to create/elevate a Super Admin is manual SQL / service_role (intended).
--  • This does NOT change any application code — the frontend already enforced
--    these rules; this makes the database enforce them too.
