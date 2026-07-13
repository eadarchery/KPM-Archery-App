-- ============================================================
-- Migration 056: School bulk-import support (meta jsonb)
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run.
--
-- Admin 2 can import the national school list from an Excel export
-- (NEGERI / PPD / KODSEKOLAH / NAMASEKOLAH / address / contact columns).
-- Columns the app has no dedicated field for yet (coordinates for a future
-- weather API, MURID/GURU counts, BANTUAN, PERINGKAT, …) are preserved
-- as-is in schools.meta so nothing from the source file is lost.
-- ============================================================

ALTER TABLE org.schools
  ADD COLUMN IF NOT EXISTS meta jsonb;

-- Refresh the public view so the new column is reachable (SELECT * views do
-- not pick up new columns until re-created).
CREATE OR REPLACE VIEW public.schools
  WITH (security_invoker = true) AS
SELECT * FROM org.schools;

-- Re-assert grants (CREATE OR REPLACE preserves them, but be explicit —
-- migration 035 established authenticated DML on the org views).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schools TO authenticated;
