-- ============================================================
-- Migration 038: Resolve school code → requested_school_id at sign-up
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run. Supersedes the function
--       from migration 036 (keeps the archer_id generation).
--
-- WHY: An archer enters a school registration code at sign-up. Previously the
-- code was claimed client-side AFTER sign-up (claim_school_code RPC), which
-- needs a session. With email confirmation enabled there is no session yet, so
-- requested_school_id was never set and the archer never appeared in the coach's
-- pending queue (coach_pending_archers filters on requested_school_id).
--
-- FIX: pass the code in the sign-up metadata (raw_user_meta_data->>'school_code')
-- and resolve it to requested_school_id here, server-side and atomically, with
-- SECURITY DEFINER privileges. No session, no localStorage, no timing window.
-- The client-side claim (immediate + deferred) remains as a harmless fallback.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role      user_role;
  v_archer_id text := NULL;
  v_code      text;
  v_school    uuid := NULL;
BEGIN
  -- Clamp self-registration to archer/coach; anything else → pending archer.
  v_role := CASE
    WHEN (NEW.raw_user_meta_data->>'role') IN ('archer','coach')
      THEN (NEW.raw_user_meta_data->>'role')::user_role
    ELSE 'archer'::user_role
  END;

  IF v_role = 'archer' THEN
    -- Unique human-readable archer_id (loop guards the UNIQUE constraint).
    LOOP
      v_archer_id := 'ASM-' || EXTRACT(YEAR FROM now())::int::text || '-'
                     || LPAD((floor(random() * 900000) + 100000)::int::text, 6, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM core.profiles WHERE archer_id = v_archer_id
      );
    END LOOP;

    -- Resolve the school registration code from sign-up metadata → school id.
    v_code := upper(trim(COALESCE(NEW.raw_user_meta_data->>'school_code', '')));
    IF v_code <> '' THEN
      SELECT id INTO v_school
      FROM org.schools
      WHERE reg_code = v_code AND active = true
      LIMIT 1;
    END IF;
  END IF;

  INSERT INTO core.profiles (id, email, name, role, status, archer_id, requested_school_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    v_role,
    'pending',
    v_archer_id,
    v_school
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
