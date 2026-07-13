-- ============================================================
-- Migration 073: KPM Coach Certification List — per-coach drill-down
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE only). Run AFTER 063.
--       Additive only — nothing renamed, dropped, or altered.
--
-- WHY: the Coaches cards (Total / Active / Certified / Uncertified /
--      Expired / Expiring) only had COUNTS. This returns one row per
--      scoped coach with the same cert flags the summary uses PLUS the
--      number of certifications and the actual certificate list (title,
--      level, issuer, status, expiry) so the report can list who holds
--      what.
--
-- REUSE: reads public.kpm_scoped_coaches (063) for scope + cert flags, so
--   the lists reconcile with the coverage counts. SECURITY INVOKER + RLS.
--
-- CARD → client filter (over coach_status / has_valid_cert / etc.):
--   Total       = all rows
--   Active       = coach_status = 'approved'
--   Certified    = approved AND has_valid_cert
--   Uncertified  = approved AND NOT has_valid_cert
--   Expired      = approved AND NOT has_valid_cert AND has_expired_cert
--   Expiring ≤90 = approved AND has_valid_cert AND days_to_expiry <= 90
-- ============================================================

CREATE OR REPLACE FUNCTION public.kpm_coach_certifications(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  coach_id uuid, coach_name text,
  state text, pld text, school text,
  coach_status text, cert_status text, eff_level text,
  experience_years int,
  has_valid_cert boolean, has_expired_cert boolean,
  max_cert_expiry date, days_to_expiry int,
  cert_count int, approved_cert_count int,
  certs jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH co AS (SELECT * FROM public.kpm_scoped_coaches(p_filters)),
  ce AS (
    SELECT
      c.coach_id,
      count(*)::int AS cert_count,
      (count(*) FILTER (WHERE c.status = 'approved'))::int AS approved_cert_count,
      jsonb_agg(jsonb_build_object(
        'title',  c.title,
        'level',  c.certificate_level,
        'issuer', c.issuer,
        'status', c.status,
        'expiry', c.expiry_date,
        'issued', c.issued_date
      ) ORDER BY c.issued_date DESC NULLS LAST) AS certs
    FROM certification.certifications c
    GROUP BY c.coach_id
  )
  SELECT
    co.id, p.name,
    st.name, pl.name, sc.name,
    co.status, co.cert_status, co.eff_level,
    co.experience_years,
    co.has_valid_cert, co.has_expired_cert,
    co.max_cert_expiry,
    CASE WHEN co.max_cert_expiry IS NULL THEN NULL ELSE (co.max_cert_expiry - CURRENT_DATE) END,
    COALESCE(ce.cert_count, 0),
    COALESCE(ce.approved_cert_count, 0),
    COALESCE(ce.certs, '[]'::jsonb)
  FROM co
  JOIN core.profiles p ON p.id = co.id
  LEFT JOIN ce ON ce.coach_id = co.id
  LEFT JOIN org.states  st ON st.id = co.state_id
  LEFT JOIN org.plds    pl ON pl.id = co.pld_id
  LEFT JOIN org.schools sc ON sc.id = co.school_id
  ORDER BY p.name;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_coach_certifications(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_coach_certifications(jsonb) TO authenticated;
