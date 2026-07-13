-- ============================================================
-- Migration 013: Notification Manager — status / category / priority
-- ============================================================

-- ─── ADD COLUMNS ──────────────────────────────────────────────

ALTER TABLE notification.notifications
  ADD COLUMN IF NOT EXISTS status   text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'announcement'
    CHECK (category IN ('announcement', 'reminder', 'score', 'tournament', 'system')),
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ─── BACK-FILL STATUS FOR EXISTING ROWS ──────────────────────

-- Rows that are published and not expired → published
UPDATE notification.notifications
  SET status = 'published'
  WHERE status = 'draft'
    AND published_at IS NOT NULL
    AND published_at <= now()
    AND (expires_at IS NULL OR expires_at > now());

-- Rows scheduled for the future → scheduled
UPDATE notification.notifications
  SET status = 'scheduled'
  WHERE status = 'draft'
    AND published_at IS NOT NULL
    AND published_at > now();

-- Rows that were published but now expired → archived
UPDATE notification.notifications
  SET status = 'archived'
  WHERE status = 'draft'
    AND expires_at IS NOT NULL
    AND expires_at <= now();

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────

CREATE OR REPLACE TRIGGER notifications_updated_at
  BEFORE UPDATE ON notification.notifications
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ─── NOTES ────────────────────────────────────────────────────
-- notification.notification_reads uses profile_id (NOT user_id).
-- No schema change needed — the column was always profile_id.
-- Frontend bug (user_id references) is fixed in the TypeScript service layer.
