-- ============================================================
-- Migration 036: Server-side profile + archer_id on sign-up
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run.
--
-- ROOT CAUSE of "permission denied for table profiles" during
-- registration:
--   The client called supabase.from('profiles').upsert(...) right
--   after auth.signUp() to add archer_id. When email confirmation
--   is enabled, signUp() returns NO session, so that upsert runs as
--   the `anon` role — which only has SELECT on profiles → denied.
--
-- FIX (permanent, not a workaround):
--   The auth trigger already creates the profile row with SECURITY
--   DEFINER privileges. We extend it to ALSO generate a unique
--   archer_id for archers, so the client never needs to write to
--   profiles at sign-up. Works with email confirmation on or off,
--   and `anon` keeps zero write access to profiles (correct posture).
--
--   Role clamping from migration 031 (self-registration limited to
--   archer/coach) is preserved.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role      user_role;
  v_archer_id text := NULL;
BEGIN
  -- Clamp self-registration to archer/coach; anything else → pending archer.
  v_role := CASE
    WHEN (NEW.raw_user_meta_data->>'role') IN ('archer','coach')
      THEN (NEW.raw_user_meta_data->>'role')::user_role
    ELSE 'archer'::user_role
  END;

  -- Generate a unique human-readable archer_id for archers, server-side.
  -- The loop guarantees uniqueness against the UNIQUE(archer_id) constraint.
  IF v_role = 'archer' THEN
    LOOP
      v_archer_id := 'ASM-' || EXTRACT(YEAR FROM now())::int::text || '-'
                     || LPAD((floor(random() * 900000) + 100000)::int::text, 6, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM core.profiles WHERE archer_id = v_archer_id
      );
    END LOOP;
  END IF;

  INSERT INTO core.profiles (id, email, name, role, status, archer_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    v_role,
    'pending',
    v_archer_id
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Re-assert the trigger (no-op if it already points at the function above).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
