-- ============================================================
-- Migration 035: Fix write grants on public org views
-- ------------------------------------------------------------
-- Migration 008 granted only SELECT on public.states, public.plds,
-- and public.schools. These views are security_invoker = true, so
-- PostgreSQL checks privilege on the VIEW itself for every operation.
-- Admin 2 mutations (create/update/archive) call
--   supabase.from('states'/'plds'/'schools').insert/update(...)
-- which goes through these views — causing "permission denied" on writes.
--
-- The underlying org.states/plds/schools tables already have
-- SELECT, INSERT, UPDATE granted and RLS restricts writes to
-- core.is_admin() — so granting on the views is safe.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.states  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plds    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schools TO authenticated;
