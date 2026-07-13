-- ============================================================
-- Migration 055: Coaches also register with a school code
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run. Supersedes the function
--       from migration 038 (keeps archer_id generation and the
--       archer school-code resolution unchanged).
--
-- WHY: A coach applicant previously registered with no school attached, so the
-- approving admin had to verify the school with the applicant manually. Coaches
-- know their own school's registration code — they now enter it at sign-up and
-- it is resolved server-side to requested_school_id, exactly like archers.
-- The admin sees the claimed school on the pending profile before approving.
--
-- NOTE: requested_school_id is a CLAIM, not an assignment. Approval flows keep
-- setting the official school_id explicitly.
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
  END IF;

  -- Resolve the school registration code from sign-up metadata → school id.
  -- Applies to BOTH roles: archers land in the coach's pending queue; coaches
  -- surface their claimed school to the approving admin.
  v_code := upper(trim(COALESCE(NEW.raw_user_meta_data->>'school_code', '')));
  IF v_code <> '' THEN
    SELECT id INTO v_school
    FROM org.schools
    WHERE reg_code = v_code AND active = true
    LIMIT 1;
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
