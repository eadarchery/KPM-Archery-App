-- ============================================================
-- Migration 010: Archer Profile Page Support
-- ============================================================

-- Public view for coaching.archer_profiles
-- Exposes archer extension data through the default public schema
CREATE OR REPLACE VIEW public.archer_profiles
  WITH (security_invoker = true) AS
SELECT * FROM coaching.archer_profiles;

GRANT SELECT ON public.archer_profiles TO authenticated;
GRANT SELECT ON public.archer_profiles TO anon;

-- Allow an archer to read the profile of coaches linked to them
-- (mirrors the existing "coach reads linked archer profiles" policy)
DROP POLICY IF EXISTS "core_profiles_archer_reads_linked_coach" ON core.profiles;

CREATE POLICY "core_profiles_archer_reads_linked_coach"
  ON core.profiles FOR SELECT TO authenticated
  USING (
    core.current_role() = 'archer' AND core.is_approved()
    AND EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.archer_id = auth.uid() AND cal.coach_id = core.profiles.id
    )
  );
