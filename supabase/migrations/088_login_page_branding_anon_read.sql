-- ============================================================
-- Migration 088: Login-page branding for anonymous visitors
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent. Additive only — adds one anon RLS policy + grants.
--
-- WHY: the login page shows the brand name / tagline / login heading from
--      core.app_config, but its only read policy requires an APPROVED,
--      LOGGED-IN user (migration 026). Anonymous visitors on /login are
--      blocked, so the page always falls back to the hardcoded defaults
--      and Super Admin → Branding changes never appear pre-login.
--
-- SECURITY NOTE (intentional): anon gains SELECT on ONLY the rows where
--      is_public = true AND category = 'branding' — brand names, taglines,
--      logo URLs. No app settings, no non-public rows (e.g. brand_login_bg
--      stays is_public = false unless flipped in the Branding page), and
--      the RLS policy gates rows even if a broader grant ever slips in.
--      This does NOT weaken migration 081's hardening (leaderboard /
--      log_audit are untouched).
-- ============================================================

-- Anon must be able to resolve the core schema + read through the
-- security_invoker view (invoker needs privileges on the base table too).
GRANT USAGE ON SCHEMA core TO anon;
GRANT SELECT ON core.app_config  TO anon;
GRANT SELECT ON public.app_config TO anon;

-- Row gate: anonymous visitors see ONLY public branding rows.
DROP POLICY IF EXISTS "app_config_anon_branding_read" ON core.app_config;
CREATE POLICY "app_config_anon_branding_read" ON core.app_config
  FOR SELECT TO anon
  USING (is_public = true AND category = 'branding');

NOTIFY pgrst, 'reload schema';
