-- ============================================================
-- Migration 082: Coach-initiated links require the archer's consent
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent. Adds one column (recreates the public view),
--       one trigger, replaces coach_link_archer, adds two RPCs.
--
-- WHY: external review — an approved coach could call coach_link_archer(any
--      archer UUID) and get an ACTIVE link instantly (migration 048), which
--      then satisfied the proof-photo storage policy → a coach could read any
--      archer's private competition photos with no consent.
--
--   The school-code flow is UNCHANGED and stays correct: there the archer
--   opts in by typing their school's code, so the coach legitimately approves
--   (coach_approve_archer / the coach page create ACTIVE links). We tell the
--   two apart with a new initiated_by marker:
--     • initiated_by='archer' → archer opted in (school code) → coach approves.
--     • initiated_by='coach'  → coach reached out       → ARCHER approves.
-- ============================================================

-- ─── 1. initiated_by marker (existing rows = 'archer', already consented) ──
ALTER TABLE coaching.coach_archer_links
  ADD COLUMN IF NOT EXISTS initiated_by text NOT NULL DEFAULT 'archer';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaching_cal_initiated_by_check') THEN
    ALTER TABLE coaching.coach_archer_links
      ADD CONSTRAINT coaching_cal_initiated_by_check CHECK (initiated_by IN ('archer','coach'));
  END IF;
END $$;

-- SELECT * view froze its column list before initiated_by existed → recreate
-- it (and re-apply grants, which do not survive a recreate).
CREATE OR REPLACE VIEW public.coach_archer_links
  WITH (security_invoker = true) AS
SELECT * FROM coaching.coach_archer_links;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_archer_links TO authenticated;

-- ─── 2. Trigger: a coach may never self-activate a link they initiated ──────
-- The archer-approve RPC below runs as the ARCHER (auth.uid() = archer_id), so
-- it is unaffected. Admins/super and the school-code flow (initiated_by='archer')
-- are unaffected. Only "coach activates own initiated_by='coach' link" is blocked.

