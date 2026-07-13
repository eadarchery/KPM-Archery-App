-- ============================================================
-- Migration 077: Article custom author name (byline)
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent. Additive only — one new nullable column.
--
-- WHY: articles only stored author_id (the creating admin), so the byline was
--      always that admin's profile name. This adds an optional author_name so
--      an editor can set a custom byline (guest writer, "EAD Coaching Team",
--      etc.). When null, the app falls back to the creator's profile name.
--
-- NOTE: public.articles is a SELECT * VIEW over content.articles. A SELECT *
--       view does NOT auto-gain columns added later — it must be re-created so
--       PostgREST exposes the new column (same lesson as migration 076).
-- ============================================================

ALTER TABLE content.articles
  ADD COLUMN IF NOT EXISTS author_name text;

COMMENT ON COLUMN content.articles.author_name IS
  'Optional custom byline. When null, the UI shows the author_id profile name.';

-- Re-expand SELECT * so the view exposes the new column to PostgREST.
CREATE OR REPLACE VIEW public.articles
  WITH (security_invoker = true) AS
SELECT * FROM content.articles;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.articles TO authenticated;

-- Reload the API schema cache immediately.
NOTIFY pgrst, 'reload schema';
