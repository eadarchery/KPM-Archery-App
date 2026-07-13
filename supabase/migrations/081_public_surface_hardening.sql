-- ============================================================
-- Migration 081: Public-surface hardening (external review fixes)
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent. Recreates the leaderboard view, two policies and
--       one function's grants. No columns, no data changes.
--
-- WHY: an external security review (2026-07-10) verified four exposures:
--
--   FIX A (CRITICAL, verified live): public.leaderboard was readable by the
--     anon key. Migration 075 only granted SELECT to authenticated, but
--     Supabase's DEFAULT PRIVILEGES on the public schema also grant new
--     objects to anon — and the view is owner-rights (bypasses RLS), so an
--     unauthenticated request returned archer names/schools/ages/scores.
--     → REVOKE anon/PUBLIC + rebuild the view with a core.is_approved() gate
--       so even authenticated-but-unapproved accounts see nothing.
--
--   FIX B: coaching_cal_coach_manages_own (006) had core.is_approved() in
--     USING but NOT in WITH CHECK — a PENDING coach could INSERT an 'active'
--     coach_archer_link to any archer…
--
--   FIX C: …and proof_photos_coach_reads_linked (007) trusted any active
--     link without confirming the caller is an approved coach → a pending
--     coach could chain B+C to read a targeted archer's private proof photos.
--
--   FIX D: public.log_audit is SECURITY DEFINER and kept PostgreSQL's default
--     EXECUTE grant to PUBLIC — an anon caller (auth.uid() IS NULL) hits the
--     COALESCE fallback and can insert audit rows attributed to ANY user.
--     → REVOKE PUBLIC/anon; only authenticated + service_role may execute.
-- ============================================================

-- ─── FIX A: leaderboard — no anon access + approved-users-only ───
-- Identical to migration 075's view EXCEPT the base WHERE now also requires
-- core.is_approved() (the caller must be an approved account). The view stays
-- owner-rights on purpose — see 075's SECURITY NOTE — the WHERE clause is the
-- security boundary, now including the caller gate.

DROP VIEW IF EXISTS public.leaderboard;
CREATE VIEW public.leaderboard AS
WITH base AS (
  SELECT
    s.archer_id,
    s.round_id,
    p.name                                  AS name,
    p.archer_id                             AS archer_code,
    p.age                                   AS age,
    p.gender                                AS gender,
    p.state_id, p.school_id, p.pld_id,
    st.name                                 AS state,
    st.code                                 AS state_code,
    sc.name                                 AS school,
    pl.name                                 AS pld,
    COALESCE(s.bow_category, p.bow_category) AS bow_category,
    r.name                                  AS round_name,
    r.category                              AS round_category,
    r.distance_m                            AS distance_m,
    COALESCE(
      p.birth_year,
      EXTRACT(YEAR FROM p.date_of_birth)::int,
      CASE WHEN p.age IS NOT NULL THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - p.age END
    )                                       AS birth_year,
    s.total_score                           AS best_score,
    s.max_score,
    s.date
  FROM scoring.score_submissions s
  JOIN core.profiles    p  ON p.id  = s.archer_id
  JOIN scoring.rounds   r  ON r.id  = s.round_id
  LEFT JOIN org.states  st ON st.id = p.state_id
  LEFT JOIN org.schools sc ON sc.id = p.school_id
  LEFT JOIN org.plds    pl ON pl.id = p.pld_id
  WHERE s.status = 'admin_approved'
    AND p.status = 'approved'
    AND p.role   = 'archer'
    -- Caller gate: only signed-in, APPROVED accounts may read board rows.
    -- (anon / pending / rejected → zero rows, even if a grant slips through.)
    AND core.is_approved()
),
aged AS (
  SELECT
    b.*,
    EXTRACT(YEAR FROM CURRENT_DATE)::int AS competition_year,
    CASE WHEN b.birth_year IS NOT NULL
         THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - b.birth_year END AS competition_age
  FROM base b
),
grouped AS (
  SELECT
    a.*,
    CASE
      WHEN a.competition_age IS NULL      THEN NULL
      WHEN a.competition_age <= 12        THEN 'U12'
      WHEN a.competition_age <= 15        THEN 'U15'
      WHEN a.competition_age <= 18        THEN 'U18'
      ELSE 'Open'
    END AS age_group
  FROM aged a
),
best AS (
  SELECT DISTINCT ON (archer_id, bow_category, round_category, distance_m)
    *
  FROM grouped
  ORDER BY archer_id, bow_category, round_category, distance_m, best_score DESC, date DESC
)
SELECT
  b.*,
  RANK() OVER (PARTITION BY b.state_id, b.bow_category, b.round_category, b.distance_m, b.age_group, b.gender
               ORDER BY b.best_score DESC, b.date DESC) AS state_rank,
  RANK() OVER (PARTITION BY b.bow_category, b.round_category, b.distance_m, b.age_group, b.gender
               ORDER BY b.best_score DESC, b.date DESC) AS national_rank
FROM best b;

-- Kill the default-privilege grants, then grant the one audience that needs it.
REVOKE ALL ON public.leaderboard FROM PUBLIC;
REVOKE ALL ON public.leaderboard FROM anon;
GRANT SELECT ON public.leaderboard TO authenticated;

-- ─── FIX B: only APPROVED coaches may write coach-archer links ───
-- Same policy as 006 with core.is_approved() added to WITH CHECK, so a
-- pending/rejected coach can no longer INSERT (or UPDATE rows into) links.
-- Approved-coach flows (link, approve archer, unlink) are unchanged.

DROP POLICY IF EXISTS "coaching_cal_coach_manages_own" ON coaching.coach_archer_links;
CREATE POLICY "coaching_cal_coach_manages_own" ON coaching.coach_archer_links FOR ALL TO authenticated
  USING  (coach_id = auth.uid() AND core.current_role() = 'coach' AND core.is_approved())
  WITH CHECK (coach_id = auth.uid() AND core.current_role() = 'coach' AND core.is_approved());

-- ─── FIX C: proof photos — approved coaches with an active link only ─

DROP POLICY IF EXISTS "proof_photos_coach_reads_linked" ON storage.objects;
CREATE POLICY "proof_photos_coach_reads_linked"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND core.current_role() = 'coach'
    AND core.is_approved()
    AND EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.coach_id = auth.uid()
        AND cal.archer_id::text = (storage.foldername(name))[1]
        AND cal.status = 'active'
    )
  );

-- ─── FIX D: log_audit — no anonymous execution, locked search_path ───
-- Body identical to migration 032 (actor from auth.uid(); passed id only a
-- fallback for service_role) — but anon could reach that fallback. Revoked.

CREATE OR REPLACE FUNCTION public.log_audit(
  p_actor_id    uuid,
  p_action      text,
  p_target_type text DEFAULT NULL,
  p_target_id   uuid DEFAULT NULL,
  p_meta        jsonb DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id    uuid;
  v_actor uuid;
BEGIN
  -- The authenticated caller is the source of truth; clients cannot forge an
  -- actor. The passed id is only a fallback for service_role (no JWT) calls —
  -- anon can no longer execute this function at all (REVOKE below).
  v_actor := COALESCE(auth.uid(), p_actor_id);

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

-- ─── Reload PostgREST schema cache ───────────────────────────────
NOTIFY pgrst, 'reload schema';
