-- ============================================================
-- Migration 012: Achievement Badge Columns + Score Badge Seed
-- ============================================================

-- ─── NEW COLUMNS ON achievement_definitions ───────────────────

ALTER TABLE achievement.achievement_definitions
  ADD COLUMN IF NOT EXISTS badge_light_url text,
  ADD COLUMN IF NOT EXISTS badge_dark_url  text,
  ADD COLUMN IF NOT EXISTS display_order   int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────

CREATE OR REPLACE TRIGGER achievement_defs_updated_at
  BEFORE UPDATE ON achievement.achievement_definitions
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ─── SCORE BADGE SEED (200, 250, 290, 300, 310, 320, 330, 350) ─

INSERT INTO achievement.achievement_definitions
  (slug, name, description, category, threshold, icon, display_order, active)
VALUES
  ('score_200', 'First Century Double', 'Achieved a score of 200 or above in a validated tournament round.', 'score', 200, '🎯', 10, true),
  ('score_250', 'Silver Target',        'Achieved a score of 250 or above in a validated tournament round.', 'score', 250, '🥈', 20, true),
  ('score_290', 'Elite Approach',       'Achieved a score of 290 or above in a validated tournament round.', 'score', 290, '⭐', 30, true),
  ('score_300', 'Perfect 300',          'Achieved the perfect score of 300 in a validated tournament round.', 'score', 300, '🏆', 40, true),
  ('score_310', 'Beyond Perfect',       'Achieved a score of 310 or above in a validated tournament round.', 'score', 310, '💎', 50, true),
  ('score_320', 'Gold Ring',            'Achieved a score of 320 or above in a validated tournament round.', 'score', 320, '🥇', 60, true),
  ('score_330', 'Master Archer',        'Achieved a score of 330 or above in a validated tournament round.', 'score', 330, '🌠', 70, true),
  ('score_350', 'Legend',               'Achieved a score of 350 or above in a validated tournament round.', 'score', 350, '👑', 80, true)
ON CONFLICT (slug) DO UPDATE SET
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  category      = EXCLUDED.category,
  threshold     = EXCLUDED.threshold,
  icon          = EXCLUDED.icon,
  display_order = EXCLUDED.display_order;

-- Update display_order for existing practice badges (so they sort after score)
UPDATE achievement.achievement_definitions SET display_order = 100 WHERE slug = 'arrows_100';
UPDATE achievement.achievement_definitions SET display_order = 110 WHERE slug = 'arrows_1k';
UPDATE achievement.achievement_definitions SET display_order = 120 WHERE slug = 'arrows_5k';
UPDATE achievement.achievement_definitions SET display_order = 130 WHERE slug = 'arrows_10k';
UPDATE achievement.achievement_definitions SET display_order = 140 WHERE slug = 'arrows_50k';

-- ─── STORAGE BUCKET POLICIES (achievement-badges) ─────────────
-- Bucket must be created manually in Supabase Dashboard → Storage:
--   achievement-badges (public, 5 MB, image/png)

CREATE POLICY "achievement_badges_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'achievement-badges');

CREATE POLICY "achievement_badges_admin_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'achievement-badges' AND core.is_admin());

CREATE POLICY "achievement_badges_admin_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'achievement-badges' AND core.is_admin());

CREATE POLICY "achievement_badges_admin_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING  (bucket_id = 'achievement-badges' AND core.is_admin())
  WITH CHECK (bucket_id = 'achievement-badges' AND core.is_admin());
