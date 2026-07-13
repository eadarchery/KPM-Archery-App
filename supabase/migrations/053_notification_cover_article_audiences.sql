-- ============================================================
-- Migration 053: Notification cover image + article multi-audience
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- 1. notifications.image_url — optional cover photo (public URL from the
--    existing 'articles' bucket). Recommended 1200×630 px.
-- 2. articles.audiences text[] — an article can now target MULTIPLE roles
--    via checkboxes. The read policy honours the array; the legacy single
--    `audience` column remains as fallback for existing rows.
-- ============================================================

-- ─── 1. Notification cover ───────────────────────────────────────

ALTER TABLE notification.notifications
  ADD COLUMN IF NOT EXISTS image_url text;

CREATE OR REPLACE VIEW public.notifications
  WITH (security_invoker = true) AS
SELECT * FROM notification.notifications;

-- ─── 2. Article multi-audience ───────────────────────────────────

ALTER TABLE content.articles
  ADD COLUMN IF NOT EXISTS audiences text[];

CREATE OR REPLACE VIEW public.articles
  WITH (security_invoker = true) AS
SELECT * FROM content.articles;

-- Read policy: published + (multi-audience array when set, else legacy single).
DROP POLICY IF EXISTS "articles_approved_read_published" ON content.articles;
CREATE POLICY "articles_approved_read_published" ON content.articles
  FOR SELECT TO authenticated
  USING (
    core.is_approved()
    AND status = 'published'
    AND published_at IS NOT NULL AND published_at <= now()
    AND (
      CASE
        WHEN audiences IS NOT NULL AND array_length(audiences, 1) > 0 THEN
          'all' = ANY (audiences)
          OR (SELECT role::text FROM core.profiles WHERE id = auth.uid()) = ANY (audiences)
        ELSE
          audience::text = 'all'
          OR audience::text = (SELECT role::text FROM core.profiles WHERE id = auth.uid())
      END
    )
  );
