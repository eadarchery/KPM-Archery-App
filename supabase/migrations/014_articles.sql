-- ============================================================
-- Migration 014: Articles Table Enhancements
-- Adds: status, tags, is_featured, archived_at, updated_by
-- ============================================================
-- content.articles already exists from 005_supporting_tables.sql
-- Existing columns: id, title, slug, summary, cover_url,
--   body_blocks (jsonb), audience, category, author_id,
--   published_at, created_at, updated_at

-- ─── ADD COLUMNS ──────────────────────────────────────────────

ALTER TABLE content.articles
  ADD COLUMN IF NOT EXISTS status      text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  ADD COLUMN IF NOT EXISTS tags        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by  uuid REFERENCES core.profiles(id);

-- ─── BACK-FILL STATUS ─────────────────────────────────────────
-- Rows that already have a published_at in the past → published

UPDATE content.articles
  SET status = 'published'
  WHERE status = 'draft'
    AND published_at IS NOT NULL
    AND published_at <= now();

-- ─── INDEXES ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS articles_status_idx
  ON content.articles(status);

CREATE INDEX IF NOT EXISTS articles_featured_idx
  ON content.articles(is_featured)
  WHERE is_featured;

CREATE INDEX IF NOT EXISTS articles_tags_gin_idx
  ON content.articles USING GIN(tags);

-- ─── NOTES ────────────────────────────────────────────────────
-- Storage bucket 'articles' (public, 10 MB) was declared in
-- 007_functions_seed_storage.sql and must be created manually
-- in the Supabase Dashboard → Storage.
--
-- Upload path convention:  {slug}/{timestamp}-{filename}
-- Cover images path:       {slug}/cover-{timestamp}-{filename}
