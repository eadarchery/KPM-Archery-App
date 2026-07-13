-- ============================================================
-- Migration 076: Archer disciplines + round bow-category flow
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent. Additive only — one new nullable column.
--
-- WHY: bow category was taken from the archer's single profile bow. We are
--      moving to a discipline model:
--        • each ROUND is tagged with the bow categories it is for
--          (scoring.rounds.bow_categories — ALREADY EXISTS, just now used),
--        • each ARCHER records which disciplines they shoot (NEW column below),
--        • when submitting, the archer only sees rounds for their disciplines,
--          and the score's bow_category is taken from the ROUND, not the profile.
--
-- This migration adds core.profiles.disciplines AND recreates the public.profiles
-- view. IMPORTANT: a `SELECT *` view does NOT auto-gain columns added to the
-- base table afterwards — the column list is frozen when the view is created.
-- So the view must be re-created (CREATE OR REPLACE re-expands the `*`) for the
-- app (which writes to public.profiles) to see `disciplines`.
-- rounds.bow_categories already existed when public.rounds was created, so the
-- round side needs no change.
--
-- SELF-EDIT: the profile self-guard (033) is a DENYLIST (blocks only role /
-- status / approval / scope / coach). disciplines is not protected, so an
-- archer can set it on their own profile with no new policy.
-- ============================================================

ALTER TABLE core.profiles
  ADD COLUMN IF NOT EXISTS disciplines bow_category[];

COMMENT ON COLUMN core.profiles.disciplines IS
  'Bow disciplines this archer shoots (recurve/compound/barebow/longbow/traditional). Drives which rounds they can submit scores for.';

-- Re-expand SELECT * so the view exposes the new column to PostgREST.
CREATE OR REPLACE VIEW public.profiles
  WITH (security_invoker = true) AS
SELECT * FROM core.profiles;

-- (CREATE OR REPLACE preserves existing grants; re-assert to be safe.)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;

-- Tell PostgREST to reload immediately (no waiting for the auto-reload).
NOTIFY pgrst, 'reload schema';