CREATE OR REPLACE FUNCTION core.guard_coach_link_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR core.is_admin() OR core.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- Only constrain the coach acting on their own link rows.
  IF auth.uid() = NEW.coach_id THEN
    -- initiated_by is immutable to the coach (can't relabel to dodge the gate).
    IF TG_OP = 'UPDATE' AND NEW.initiated_by IS DISTINCT FROM OLD.initiated_by THEN
      RAISE EXCEPTION 'You cannot change how a coach-archer link was initiated.';
    END IF;
    -- Self-activating a coach-initiated link bypasses the archer's consent.
    IF NEW.status = 'active' AND NEW.initiated_by = 'coach' THEN
      RAISE EXCEPTION 'Coach-initiated links need the archer''s approval before they become active.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS coaching_cal_guard_activation ON coaching.coach_archer_links;
CREATE TRIGGER coaching_cal_guard_activation
  BEFORE INSERT OR UPDATE ON coaching.coach_archer_links
  FOR EACH ROW EXECUTE FUNCTION core.guard_coach_link_activation();

-- ─── 3. coach_link_archer → always PENDING (was active-on-approved) ─────────
-- Replaces migration 048's version. Creates a coach-initiated PENDING request;
-- coach_id on the profile is set only once the archer accepts (RPC below).

CREATE OR REPLACE FUNCTION public.coach_link_archer(p_archer uuid)
RETURNS text  -- resulting link status ('pending', or 'active' if already linked)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text; v_status text;
  v_a_role text; v_a_name text;
  v_existing uuid; v_existing_status text;
BEGIN
  SELECT pr.role::text, pr.status INTO v_role, v_status FROM core.profiles pr WHERE pr.id = auth.uid();
  IF v_role <> 'coach' OR v_status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved coach can link archers.';
  END IF;

  SELECT p.role::text, p.name INTO v_a_role, v_a_name
  FROM core.profiles p WHERE p.id = p_archer;
  IF v_a_role IS NULL OR v_a_role <> 'archer' THEN
    RAISE EXCEPTION 'Target is not an archer.';
  END IF;

  SELECT cal.id, cal.status INTO v_existing, v_existing_status
  FROM coaching.coach_archer_links cal
  WHERE cal.coach_id = auth.uid() AND cal.archer_id = p_archer;

  IF v_existing IS NOT NULL THEN
    -- Already approved earlier → leave it; otherwise (re)issue the request.
    IF v_existing_status = 'active' THEN
      RETURN 'active';
    END IF;
    UPDATE coaching.coach_archer_links
       SET status = 'pending', initiated_by = 'coach', linked_at = now(),
           unlinked_at = NULL, rejected_at = NULL, rejection_reason = NULL
     WHERE id = v_existing;
  ELSE
    INSERT INTO coaching.coach_archer_links (coach_id, archer_id, status, initiated_by, linked_at)
    VALUES (auth.uid(), p_archer, 'pending', 'coach', now());
  END IF;

  PERFORM public.log_audit(
    auth.uid(), 'coach.archer_link_requested', 'profile', p_archer,
    jsonb_build_object('archer_name', v_a_name)
  );
  RETURN 'pending';
END $$;
REVOKE ALL     ON FUNCTION public.coach_link_archer(uuid) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.coach_link_archer(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.coach_link_archer(uuid) TO authenticated;

-- ─── 4. archer_pending_coach_links — what the archer must respond to ────────
-- Archers cannot read a coach's profile via RLS, so this SECURITY DEFINER RPC
-- returns just enough to show the request (coach name + school).

CREATE OR REPLACE FUNCTION public.archer_pending_coach_links()
RETURNS TABLE (link_id uuid, coach_id uuid, coach_name text, coach_school text, requested_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text; v_status text;
BEGIN
  SELECT pr.role::text, pr.status INTO v_role, v_status FROM core.profiles pr WHERE pr.id = auth.uid();
  IF v_role <> 'archer' OR v_status <> 'approved' THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT cal.id, c.id, c.name, s.name, cal.linked_at
    FROM coaching.coach_archer_links cal
    JOIN core.profiles c   ON c.id = cal.coach_id
    LEFT JOIN org.schools s ON s.id = c.school_id
    WHERE cal.archer_id = auth.uid()
      AND cal.status = 'pending'
      AND cal.initiated_by = 'coach'
    ORDER BY cal.linked_at DESC;
END $$;
REVOKE ALL     ON FUNCTION public.archer_pending_coach_links() FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.archer_pending_coach_links() FROM anon;
GRANT  EXECUTE ON FUNCTION public.archer_pending_coach_links() TO authenticated;

-- ─── 5. archer_respond_coach_link — the consent gate ────────────────────────

CREATE OR REPLACE FUNCTION public.archer_respond_coach_link(p_link uuid, p_accept boolean)
RETURNS text  -- 'active' or 'rejected'
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text; v_status text;
  v_link_archer uuid; v_link_coach uuid; v_link_status text; v_initiated text;
BEGIN
  SELECT pr.role::text, pr.status INTO v_role, v_status FROM core.profiles pr WHERE pr.id = auth.uid();
  IF v_role <> 'archer' OR v_status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved archer can respond to coach requests.';
  END IF;

  SELECT cal.archer_id, cal.coach_id, cal.status, cal.initiated_by
    INTO v_link_archer, v_link_coach, v_link_status, v_initiated
  FROM coaching.coach_archer_links cal WHERE cal.id = p_link;

  IF v_link_archer IS NULL OR v_link_archer <> auth.uid() THEN
    RAISE EXCEPTION 'That coach request is not yours.';
  END IF;
  IF v_initiated <> 'coach' OR v_link_status <> 'pending' THEN
    RAISE EXCEPTION 'That request is not awaiting your approval.';
  END IF;

  IF p_accept THEN
    UPDATE coaching.coach_archer_links
       SET status = 'active', approved_at = now(), approved_by = auth.uid()
     WHERE id = p_link;
    -- Adopt this coach only if the archer has none yet.
    UPDATE core.profiles SET coach_id = v_link_coach
     WHERE id = auth.uid() AND coach_id IS NULL;
    PERFORM public.log_audit(auth.uid(), 'archer.coach_link_accepted', 'coach_archer_link', p_link, NULL);
    RETURN 'active';
  ELSE
    UPDATE coaching.coach_archer_links
       SET status = 'rejected', rejected_at = now()
     WHERE id = p_link;
    PERFORM public.log_audit(auth.uid(), 'archer.coach_link_rejected', 'coach_archer_link', p_link, NULL);
    RETURN 'rejected';
  END IF;
END $$;
REVOKE ALL     ON FUNCTION public.archer_respond_coach_link(uuid, boolean) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.archer_respond_coach_link(uuid, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.archer_respond_coach_link(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
