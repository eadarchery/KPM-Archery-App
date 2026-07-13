-- ============================================================
-- Migration 023: Coach Profile Page Support
-- Run in Supabase Dashboard → SQL Editor.
-- ============================================================

-- ─── NEW COLUMNS ─────────────────────────────────────────────
-- coaching_level: coach's self-reported coaching tier
-- preferred_bow_categories: which bow styles they coach

ALTER TABLE coaching.coach_profiles
  ADD COLUMN IF NOT EXISTS coaching_level text,
  ADD COLUMN IF NOT EXISTS preferred_bow_categories text[] DEFAULT '{}';

-- ─── PUBLIC VIEW ─────────────────────────────────────────────
-- Exposes coaching.coach_profiles through the default public schema
-- so the Supabase JS client can reach it without schema switching.
-- security_invoker = true means all RLS policies still apply.

CREATE OR REPLACE VIEW public.coach_profiles
  WITH (security_invoker = true) AS
SELECT * FROM coaching.coach_profiles;

-- ─── GRANTS ──────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON public.coach_profiles TO authenticated;

-- ─── RLS: INSERT for coach ────────────────────────────────────
-- Coaches who have never opened their profile page have no row in
-- coaching.coach_profiles. This policy lets them create their own row.

CREATE POLICY "coaching_coach_profiles_own_insert"
  ON coaching.coach_profiles FOR INSERT TO authenticated
  WITH CHECK (
    profile_id = auth.uid()
    AND core.current_role() = 'coach'
    AND core.is_approved()
  );
