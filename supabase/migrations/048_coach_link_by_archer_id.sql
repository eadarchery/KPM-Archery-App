-- ============================================================
-- Migration 048: Coach links an archer by Archer ID (cross-school)
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- The "+ Link Archer" search silently failed for any archer NOT already
-- linked: profiles RLS only lets a coach read linked archers, so the lookup
-- returned nothing. These SECURITY DEFINER RPCs let an approved coach:
--   • coach_find_archer(code)  — preview a small, safe subset of the archer's
--     profile by their Archer ID (works across schools; no full-table access)
--   • coach_link_archer(id)    — create/reactivate the link (active when the
--     archer is approved, pending otherwise), set profile.coach_id when empty,
--     and audit-log it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.coach_find_archer(p_code text)
RETURNS TABLE (id uuid, name text, archer_id text, age int, status text, school_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text; v_status text;
BEGIN
  SELECT pr.role::text, pr.status INTO v_role, v_status FROM core.profiles pr WHERE pr.id = auth.uid();
  IF v_role <> 'coach' OR v_status <> 'approved' THEN
    RETURN; -- only approved coaches may search
  END IF;

  RETURN QUERY
    SELECT p.id, p.name, p.archer_id, p.age, p.status, s.name
    FROM core.profiles p
    LEFT JOIN org.schools s ON s.id = p.school_id
    WHERE p.role = 'archer' AND upper(trim(p.archer_id)) = upper(trim(p_code))
    LIMIT 1;
END $$;
REVOKE ALL     ON FUNCTION public.coach_find_archer(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.coach_find_archer(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.coach_link_archer(p_archer uuid)
RETURNS text  -- resulting link status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text; v_status text;
  v_a_role text; v_a_status text; v_a_name text;
  v_link_status text;
  v_existing uuid;
BEGIN
  SELECT pr.role::text, pr.status INTO v_role, v_status FROM core.profiles pr WHERE pr.id = auth.uid();
  IF v_role <> 'coach' OR v_status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved coach can link archers.';
  END IF;

  SELECT p.role::text, p.status, p.name INTO v_a_role, v_a_status, v_a_name
  FROM core.profiles p WHERE p.id = p_archer;
  IF v_a_role IS NULL OR v_a_role <> 'archer' THEN
    RAISE EXCEPTION 'Target is not an archer.';
  END IF;

  -- Approved archer → active link immediately; otherwise pending.
  v_link_status := CASE WHEN v_a_status = 'approved' THEN 'active' ELSE 'pending' END;

  SELECT cal.id INTO v_existing
  FROM coaching.coach_archer_links cal
  WHERE cal.coach_id = auth.uid() AND cal.archer_id = p_archer;

  IF v_existing IS NOT NULL THEN
    UPDATE coaching.coach_archer_links
       SET status = v_link_status, linked_at = now(), unlinked_at = NULL,
           approved_at = CASE WHEN v_link_status = 'active' THEN now() ELSE approved_at END,
           approved_by = CASE WHEN v_link_status = 'active' THEN auth.uid() ELSE approved_by END,
           rejected_at = NULL, rejection_reason = NULL
     WHERE id = v_existing;
  ELSE
    INSERT INTO coaching.coach_archer_links (coach_id, archer_id, status, linked_at, approved_at, approved_by)
    VALUES (auth.uid(), p_archer, v_link_status, now(),
            CASE WHEN v_link_status = 'active' THEN now() END,
            CASE WHEN v_link_status = 'active' THEN auth.uid() END);
  END IF;

  -- Point the archer at this coach when they have none yet.
  IF v_link_status = 'active' THEN
    UPDATE core.profiles SET coach_id = auth.uid()
    WHERE id = p_archer AND coach_id IS NULL;
  END IF;

  PERFORM public.log_audit(
    auth.uid(), 'coach.archer_linked_by_id', 'profile', p_archer,
    jsonb_build_object('archer_name', v_a_name, 'link_status', v_link_status)
  );

  RETURN v_link_status;
END $$;
REVOKE ALL     ON FUNCTION public.coach_link_archer(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.coach_link_archer(uuid) TO authenticated;
