-- ============================================================
-- Migration 058: Language preference follows the account
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run.
--
-- The BM/EN choice was only stored in the browser (localStorage), so it reset
-- on every new device / cleared browser / shared school computer. It now also
-- lives on the profile: saved when the user explicitly picks a language,
-- applied automatically at sign-in on any device.
--
-- Self-writable: the 033 self-update guard locks only its listed columns
-- (role/status/school_id/…) — preferred_language is not locked, so users can
-- update their own row. NULL = never chose; the app default (English) applies.
-- ============================================================

ALTER TABLE core.profiles
  ADD COLUMN IF NOT EXISTS preferred_language text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_preferred_language_check') THEN
    ALTER TABLE core.profiles ADD CONSTRAINT profiles_preferred_language_check
      CHECK (preferred_language IS NULL OR preferred_language IN ('en','ms'));
  END IF;
END $$;

-- Refresh the public view so the new column is reachable (SELECT * views do
-- not pick up new columns until re-created).
CREATE OR REPLACE VIEW public.profiles
  WITH (security_invoker = true) AS
SELECT * FROM core.profiles;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
