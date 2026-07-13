-- ============================================================
-- Migration 083: Final security/query guards
-- ------------------------------------------------------------
-- Run manually after 082. Idempotent and safe to re-run.
--
-- This closes the remaining code-side findings before scaling work:
--   * achievement grant functions are internal-only
--   * SECURITY DEFINER functions use a locked search_path
--   * pending/rejected accounts cannot consume protected storage
--   * coach certification rows require an approved coach
--   * archer coach-consent responses are serialized and revalidated
--   * client audit writes are bounded and rate-limited
-- ============================================================

-- ─── 1. Achievement functions: internal execution only ─────────────────────
-- Some manually-managed projects never applied the optional coach-achievement
-- migration (044). Harden each function when present instead of aborting the
-- entire security migration when that optional module is absent. If 044 is
-- applied later, re-run 083 so its newly-created functions are hardened too.
DO $guards$
BEGIN
  IF to_regprocedure('public.check_and_grant_achievements(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.check_and_grant_achievements(uuid) SET search_path = '';
    REVOKE ALL ON FUNCTION public.check_and_grant_achievements(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.check_and_grant_achievements(uuid) TO service_role;
  END IF;

  IF to_regprocedure('public.check_and_grant_coach_achievements(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.check_and_grant_coach_achievements(uuid) SET search_path = '';
    REVOKE ALL ON FUNCTION public.check_and_grant_coach_achievements(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.check_and_grant_coach_achievements(uuid) TO service_role;
  END IF;

  -- Trigger owners can still call the internal grant functions. Direct browser
  -- calls cannot force expensive scans for arbitrary users.
  IF to_regprocedure('public.trigger_coach_achievement_check()') IS NOT NULL THEN
    ALTER FUNCTION public.trigger_coach_achievement_check() SET search_path = '';
    REVOKE ALL ON FUNCTION public.trigger_coach_achievement_check() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.trigger_coach_link_achievement_check()') IS NOT NULL THEN
    ALTER FUNCTION public.trigger_coach_link_achievement_check() SET search_path = '';
    REVOKE ALL ON FUNCTION public.trigger_coach_link_achievement_check() FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.recheck_score_achievements()') IS NOT NULL THEN
    ALTER FUNCTION public.recheck_score_achievements() SET search_path = '';
    REVOKE ALL ON FUNCTION public.recheck_score_achievements() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.recheck_score_achievements() TO authenticated;
  END IF;
END
$guards$;

-- Lock down the SECURITY DEFINER functions introduced by migration 082.
ALTER FUNCTION core.guard_coach_link_activation() SET search_path = '';
ALTER FUNCTION public.coach_link_archer(uuid) SET search_path = '';
ALTER FUNCTION public.archer_pending_coach_links() SET search_path = '';

-- ─── 2. Approved-account storage and certification writes ─────────────────

DROP POLICY IF EXISTS "proof_photos_archer_upload" ON storage.objects;
CREATE POLICY "proof_photos_archer_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'proof-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND core.is_approved()
    AND core.current_role() IN ('archer', 'coach')
  );

DROP POLICY IF EXISTS "proof_photos_archer_read" ON storage.objects;
CREATE POLICY "proof_photos_archer_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND core.is_approved()
    AND core.current_role() IN ('archer', 'coach')
  );

DROP POLICY IF EXISTS "avatars_own_upload" ON storage.objects;
CREATE POLICY "avatars_own_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND core.is_approved()
  );

DROP POLICY IF EXISTS "certifications_coach_upload" ON storage.objects;
CREATE POLICY "certifications_coach_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'certifications'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND core.current_role() = 'coach'
    AND core.is_approved()
  );

DROP POLICY IF EXISTS "certifications_coach_read" ON storage.objects;
CREATE POLICY "certifications_coach_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'certifications'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND core.current_role() = 'coach'
    AND core.is_approved()
  );

DROP POLICY IF EXISTS "cert_coach_inserts_own" ON certification.certifications;
CREATE POLICY "cert_coach_inserts_own" ON certification.certifications
  FOR INSERT TO authenticated
  WITH CHECK (
    coach_id = auth.uid()
    AND core.current_role() = 'coach'
    AND core.is_approved()
    AND status = 'pending'
  );

DROP POLICY IF EXISTS "cert_coach_updates_own_pending" ON certification.certifications;
DROP POLICY IF EXISTS "cert_coach_updates_own" ON certification.certifications;
CREATE POLICY "cert_coach_updates_own" ON certification.certifications
  FOR UPDATE TO authenticated
  USING (
    coach_id = auth.uid()
    AND core.current_role() = 'coach'
    AND core.is_approved()
    AND status IN ('pending', 'rejected')
  )
  WITH CHECK (
    coach_id = auth.uid()
    AND core.current_role() = 'coach'
    AND core.is_approved()
    AND status IN ('pending', 'rejected', 'withdrawn')
  );

-- ─── 3. Serialize and revalidate archer consent responses ──────────────────

