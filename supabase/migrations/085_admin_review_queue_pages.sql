-- ============================================================
-- Migration 085: Bounded Admin 2 review queues
-- ------------------------------------------------------------
-- Run manually after 084. Idempotent.
--
-- Scores, certifications and profile-change requests previously loaded their
-- complete result sets and joined/filter them in the browser. This RPC keeps
-- PII behind an explicit admin check and returns at most 101 rows (the UI uses
-- 51: 50 visible rows plus one next-page marker).
-- ============================================================

DROP FUNCTION IF EXISTS public.admin2_review_queue_page(
  text, jsonb, timestamptz, uuid, int
);

CREATE FUNCTION public.admin2_review_queue_page(
  p_queue text,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_after_created timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_search text := NULLIF(lower(trim(p_filters->>'search')), '');
BEGIN
  IF NOT core.is_admin() THEN
    RAISE EXCEPTION 'Administrator required.' USING ERRCODE = '42501';
  END IF;
  IF p_queue NOT IN ('scores', 'certifications', 'change_requests') THEN
    RAISE EXCEPTION 'Invalid review queue.' USING ERRCODE = '22023';
  END IF;
  IF p_after_created IS NOT NULL AND p_after_id IS NULL THEN
    RAISE EXCEPTION 'Incomplete review queue cursor.' USING ERRCODE = '22023';
  END IF;

  IF p_queue = 'scores' THEN
    RETURN QUERY
    SELECT jsonb_build_object(
      'id', s.id, 'archer_id', s.archer_id, 'coach_id', s.coach_id,
      'round_id', s.round_id, 'date', s.date, 'total_score', s.total_score,
      'max_score', s.max_score, 'bow_category', s.bow_category,
      'notes', s.notes, 'status', s.status, 'proof_url', s.proof_url,
      'coach_approved_at', s.coach_approved_at,
      'admin_approved_at', s.admin_approved_at, 'approved_by', s.approved_by,
      'rejection_reason', s.rejection_reason, 'created_at', s.created_at,
      'archer', jsonb_build_object(
        'id', a.id, 'name', a.name, 'archer_id', a.archer_id,
        'role', a.role, 'age', a.age,
        'school', CASE WHEN sc.id IS NULL THEN NULL ELSE jsonb_build_object('id', sc.id, 'name', sc.name) END,
        'pld', CASE WHEN pl.id IS NULL THEN NULL ELSE jsonb_build_object('id', pl.id, 'name', pl.name) END,
        'state', CASE WHEN st.id IS NULL THEN NULL ELSE jsonb_build_object('id', st.id, 'name', st.name, 'code', st.code) END
      ),
      'round', jsonb_build_object(
        'id', r.id, 'name', r.name, 'category', r.category,
        'max_score', r.max_score, 'bow_categories', r.bow_categories
      ),
      'coach', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'name', c.name, 'role', c.role) END
    )
    FROM scoring.score_submissions s
    JOIN core.profiles a ON a.id = s.archer_id
    JOIN scoring.rounds r ON r.id = s.round_id
    LEFT JOIN core.profiles c ON c.id = s.coach_id
    LEFT JOIN org.schools sc ON sc.id = a.school_id
    LEFT JOIN org.plds pl ON pl.id = a.pld_id
    LEFT JOIN org.states st ON st.id = a.state_id
    WHERE (NULLIF(p_filters->>'status', '') IS NULL OR s.status = p_filters->>'status')
      AND (NULLIF(p_filters->>'date_from', '') IS NULL OR s.date >= (p_filters->>'date_from')::date)
      AND (NULLIF(p_filters->>'date_to', '') IS NULL OR s.date <= (p_filters->>'date_to')::date)
      AND (NULLIF(p_filters->>'role', '') IS NULL OR a.role::text = p_filters->>'role')
      AND (NULLIF(p_filters->>'state_code', '') IS NULL OR st.code = p_filters->>'state_code')
      AND (NULLIF(p_filters->>'pld_id', '') IS NULL OR a.pld_id = (p_filters->>'pld_id')::uuid)
      AND (NULLIF(p_filters->>'school_id', '') IS NULL OR a.school_id = (p_filters->>'school_id')::uuid)
      AND (NULLIF(p_filters->>'bow_category', '') IS NULL OR COALESCE(s.bow_category::text, a.bow_category::text) = p_filters->>'bow_category')
      AND (NULLIF(p_filters->>'round_type', '') IS NULL OR lower(r.category) = lower(p_filters->>'round_type'))
      AND (
        NULLIF(p_filters->>'age_group', '') IS NULL
        OR (p_filters->>'age_group' = 'u14' AND a.age <= 14)
        OR (p_filters->>'age_group' = 'u18' AND a.age BETWEEN 15 AND 18)
        OR (p_filters->>'age_group' = 'u21' AND a.age BETWEEN 19 AND 21)
        OR (p_filters->>'age_group' = 'open' AND a.age >= 22)
      )
      AND (
        v_search IS NULL
        OR lower(COALESCE(a.name, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(a.archer_id, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(sc.name, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(pl.name, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(r.name, '')) LIKE '%' || v_search || '%'
        OR s.id::text = v_search
      )
      AND (p_after_created IS NULL OR (s.created_at, s.id) < (p_after_created, p_after_id))
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT v_limit + 1;

  ELSIF p_queue = 'certifications' THEN
    RETURN QUERY
    SELECT jsonb_build_object(
      'id', x.id, 'coach_id', x.coach_id, 'title', x.title,
      'issuer', x.issuer, 'certificate_level', x.certificate_level,
      'certificate_number', x.certificate_number, 'issued_date', x.issued_date,
      'expiry_date', x.expiry_date, 'cert_url', x.cert_url, 'status', x.status,
      'rejection_reason', x.rejection_reason, 'reviewed_by', x.reviewed_by,
      'reviewed_at', x.reviewed_at, 'notes', x.notes, 'created_at', x.created_at,
      'coach', jsonb_build_object(
        'id', c.id, 'name', c.name, 'email', c.email,
        'school', CASE WHEN sc.id IS NULL THEN NULL ELSE jsonb_build_object('id', sc.id, 'name', sc.name) END,
        'pld', CASE WHEN pl.id IS NULL THEN NULL ELSE jsonb_build_object('id', pl.id, 'name', pl.name) END,
        'state', CASE WHEN st.id IS NULL THEN NULL ELSE jsonb_build_object('id', st.id, 'name', st.name, 'code', st.code) END
      )
    )
    FROM certification.certifications x
    JOIN core.profiles c ON c.id = x.coach_id
    LEFT JOIN org.schools sc ON sc.id = c.school_id
    LEFT JOIN org.plds pl ON pl.id = c.pld_id
    LEFT JOIN org.states st ON st.id = c.state_id
    WHERE (NULLIF(p_filters->>'status', '') IS NULL OR x.status = p_filters->>'status')
      AND (COALESCE((p_filters->>'expiring_soon')::boolean, false) IS FALSE OR
           (x.status = 'approved' AND x.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 60))
      AND (NULLIF(p_filters->>'issued_from', '') IS NULL OR x.issued_date >= (p_filters->>'issued_from')::date)
      AND (NULLIF(p_filters->>'issued_to', '') IS NULL OR x.issued_date <= (p_filters->>'issued_to')::date)
      AND (NULLIF(p_filters->>'expiry_from', '') IS NULL OR x.expiry_date >= (p_filters->>'expiry_from')::date)
      AND (NULLIF(p_filters->>'expiry_to', '') IS NULL OR x.expiry_date <= (p_filters->>'expiry_to')::date)
      AND (NULLIF(p_filters->>'state_code', '') IS NULL OR st.code = p_filters->>'state_code')
      AND (NULLIF(p_filters->>'pld_id', '') IS NULL OR c.pld_id = (p_filters->>'pld_id')::uuid)
      AND (NULLIF(p_filters->>'school_id', '') IS NULL OR c.school_id = (p_filters->>'school_id')::uuid)
      AND (NULLIF(p_filters->>'cert_level', '') IS NULL OR x.certificate_level = p_filters->>'cert_level')
      AND (NULLIF(p_filters->>'issuer', '') IS NULL OR lower(COALESCE(x.issuer, '')) LIKE '%' || lower(p_filters->>'issuer') || '%')
      AND (
        v_search IS NULL
        OR lower(COALESCE(c.name, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(c.email, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(sc.name, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(pl.name, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(x.title, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(x.issuer, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(x.certificate_number, '')) LIKE '%' || v_search || '%'
      )
      AND (p_after_created IS NULL OR (x.created_at, x.id) < (p_after_created, p_after_id))
    ORDER BY x.created_at DESC, x.id DESC
    LIMIT v_limit + 1;

  ELSE
    RETURN QUERY
    SELECT jsonb_build_object(
      'id', q.id, 'user_id', q.user_id, 'requested_by', q.requested_by,
      'field_key', q.field_key, 'field_label', q.field_label,
      'current_value', q.current_value, 'requested_value', q.requested_value,
      'reason', q.reason, 'status', q.status,
      'supporting_file_bucket', q.supporting_file_bucket,
      'supporting_file_path', q.supporting_file_path,
      'reviewed_by', q.reviewed_by, 'reviewed_at', q.reviewed_at,
      'review_note', q.review_note, 'rejection_reason', q.rejection_reason,
      'created_at', q.created_at, 'updated_at', q.updated_at,
      'archer', jsonb_build_object(
        'id', a.id, 'name', a.name, 'email', a.email, 'archer_id', a.archer_id,
        'school', CASE WHEN sc.id IS NULL THEN NULL ELSE jsonb_build_object('id', sc.id, 'name', sc.name) END,
        'pld', CASE WHEN pl.id IS NULL THEN NULL ELSE jsonb_build_object('id', pl.id, 'name', pl.name) END,
        'state', CASE WHEN st.id IS NULL THEN NULL ELSE jsonb_build_object('id', st.id, 'name', st.name, 'code', st.code) END
      ),
      'reviewer', CASE WHEN rv.id IS NULL THEN NULL ELSE jsonb_build_object('id', rv.id, 'name', rv.name, 'email', rv.email) END
    )
    FROM core.profile_change_requests q
    JOIN core.profiles a ON a.id = q.user_id
    LEFT JOIN core.profiles rv ON rv.id = q.reviewed_by
    LEFT JOIN org.schools sc ON sc.id = a.school_id
    LEFT JOIN org.plds pl ON pl.id = a.pld_id
    LEFT JOIN org.states st ON st.id = a.state_id
    WHERE (NULLIF(p_filters->>'status', '') IS NULL OR q.status = p_filters->>'status')
      AND (NULLIF(p_filters->>'field_key', '') IS NULL OR q.field_key = p_filters->>'field_key')
      AND (NULLIF(p_filters->>'state_id', '') IS NULL OR a.state_id = (p_filters->>'state_id')::uuid)
      AND (NULLIF(p_filters->>'pld_id', '') IS NULL OR a.pld_id = (p_filters->>'pld_id')::uuid)
      AND (NULLIF(p_filters->>'school_id', '') IS NULL OR a.school_id = (p_filters->>'school_id')::uuid)
      AND (NULLIF(p_filters->>'date_from', '') IS NULL OR q.created_at >= (p_filters->>'date_from')::date)
      AND (NULLIF(p_filters->>'date_to', '') IS NULL OR q.created_at < (p_filters->>'date_to')::date + 1)
      AND (
        v_search IS NULL
        OR lower(COALESCE(a.name, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(a.email, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(a.archer_id, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(q.field_label, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(q.requested_value, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(q.current_value, '')) LIKE '%' || v_search || '%'
        OR lower(COALESCE(q.reason, '')) LIKE '%' || v_search || '%'
      )
      AND (p_after_created IS NULL OR (q.created_at, q.id) < (p_after_created, p_after_id))
    ORDER BY q.created_at DESC, q.id DESC
    LIMIT v_limit + 1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin2_review_queue_page(
  text, jsonb, timestamptz, uuid, int
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin2_review_queue_page(
  text, jsonb, timestamptz, uuid, int
) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin2_review_queue_summary(p_queue text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT core.is_admin() THEN
    RAISE EXCEPTION 'Administrator required.' USING ERRCODE = '42501';
  END IF;

  IF p_queue = 'scores' THEN
    SELECT jsonb_build_object(
      'pending_validation', count(*) FILTER (WHERE status = 'coach_approved'),
      'validated', count(*) FILTER (WHERE status = 'admin_approved'),
      'rejected', count(*) FILTER (WHERE status = 'rejected'),
      'all', count(*)
    ) INTO v_result FROM scoring.score_submissions;
  ELSIF p_queue = 'certifications' THEN
    SELECT jsonb_build_object(
      'pending_review', count(*) FILTER (WHERE status = 'pending'),
      'approved', count(*) FILTER (WHERE status = 'approved'),
      'rejected', count(*) FILTER (WHERE status = 'rejected'),
      'expiring_soon', count(*) FILTER (
        WHERE status = 'approved' AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 60
      ),
      'all', count(*)
    ) INTO v_result FROM certification.certifications;
  ELSIF p_queue = 'change_requests' THEN
    SELECT jsonb_build_object(
      'pending', count(*) FILTER (WHERE status = 'pending'),
      'approved', count(*) FILTER (WHERE status = 'approved'),
      'rejected', count(*) FILTER (WHERE status = 'rejected'),
      'withdrawn', count(*) FILTER (WHERE status = 'withdrawn'),
      'all', count(*),
      'today', count(*) FILTER (WHERE created_at >= CURRENT_DATE)
    ) INTO v_result FROM core.profile_change_requests;
  ELSE
    RAISE EXCEPTION 'Invalid review queue.' USING ERRCODE = '22023';
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin2_review_queue_summary(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin2_review_queue_summary(text) TO authenticated;

CREATE INDEX IF NOT EXISTS scoring_submissions_status_created_page_idx
  ON scoring.score_submissions (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS certification_status_created_page_idx
  ON certification.certifications (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS pcr_status_created_page_idx
  ON core.profile_change_requests (status, created_at DESC, id DESC);

NOTIFY pgrst, 'reload schema';