CREATE OR REPLACE FUNCTION public.archer_respond_coach_link(
  p_link uuid,
  p_accept boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role         text;
  v_status       text;
  v_link_archer  uuid;
  v_link_coach   uuid;
  v_link_status  text;
  v_initiated    text;
BEGIN
  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'A response is required.' USING ERRCODE = '22004';
  END IF;

  SELECT pr.role::text, pr.status
    INTO v_role, v_status
  FROM core.profiles pr
  WHERE pr.id = auth.uid();

  IF v_role <> 'archer' OR v_status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved archer can respond to coach requests.'
      USING ERRCODE = '42501';
  END IF;

  -- Row lock prevents simultaneous accept/reject requests from both succeeding.
  SELECT cal.archer_id, cal.coach_id, cal.status, cal.initiated_by
    INTO v_link_archer, v_link_coach, v_link_status, v_initiated
  FROM coaching.coach_archer_links cal
  WHERE cal.id = p_link
  FOR UPDATE;

  IF v_link_archer IS NULL OR v_link_archer <> auth.uid() THEN
    RAISE EXCEPTION 'That coach request is not yours.' USING ERRCODE = '42501';
  END IF;
  IF v_initiated <> 'coach' OR v_link_status <> 'pending' THEN
    RAISE EXCEPTION 'That request is not awaiting your approval.' USING ERRCODE = '55000';
  END IF;

  IF p_accept THEN
    IF NOT EXISTS (
      SELECT 1 FROM core.profiles c
      WHERE c.id = v_link_coach AND c.role = 'coach' AND c.status = 'approved'
    ) THEN
      RAISE EXCEPTION 'That coach account is no longer available.' USING ERRCODE = '55000';
    END IF;

    UPDATE coaching.coach_archer_links
       SET status = 'active', approved_at = now(), approved_by = auth.uid(),
           rejected_at = NULL, rejection_reason = NULL, unlinked_at = NULL
     WHERE id = p_link;

    UPDATE core.profiles
       SET coach_id = v_link_coach
     WHERE id = auth.uid() AND coach_id IS NULL;

    PERFORM public.log_audit(
      auth.uid(), 'archer.coach_link_accepted', 'coach_archer_link', p_link, NULL
    );
    RETURN 'active';
  END IF;

  UPDATE coaching.coach_archer_links
     SET status = 'rejected', rejected_at = now(), approved_at = NULL,
         approved_by = NULL
   WHERE id = p_link;

  PERFORM public.log_audit(
    auth.uid(), 'archer.coach_link_rejected', 'coach_archer_link', p_link, NULL
  );
  RETURN 'rejected';
END;
$$;

REVOKE ALL ON FUNCTION public.archer_respond_coach_link(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archer_respond_coach_link(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.archer_respond_coach_link(uuid, boolean) TO authenticated;

-- ─── 4. Bound client-written audit events ──────────────────────────────────

CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx
  ON audit.audit_logs (actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_audit(
  p_actor_id    uuid,
  p_action      text,
  p_target_type text DEFAULT NULL,
  p_target_id   uuid DEFAULT NULL,
  p_meta        jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id     uuid;
  v_actor  uuid;
  v_recent int;
BEGIN
  v_actor := COALESCE(auth.uid(), p_actor_id);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Audit actor is required.' USING ERRCODE = '22004';
  END IF;

  IF p_action IS NULL OR length(p_action) > 120
     OR p_action !~ '^[a-z0-9][a-z0-9_.-]*$' THEN
    RAISE EXCEPTION 'Invalid audit action.' USING ERRCODE = '22023';
  END IF;
  IF p_target_type IS NOT NULL AND (
    length(p_target_type) > 80 OR p_target_type !~ '^[a-z0-9][a-z0-9_.-]*$'
  ) THEN
    RAISE EXCEPTION 'Invalid audit target type.' USING ERRCODE = '22023';
  END IF;
  IF p_meta IS NOT NULL AND octet_length(p_meta::text) > 32768 THEN
    RAISE EXCEPTION 'Audit metadata is too large.' USING ERRCODE = '22001';
  END IF;

  -- Authenticated browsers may emit useful UI audit events, but cannot turn
  -- the audit table into an unbounded write endpoint. Internal/service calls
  -- (auth.uid() IS NULL) are not subject to this client rate limit.
  IF auth.uid() IS NOT NULL THEN
    SELECT count(*)::int INTO v_recent
    FROM audit.audit_logs al
    WHERE al.actor_id = v_actor
      AND al.created_at >= now() - interval '1 minute';
    IF v_recent >= 120 THEN
      RAISE EXCEPTION 'Audit event rate limit exceeded.' USING ERRCODE = '54000';
    END IF;
  END IF;

  INSERT INTO audit.audit_logs (actor_id, action, target_type, target_id, meta)
  VALUES (v_actor, p_action, p_target_type, p_target_id, p_meta)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit(uuid, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_audit(uuid, text, text, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_audit(uuid, text, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit(uuid, text, text, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
